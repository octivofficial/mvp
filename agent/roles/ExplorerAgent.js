/**
 * Octiv Explorer Role — Phase 3.5 + 6.4
 * Specialized scouting agent with spiral search pattern and danger avoidance.
 * Shares discovered locations via Blackboard world map.
 */
const { BaseRole } = require('./BaseRole');
const { AgentChat } = require('../agent-chat');
const { getLogger } = require('../logger');
const log = getLogger();

const DANGER_BLOCKS = ['lava', 'flowing_lava', 'fire', 'cactus', 'magma_block', 'sweet_berry_bush'];
const SPIRAL_STEP = 10;

class ExplorerAgent extends BaseRole {
  constructor(config = {}) {
    super({ ...config, role: 'explorer' });
    this.discovered = [];
    this.radius = 0;
    this.maxRadius = config.maxRadius || 200;
    this.worldMap = {};     // { "x,z": { biome, dangers, resources } }
    this.dangerZones = [];  // [{ x, y, z, type }]
    this.spiralIndex = 0;
    this.chat = new AgentChat(this.board, this.id, 'explorer');
  }

  async execute(bot) {
    await this.reportStatus('exploring');
    this.radius = Math.min(this.radius + SPIRAL_STEP, this.maxRadius);

    const pos = bot.entity?.position || { x: 0, y: 64, z: 0 };
    const center = { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };

    // Spiral search: generate next waypoint
    const waypoint = this._nextSpiralPoint(center);

    // Scan area for dangers and resources
    const scanResult = this._scanArea(bot, waypoint);

    // Record discovery
    const discovery = {
      radius: this.radius,
      center,
      waypoint,
      dangers: scanResult.dangers,
      resources: scanResult.resources,
      safe: scanResult.dangers.length === 0,
    };
    this.discovered.push(discovery);

    // Update world map
    const key = `${waypoint.x},${waypoint.z}`;
    this.worldMap[key] = {
      scannedAt: Date.now(),
      dangers: scanResult.dangers,
      resources: scanResult.resources,
    };

    // Chat about discovery
    this.chat.chat('discovery', {
      radius: this.radius, resources: scanResult.resources.length,
      dangers: scanResult.dangers.length, x: waypoint.x, z: waypoint.z,
      safe: scanResult.dangers.length === 0 ? 'safe' : 'hostile',
    }).catch(e => log.debug('explorer', 'chat error', { error: e.message }));

    // Report one danger per type (throttle only allows first per 30s anyway)
    const reportedTypes = new Set();
    for (const d of scanResult.dangers) {
      if (!reportedTypes.has(d.type)) {
        reportedTypes.add(d.type);
        this.chat.chat('danger_spotted', { type: d.type, x: d.x, y: d.y, z: d.z }).catch(e => log.debug('explorer', 'chat error', { error: e.message }));
      }
    }

    // Confess on danger zone accumulation
    if (this.dangerZones.length > 0 && this.dangerZones.length % 5 === 0) {
      this.chat.confess('danger_zone', { dangerCount: this.dangerZones.length }).catch(e => log.debug('explorer', 'chat error', { error: e.message }));
    }

    // Confess milestone every 10 discoveries
    if (this.discovered.length > 0 && this.discovered.length % 10 === 0) {
      this.chat.confess('milestone', { discoveries: this.discovered.length }).catch(e => log.debug('explorer', 'chat error', { error: e.message }));
    }

    // Publish to Blackboard
    await this.board.publish(`agent:${this.id}:explored`, { author: this.id, ...discovery });
    const channelKey = key.replace(/,/g, '_');
    await this.board.publish(`world:map:${channelKey}`, {
      author: this.id,
      position: waypoint,
      ...this.worldMap[key],
    });

    return {
      success: true,
      radius: this.radius,
      totalDiscoveries: this.discovered.length,
      dangers: scanResult.dangers.length,
      safe: scanResult.dangers.length === 0,
    };
  }

  // Generate spiral search coordinates
  _nextSpiralPoint(center) {
    this.spiralIndex++;
    const n = this.spiralIndex;
    // Ulam spiral approximation
    const layer = Math.ceil((Math.sqrt(n) - 1) / 2);
    const leg = Math.floor((n - (2 * layer - 1) ** 2) / (2 * layer)) || 0;
    const offset = (n - (2 * layer - 1) ** 2) - 2 * layer * leg;

    let dx = 0, dz = 0;
    switch (leg) {
      case 0: dx = layer; dz = -layer + offset; break;
      case 1: dx = layer - offset; dz = layer; break;
      case 2: dx = -layer; dz = layer - offset; break;
      case 3: dx = -layer + offset; dz = -layer; break;
    }

    return {
      x: center.x + dx * SPIRAL_STEP,
      y: center.y,
      z: center.z + dz * SPIRAL_STEP,
    };
  }

  // Scan area for dangers and resources
  _scanArea(bot, center) {
    const dangers = [];
    const resources = [];

    if (!bot.blockAt) return { dangers, resources };

    const scanRadius = 5;
    for (let dx = -scanRadius; dx <= scanRadius; dx++) {
      for (let dz = -scanRadius; dz <= scanRadius; dz++) {
        for (let dy = -3; dy <= 3; dy++) {
          const block = bot.blockAt({
            x: center.x + dx,
            y: center.y + dy,
            z: center.z + dz,
          });
          if (!block) continue;

          if (DANGER_BLOCKS.includes(block.name)) {
            dangers.push({
              type: block.name,
              x: center.x + dx,
              y: center.y + dy,
              z: center.z + dz,
            });
          }

          // Track valuable resources
          if (block.name?.includes('ore') || block.name?.includes('chest') || block.name?.includes('spawner')) {
            resources.push({
              type: block.name,
              x: center.x + dx,
              y: center.y + dy,
              z: center.z + dz,
            });
          }
        }
      }
    }

    // Update danger zones
    this.dangerZones.push(...dangers);

    return { dangers, resources };
  }

  // Check if a position is safe (not near danger zones)
  isPositionSafe(pos, minDistance = 5) {
    for (const danger of this.dangerZones) {
      const dist = Math.sqrt(
        (pos.x - danger.x) ** 2 + (pos.y - danger.y) ** 2 + (pos.z - danger.z) ** 2
      );
      if (dist < minDistance) return false;
    }
    return true;
  }

  getWorldMap() {
    return { ...this.worldMap };
  }

  getDangerZones() {
    return [...this.dangerZones];
  }
}

module.exports = { ExplorerAgent, DANGER_BLOCKS, SPIRAL_STEP };
