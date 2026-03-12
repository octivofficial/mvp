// agent/crawler-agent.js
/* global document */
const { PlaywrightCrawler, Dataset } = require('crawlee');
const { getLogger } = require('./logger');

const log = getLogger();

class CrawlerAgent {
  constructor(config = {}, board = null) {
    this.config = config;
    this.board = board;
    this.crawler = null;
  }

  async init() {
    log.info('crawler-agent', 'initializing Crawlee + Playwright...');
    if (this.board) {
      const sub = await this.board.createSubscriber();
      sub.subscribe('crawler:start', async (msg) => {
        try {
          const data = JSON.parse(msg);
          log.info('crawler-agent', `Received research task: ${data.url}`);
          await this.crawl(data.url);
          await this.publishResults(data.context);
        } catch (err) {
          log.error('crawler-agent', 'Task processing failed', { error: err.message });
        }
      });
    }
  }

  /**
   * Crawl a single URL or a set of URLs
   * @param {string|string[]} urls 
   */
  async crawl(urls) {
    const urlArray = Array.isArray(urls) ? urls : [urls];
    
    this.crawler = new PlaywrightCrawler({
      async requestHandler({ request, page }) {
        log.info('crawler-agent', `processing: ${request.url}`);
        
        // Extract content
        const title = await page.title();
        const content = await page.content();
        const text = await page.evaluate(() => document.body.innerText);
        
        // Save to dataset (equivalent to Zettelkasten input)
        await Dataset.pushData({
          url: request.url,
          title,
          html: content.slice(0, 5000),
          text: text.slice(0, 10000), // Cap for LLM context
          scrapedAt: new Date().toISOString()
        });
      },
      maxRequestsPerCrawl: parseInt(process.env.CRAWLER_MAX_REQUESTS || '20', 10)
    });

    await this.crawler.run(urlArray);
    log.info('crawler-agent', 'crawl complete');
  }

  async publishResults(context = {}) {
    const data = await Dataset.getData();
    if (this.board && data.items.length > 0) {
      const summary = data.items.map(i => `- [${i.title}](${i.url})`).join('\n');
      await this.board.publish('crawler:finished', {
        author: 'crawler-agent',
        summary,
        context,
        timestamp: new Date().toISOString()
      });
      log.info('crawler-agent', 'Reported crawl results to Blackboard');
    }
  }
}

module.exports = { CrawlerAgent };
