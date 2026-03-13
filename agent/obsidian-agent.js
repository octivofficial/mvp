// agent/obsidian-agent.js
const { getLogger } = require('./logger');
const log = getLogger();

class ObsidianOrganizer {
  constructor(config = {}, board = null, reflexion = null) {
    if (!config.vaultPath) {
      throw new Error('Missing vault path');
    }
    this.vaultPath = config.vaultPath;
    this.board = board;
    this.reflexion = reflexion;
    
    if (!this.board) {
      const { Blackboard } = require('./blackboard');
      this.board = new Blackboard(config.blackboardUrl);
    }
  }

  async init() {
    await this.board.connect();
    this.subscriber = await this.board.createSubscriber();
    
    await this.subscriber.subscribe('octiv:telegram:prd', (message) => {
      const data = JSON.parse(message);
      this.handlePRD(data);
    });

    await this.subscriber.subscribe('octiv:obsidian:import', (message) => {
      const data = JSON.parse(message);
      this.handleImport(data);
    });
  }

  async classifyFile(content) {
    if (!this.reflexion) return 'uncategorized';
    
    const prompt = `Classify this content into one of: requirement, design, task, note, other. Return ONLY the category name.\n\nContent:\n${content.slice(0, 500)}`;
    try {
      // Use 'normal' severity to allow Haiku/Local fallback
      const category = await this.reflexion.callLLM(prompt, 'normal');
      return category?.toLowerCase().trim() || 'uncategorized';
    } catch {
      return 'uncategorized';
    }
  }

  startWatcher(watcherFactory = null) {
    let watchMethod = watcherFactory;
    if (!watchMethod) {
      // Lazy load to avoid crash if not installed
      const chokidar = require('chokidar');
      watchMethod = chokidar.watch;
    }
    
    this.watcher = watchMethod(this.vaultPath, { ignored: /(^|[\/\\])\./, persistent: true, ignoreInitial: true });
    this.watcher
      .on('add', path => this.onFileUpdate(path))
      .on('change', path => this.onFileUpdate(path));
  }

  async onFileUpdate(filePath) {
    const fs = require('fs/promises');
    const path = require('path');
    
    try {
      if (filePath.endsWith('.canvas')) return; // ignore canvas
      
      const content = await fs.readFile(filePath, 'utf-8');
      const category = await this.classifyFile(content);
      
      if (category && category !== 'uncategorized') {
        const destDirMap = {
          'requirement': '01-Requirements',
          'design': '02-Design',
          'task': '03-Implementation',
          'note': '04-Skills/background'
        };
        
        const destDirName = destDirMap[category];
        if (destDirName) {
          const destDir = path.join(this.vaultPath, destDirName);
          await fs.mkdir(destDir, { recursive: true });
          const destPath = path.join(destDir, path.basename(filePath));
          
          if (filePath !== destPath) {
            await fs.rename(filePath, destPath);
            log.info('obsidian-agent', `Auto-routed ${path.basename(filePath)} to ${destDirName}`);
          }
        }
      }
    } catch (err) {
      log.error('obsidian-agent', 'onFileUpdate error', { error: err.message });
    }
  }

  async handlePRD(data) {
    const fs = require('fs/promises');
    const path = require('path');

    const slug = (data.title || 'untitled')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    const destDir = path.join(this.vaultPath, '01-Requirements');
    await fs.mkdir(destDir, { recursive: true });

    const filePath = path.join(destDir, `${slug}.md`);
    const content = `---\ntitle: ${data.title || 'Untitled'}\ntype: requirement\nauthor: ${data.author || 'unknown'}\n---\n\n${data.content || ''}\n`;

    await fs.writeFile(filePath, content, 'utf-8');
    log.info('obsidian-agent', `PRD saved to 01-Requirements/${slug}.md`);

    if (this.board) {
      await this.board.publish('obsidian:confirm', {
        message: `PRD saved: ${slug}.md`,
        path: filePath,
        author: 'obsidian-agent'
      });
    }
  }

  async handleImport(data) {
    const fs = require('fs/promises');
    const path = require('path');
    
    // Save to background info folder
    const destDir = path.join(this.vaultPath, '04-Skills/background');
    await fs.mkdir(destDir, { recursive: true });
    
    const filename = `research-${Date.now()}.md`;
    const filePath = path.join(destDir, filename);
    
    const content = `---
type: research
tags: [external, notebooklm]
source: ${data.author || 'unknown'}
---
# ${data.title || 'Imported Research'}

${data.content || ''}
`;
    await fs.writeFile(filePath, content, 'utf-8');
    log.info('obsidian-agent', `Imported research saved to ${filename}`);
  }
}

module.exports = ObsidianOrganizer;
