const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { Blackboard } = require('./blackboard');

/**
 * OctivBot Class — Core bot logic for Phase 1.2-1.3
 */
class OctivBot {
    constructor(config, options = {}) {
        this.config = config;
        this.options = {
            redisUrl: options.redisUrl || 'redis://localhost:6380',
            heartbeatIntervalMs: options.heartbeatIntervalMs || 10000,
            maxReconnectAttempts: options.maxReconnectAttempts || 5,
            baseReconnectDelayMs: options.baseReconnectDelayMs || 1000,
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
            console.error(`[Blackboard] Connection failed: ${err.message}`);
        }
        await this._createBot();
    }

    async _createBot() {
        console.log(`Spawning bot... (username: ${this.config.username})`);

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

        const pos = this.bot.entity?.position;
        console.log('Bot spawned successfully!');
        if (pos) {
            console.log(`   Position: X=${Math.floor(pos.x)}, Y=${Math.floor(pos.y)}, Z=${Math.floor(pos.z)}`);
        }

        await this._publishStatus('spawned');
        this._startHeartbeat();
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
        const timeout = this.options.spawnTimeoutMs || 30000;
        this.spawnTimeoutTimer = setTimeout(() => {
            if (!this.spawned && !this.shuttingDown) {
                console.warn(`Spawn timeout (${timeout}ms). Retrying...`);
                this._reconnect(new Error('Spawn timeout'));
            }
        }, timeout);
    }

    async _onHealthChange() {
        if (this.bot.health <= 10) {
            console.warn(`Low health warning: ${this.bot.health}/20`);
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
            console.error(`[Blackboard] Publish error: ${err.message}`);
        }
    }

    async _reconnect(err) {
        if (this.shuttingDown) return;

        if (this.spawned) {
            console.log(`Bot disconnected: ${err.message}`);
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
            console.error(`Max reconnect attempts reached (${this.options.maxReconnectAttempts}).`);
            return;
        }

        const delay = Math.pow(2, this.reconnectAttempts) * this.options.baseReconnectDelayMs;
        console.log(`Reconnect attempt ${this.reconnectAttempts + 1}/${this.options.maxReconnectAttempts} (in ${delay}ms)...`);

        await new Promise(r => setTimeout(r, delay));
        if (this.shuttingDown) return;

        this.reconnectAttempts++;
        await this._createBot();
    }

    async shutdown() {
        console.log('Shutting down OctivBot...');
        this.shuttingDown = true;
        this.spawned = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.spawnTimeoutTimer) clearTimeout(this.spawnTimeoutTimer);

        if (this.bot) {
            try { this.bot.quit(); } catch (e) { }
        }

        try {
            await this.board.disconnect();
        } catch (e) { }

        console.log('OctivBot shutdown complete');
    }
}

module.exports = { OctivBot };
