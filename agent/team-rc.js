/**
 * Octiv Team Remote Control — responds to RC commands published by discord-bot
 * Extracted from team.js for maintainability.
 * Supports: status, agents, ac, log, test
 */
const { getLogger } = require('./logger');
const log = getLogger();

/**
 * Set up Remote Control listener on Blackboard pub/sub.
 * @param {object} board - Blackboard instance
 * @param {object} agents - { leader, safety, builders, explorer, miner, farmer }
 * @returns {object} rcSubscriber for cleanup
 */
async function setupRemoteControl(board, agents) {
  const rcSubscriber = await board.createSubscriber();
  const rcCommands = ['status', 'agents', 'ac', 'log', 'test'];

  for (const subcmd of rcCommands) {
    await rcSubscriber.subscribe(`octiv:rc:cmd:${subcmd}`, async (message) => {
      try {
        const request = JSON.parse(message);
        const requestId = request.requestId;
        if (!requestId) return;

        let data;
        switch (subcmd) {
          case 'status': {
            const teamStatus = await board.get('team:status');
            data = {
              status: teamStatus?.status || 'unknown',
              mission: teamStatus?.mission || 'unknown',
              uptime: teamStatus?.startedAt
                ? `${Math.round((Date.now() - new Date(teamStatus.startedAt).getTime()) / 1000)}s`
                : 'unknown',
              builders: agents.builders.length,
            };
            break;
          }
          case 'agents': {
            const agentList = [
              { id: agents.leader.id, role: 'leader', mode: agents.leader.mode },
              ...agents.builders.map((b, i) => ({ id: `builder-0${i + 1}`, role: 'builder' })),
              { id: 'safety-01', role: 'safety' },
              { id: 'explorer-01', role: 'explorer' },
              ...(agents.miner ? [{ id: agents.miner.id, role: 'miner' }] : []),
              ...(agents.farmer ? [{ id: agents.farmer.id, role: 'farmer' }] : []),
            ];
            data = agentList;
            break;
          }
          case 'ac': {
            const matrix = {};
            for (let i = 1; i <= agents.builders.length; i++) {
              const progress = await board.getACProgress(`builder-0${i}`);
              const parsed = {};
              for (const [k, v] of Object.entries(progress)) {
                try { parsed[k] = JSON.parse(v).status; } catch { parsed[k] = v; }
              }
              matrix[`builder-0${i}`] = parsed;
            }
            data = matrix;
            break;
          }
          case 'log': {
            const recent = await board.get('team:status');
            data = `Team: ${recent?.status || 'unknown'} | Mission: ${recent?.mission || 'unknown'}`;
            break;
          }
          case 'test': {
            data = 'RC connection OK. Team is responsive.';
            break;
          }
        }

        // Publish response back via main board client
        const responsePayload = JSON.stringify({
          ts: Date.now(),
          requestId,
          data,
        });
        await board.client.publish(`octiv:${requestId}`, responsePayload);
      } catch (err) {
        log.error('team', `RC handler error for ${subcmd}`, { error: err.message });
      }
    });
  }

  log.info('team', 'Remote Control listener active', { commands: rcCommands });
  return rcSubscriber;
}

module.exports = { setupRemoteControl };
