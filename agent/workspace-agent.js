const { google } = require('googleapis');
const { getLogger } = require('./logger');

const log = getLogger();

class WorkspaceAgent {
  constructor(config = {}, board = null) {
    this.config = config;
    this.board = board;
    this.auth = null;
    this.scopes = [
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ];
  }

  async init() {
    log.info('workspace-agent', 'initializing Workspace Automation APIs...');
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
      try {
        const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        this.auth = new google.auth.GoogleAuth({
          credentials,
          scopes: this.scopes,
        });
        log.info('workspace-agent', 'Auth initialized from JSON string');
      } catch (err) {
        log.error('workspace-agent', 'Failed to parse JSON credentials', { error: err.message });
      }
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      this.auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        scopes: this.scopes,
      });
      log.info('workspace-agent', 'Auth initialized from key file');
    }
    
    if (this.board) {
      const sub = await this.board.createSubscriber();
      sub.subscribe('workspace:task', async (msg) => {
        try {
          const data = JSON.parse(msg);
          log.info('workspace-agent', `Received task: ${data.action}`);
          await this.handleTask(data);
        } catch (err) {
          log.error('workspace-agent', 'Task processing failed', { error: err.message });
        }
      });
    }
  }

  async handleTask(data) {
    switch (data.action) {
      case 'export_prd':
        const docResult = await this.exportToDoc(data);
        await this.board.publish('workspace:finished', { ...docResult, taskId: data.taskId });
        break;
      case 'sync_status':
        await this.syncToSheet(data);
        break;
      case 'create_folder':
        const folderResult = await this.createFolder(data.name);
        await this.board.publish('workspace:finished', { ...folderResult, taskId: data.taskId });
        break;
      default:
        log.warn('workspace-agent', `Unknown action: ${data.action}`);
    }
  }

  async exportToDoc(data) {
    const title = data.title || 'Untitled PRD';
    const content = data.content || '';
    log.info('workspace-agent', `Exporting Doc: ${title}`);
    
    if (!this.auth) throw new Error('Unauthenticated');

    try {
      const docs = google.docs({ version: 'v1', auth: this.auth });
      const doc = await docs.documents.create({ requestBody: { title } });
      const documentId = doc.data.documentId;

      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [{ insertText: { location: { index: 1 }, text: content } }]
        }
      });

      const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
      return { docUrl, documentId, status: 'success' };
    } catch (err) {
      log.error('workspace-agent', 'Doc export failed', { error: err.message });
      throw err;
    }
  }

  async syncToSheet(data) {
    const sheetId = data.sheetId || process.env.GOOGLE_SHEET_ID;
    if (!this.auth || !sheetId) return;

    try {
      const sheets = google.sheets({ version: 'v4', auth: this.auth });
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: 'Sheet1!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            new Date().toISOString(),
            data.author || 'system',
            data.status || 'active',
            data.message || ''
          ]]
        }
      });
    } catch (err) {
      log.error('workspace-agent', 'Sheet sync failed', { error: err.message });
    }
  }

  async createFolder(name) {
    if (!this.auth) throw new Error('Unauthenticated');
    try {
      const drive = google.drive({ version: 'v3', auth: this.auth });
      const fileMetadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
      };
      const folder = await drive.files.create({
        resource: fileMetadata,
        fields: 'id',
      });
      return { folderId: folder.data.id, status: 'success' };
    } catch (err) {
      log.error('workspace-agent', 'Folder creation failed', { error: err.message });
      throw err;
    }
  }
}

module.exports = { WorkspaceAgent };
