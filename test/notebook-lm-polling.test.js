const { describe, it } = require('node:test');
const assert = require('node:assert');
const { NotebookLMAgent } = require('../agent/notebook-lm-agent.js');

describe('NotebookLMAgent Polling', () => {
  it('should start polling when deep research is triggered', async () => {
    const mockBoard = { publish: async () => {}, createSubscriber: async () => ({ subscribe: () => {} }) };
    const agent = new NotebookLMAgent({}, mockBoard);
    
    // Trigger research
    const research = await agent.triggerDeepResearch(['source1']);
    assert.strictEqual(research.status, 'researching');
    
    // Check if polling timer is set
    assert.ok(agent.pollingInterval !== null, 'Should have started polling');
    // Cleanup
    clearInterval(agent.pollingInterval);
  });

  it('should fetch results and publish to obsidian once finished', async () => {
    let publishedChannel = null;
    let publishedData = null;
    const mockBoard = {
      publish: async (channel, data) => {
        publishedChannel = channel;
        publishedData = data;
      },
      createSubscriber: async () => ({ subscribe: () => {} })
    };
    const agent = new NotebookLMAgent({}, mockBoard);
    
    // Simulate finished research result
    const mockResult = { status: 'completed', content: 'Research paper content' };
    await agent.handleResearchFinished(mockResult);
    
    assert.strictEqual(publishedChannel, 'octiv:obsidian:import');
    assert.strictEqual(publishedData.content, 'Research paper content');
  });
});
