/**
 * Octiv Blackboard — Redis-based Agent Shared Memory
 * All agents share state through this module.
 */
const { createClient } = require('redis');

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6380';
const PREFIX = 'octiv:';

class Blackboard {
  constructor(redisUrl) {
    const url = redisUrl || REDIS_URL;
    this.client = createClient({ url });
    this.client.on('error', (err) => console.error('[Blackboard] Redis error:', err));
  }

  async connect() {
    await this.client.connect();
    console.log('[Blackboard] Connected:', REDIS_URL);
  }

  async disconnect() {
    await this.client.disconnect();
  }

  /**
   * Publish agent status
   */
  async publish(channel, data) {
    const payload = JSON.stringify({ ts: Date.now(), ...data });
    await this.client.publish(PREFIX + channel, payload);
    await this.client.set(PREFIX + channel + ':latest', payload, { EX: 300 });
  }

  /**
   * Read latest status
   */
  async get(channel) {
    const val = await this.client.get(PREFIX + channel + ':latest');
    return val ? JSON.parse(val) : null;
  }

  /**
   * Save skill to library
   */
  async saveSkill(name, skillData) {
    await this.client.hSet(PREFIX + 'skills:library', name, JSON.stringify(skillData));
    console.log(`[Blackboard] Skill saved: ${name}`);
  }

  /**
   * Retrieve skill from library
   */
  async getSkill(name) {
    const val = await this.client.hGet(PREFIX + 'skills:library', name);
    return val ? JSON.parse(val) : null;
  }

  /**
   * Update AC progress
   */
  async updateAC(agentId, acNum, status) {
    await this.client.hSet(
      PREFIX + `agent:${agentId}:ac`,
      `AC-${acNum}`,
      JSON.stringify({ status, ts: Date.now() })
    );
  }

  /**
   * Retrieve all AC progress for an agent
   */
  async getACProgress(agentId) {
    return await this.client.hGetAll(PREFIX + `agent:${agentId}:ac`);
  }

  /**
   * Log reflection entry (maintains max 50 entries)
   */
  async logReflexion(agentId, entry) {
    await this.client.lPush(
      PREFIX + `agent:${agentId}:reflexion`,
      JSON.stringify({ ts: Date.now(), ...entry })
    );
    // Keep only recent 50 entries
    await this.client.lTrim(PREFIX + `agent:${agentId}:reflexion`, 0, 49);
  }
}

module.exports = { Blackboard };
