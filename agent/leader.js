/**
 * Octiv Leader Agent — strategy-engine 역할
 * 목표 분해, Training/Creative 모드 결정, 투표 집계
 */
const { Blackboard } = require('./blackboard');

class LeaderAgent {
  constructor(teamSize = 3) {
    this.id = 'leader';
    this.teamSize = teamSize;
    this.board = new Blackboard();
    this.votes = [];
    this.mode = 'training'; // training | creative
  }

  async init() {
    await this.board.connect();
    console.log('[Leader] 초기화 완료, 팀 크기:', this.teamSize);
  }

  // AC 진행도 집계 후 모드 결정
  async decideMode(agentId) {
    const acData = await this.board.getACProgress(agentId);
    const total = Object.keys(acData).length;
    const done = Object.values(acData).filter(v => JSON.parse(v).status === 'done').length;
    const progress = total > 0 ? done / total : 0;

    this.mode = (progress >= 0.7 || this.votes.length >= Math.ceil(this.teamSize * 2 / 3))
      ? 'creative'
      : 'training';

    await this.board.publish('leader:mode', { mode: this.mode, progress });
    console.log(`[Leader] 모드: ${this.mode} (진행도: ${Math.floor(progress * 100)}%)`);
    return this.mode;
  }

  // 팀 투표 집계
  async collectVote(agentId, vote) {
    this.votes.push({ agentId, vote, ts: Date.now() });
    await this.board.publish('leader:votes', { votes: this.votes });
    console.log(`[Leader] 투표 수신: ${agentId} → ${vote}`);
  }

  // Group Reflexion 강제 실행 (3회 연속 실패 시)
  async forceGroupReflexion(failureLog) {
    console.warn('[Leader] ⚠️  Group Reflexion 강제 실행!');
    await this.board.publish('leader:reflexion', {
      type: 'group',
      trigger: 'consecutive_failures',
      failureLog,
    });
  }

  async shutdown() {
    await this.board.disconnect();
  }
}

module.exports = { LeaderAgent };
