const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');
const { getLogger } = require('./logger');
const T = require('../config/timeouts');

const log = getLogger();

/**
 * @deprecated Legacy single-bot base class from Phase 1.2-1.3.
 * Production uses BuilderAgent (agent/builder.js) + team.js orchestrator.
 * Kept for E2E smoke tests and heartbeat/reconnection pattern reference.
 */
class OctivBot {
    constructor(config, options = {}) {
        this.config = config;
        this.options = {
            redisUrl: options.redisUrl || 'redis://localhost:6380',
            heartbeatIntervalMs: options.heartbeatIntervalMs || T.HEARTBEAT_INTERVAL_MS,
            maxReconnectAttempts: options.maxReconnectAttempts || 5,
            baseReconnectDelayMs: options.baseReconnectDelayMs || T.BASE_RECONNECT_DELAY_MS,
            createBotFn: options.createBotFn || null,
            ...options
        };

        this.reconnectAttempts = 0;
        this.board = new Blackboard(this.options.redisUrl, options.blackboardOptions);

        this.bot = null;
        this.spawned = false;
        this.shuttingDown = false;
        this.heartbeatTimer = null;
        this.spawnTimeoutTimer = null;
    }

    async start() {
        try {
            await this.board.connect();
        } catch (err) {
            log.error(this.config.username, `Blackboard connection failed: ${err.message}`);
        }
        await this._createBot();
    }

    async _createBot() {
        log.info(this.config.username, 'Spawning bot...');

        if (this.options.createBotFn) {
            this.bot = this.options.createBotFn(this.config);
        } else {
            this.bot = mineflayer.createBot(this.config);
            this.bot.loadPlugin(pathfinder);
        }

        this._startSpawnTimeout();

        this.bot.on('spawn', () => this._onSpawn());
        this.bot.on('health', () => this._onHealthChange());
        this.bot.on('error', (err) => this._reconnect(err));
        this.bot.on('end', (reason) => this._reconnect(new Error(`Connection ended: ${reason}`)));
        this.bot.on('kicked', (reason) => this._reconnect(new Error(`Kicked: ${reason}`)));

        // Chat command handler
        this.bot.on('chat', (username, message) => {
            if (username === this.bot.username) return;
            if (message === '!status') {
                this.bot.chat(`Status: Health ${Math.floor(this.bot.health)}/20, Food ${Math.floor(this.bot.food)}/20`);
            }
            if (message === '!pos') {
                const pos = this.bot.entity?.position;
                if (pos) this.bot.chat(`Position: X=${Math.floor(pos.x)}, Y=${Math.floor(pos.y)}, Z=${Math.floor(pos.z)}`);
            }
        });
    }

    async _onSpawn() {
        this.spawned = true;
        this.reconnectAttempts = 0;
        if (this.spawnTimeoutTimer) {
            clearTimeout(this.spawnTimeoutTimer);
            this.spawnTimeoutTimer = null;
        }

        // Wait for bot to reach stable ground before proceeding
        await this._waitForGround();

        const pos = this.bot.entity?.position;
        const health = this.bot.health;
        log.info(this.config.username, 'Bot spawned successfully!', pos ? {
            x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z),
            health,
        } : undefined);

        // Detect spawn fall damage
        if (health < 20) {
            log.warn(this.config.username,
                `Spawn damage: ${(20 - health).toFixed(1)} HP lost (health: ${health.toFixed(1)}/20)`);
        }

        await this._publishStatus('spawned');
        this._startHeartbeat();
    }

    async _waitForGround() {
        const maxWait = T.SPAWN_GROUND_WAIT_MS;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
            if (!this.bot?.entity) return;
            if (this.bot.entity.velocity.y >= 0) return;
            await this.bot.waitForTicks(1);
        }
        log.warn(this.config.username, `Ground wait timeout (${maxWait}ms)`);
    }

    _startHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(async () => {
            if (this.spawned && this.bot?.entity && !this.shuttingDown) {
                await this._publishStatus('alive');
            }
        }, this.options.heartbeatIntervalMs);
    }

    _startSpawnTimeout() {
        if (this.spawnTimeoutTimer) clearTimeout(this.spawnTimeoutTimer);
        const timeout = this.options.spawnTimeoutMs || T.SPAWN_TIMEOUT_MS;
        this.spawnTimeoutTimer = setTimeout(() => {
            if (!this.spawned && !this.shuttingDown) {
                log.warn(this.config.username, `Spawn timeout (${timeout}ms). Retrying...`);
                this._reconnect(new Error('Spawn timeout'));
            }
        }, timeout);
    }

    async _onHealthChange() {
        if (this.bot.health <= 10) {
            log.warn(this.config.username, `Low health: ${this.bot.health}/20`);
        }

        const data = {
            author: this.config.username,
            username: this.config.username,
            health: this.bot.health,
            food: this.bot.food,
        };

        try {
            await this.board.publish('bot:health', data);
        } catch (err) {
            // Ignore Blackboard errors inside events to allow resilience
        }
    }

    async _publishStatus(status) {
        const data = {
            author: this.config.username,
            username: this.config.username,
            status: status,
            position: this.bot.entity?.position || null,
            health: this.bot.health,
            food: this.bot.food,
        };

        try {
            await this.board.publish('bot:status', data);
        } catch (err) {
            log.error(this.config.username, `Blackboard publish error: ${err.message}`);
        }
    }

    async _reconnect(err) {
        if (this.shuttingDown) return;

        if (this.spawned) {
            log.info(this.config.username, `Bot disconnected: ${err.message}`);
            this.spawned = false;
        }

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.spawnTimeoutTimer) {
            clearTimeout(this.spawnTimeoutTimer);
            this.spawnTimeoutTimer = null;
        }

        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            log.error(this.config.username, `Max reconnect attempts reached (${this.options.maxReconnectAttempts})`);
            return;
        }

        const delay = Math.pow(2, this.reconnectAttempts) * this.options.baseReconnectDelayMs;
        log.info(this.config.username, `Reconnect attempt ${this.reconnectAttempts + 1}/${this.options.maxReconnectAttempts} (in ${delay}ms)`);

        await new Promise(r => setTimeout(r, delay));
        if (this.shuttingDown) return;

        this.reconnectAttempts++;
        await this._createBot();
    }

    async shutdown() {
        log.info(this.config.username, 'Shutting down OctivBot...');
        this.shuttingDown = true;
        this.spawned = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.spawnTimeoutTimer) clearTimeout(this.spawnTimeoutTimer);

        if (this.bot) {
            try { this.bot.quit(); } catch (e) { log.debug(this.config.username, 'bot.quit cleanup error', { error: e.message }); }
        }

        try {
            await this.board.disconnect();
        } catch (e) { log.debug(this.config.username, 'board disconnect cleanup error', { error: e.message }); }

        log.info(this.config.username, 'OctivBot shutdown complete');
    }
}

module.exports = { OctivBot };
