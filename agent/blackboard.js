/**
 * Octiv Blackboard — Redis 기반 에이전트 공유 메모리
 * 모든 에이전트가 이 모듈을 통해 상태를 공유합니다.
 */
const { createClient } = require('redis');

const REDIS_URL = process.env.BLACKBOARD_REDIS_URL || 'redis://localhost:6379';
const PREFIX = 'octiv:';

class Blackboard {
  constructor() {
    this.client = createClient({ url: REDIS_URL });
    this.client.on('error', (err) => console.error('[Blackboard] Redis error:', err));
  }

  async connect() {
    await this.client.connect();
    console.log('[Blackboard] 연결됨:', REDIS_URL);
  }

  async disconnect() {
    await this.client.disconnect();
  }

  // 에이전트 상태 게시
  async publish(channel, data) {
    const payload = JSON.stringify({ ts: Date.now(), ...data });
    await this.client.publish(PREFIX + channel, payload);
    await this.client.set(PREFIX + channel + ':latest', payload, { EX: 300 });
  }

  // 최신 상태 읽기
  async get(channel) {
    const val = await this.client.get(PREFIX + channel + ':latest');
    return val ? JSON.parse(val) : null;
  }

  // 스킬 라이브러리 저장
  async saveSkill(name, skillData) {
    await this.client.hSet(PREFIX + 'skills:library', name, JSON.stringify(skillData));
    console.log(`[Blackboard] 스킬 저장: ${name}`);
  }

  // 스킬 라이브러리 조회
  async getSkill(name) {
    const val = await this.client.hGet(PREFIX + 'skills:library', name);
    return val ? JSON.parse(val) : null;
  }

  // AC 진행도 업데이트
  async updateAC(agentId, acNum, status) {
    await this.client.hSet(
      PREFIX + `agent:${agentId}:ac`,
      `AC-${acNum}`,
      JSON.stringify({ status, ts: Date.now() })
    );
  }

  // 전체 AC 진행도 조회
  async getACProgress(agentId) {
    return await this.client.hGetAll(PREFIX + `agent:${agentId}:ac`);
  }

  // Reflexion 기록
  async logReflexion(agentId, entry) {
    await this.client.lPush(
      PREFIX + `agent:${agentId}:reflexion`,
      JSON.stringify({ ts: Date.now(), ...entry })
    );
    // 최근 50개만 유지
    await this.client.lTrim(PREFIX + `agent:${agentId}:reflexion`, 0, 49);
  }
}

module.exports = { Blackboard };
