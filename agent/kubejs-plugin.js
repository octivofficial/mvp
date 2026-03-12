/**
 * KubeJSPlugin — wrapper for managing KubeJS scripts on the Octiv server
 *
 * Provides listing, validation, and filtering utilities for KubeJS
 * server_scripts and startup_scripts directories.
 *
 * Designed for dependency injection (fsModule) to allow clean unit testing
 * without touching the real filesystem.
 */

'use strict';

class KubeJSPlugin {
  /**
   * @param {object} options
   * @param {string} [options.scriptsDir] - Path to KubeJS server_scripts directory
   * @param {string} [options.startupDir] - Path to KubeJS startup_scripts directory
   * @param {object} [options.fsModule]   - fs module (injected for testing)
   */
  constructor({
    scriptsDir = 'server/kubejs/server_scripts',
    startupDir = 'server/kubejs/startup_scripts',
    fsModule = require('fs'),
  } = {}) {
    this.scriptsDir = scriptsDir;
    this.startupDir = startupDir;
    this.fsModule = fsModule;
  }

  /**
   * Lists all .js files in scriptsDir.
   * @returns {string[]} Array of filenames. Returns [] on any error.
   */
  listScripts() {
    return this._listJsFiles(this.scriptsDir);
  }

  /**
   * Lists all .js files in startupDir.
   * @returns {string[]} Array of filenames. Returns [] on any error.
   */
  listStartupScripts() {
    return this._listJsFiles(this.startupDir);
  }

  /**
   * Validates a KubeJS script for common incompatibilities.
   * KubeJS runs inside the JVM (Rhino/GraalJS) and does NOT support:
   *   - require()  — Node.js CommonJS module system
   *   - process.   — Node.js process global
   *
   * @param {string} filename - Script filename (used for context in error messages)
   * @param {string} content  - Script source code
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validateScript(filename, content) {
    const errors = [];

    if (content.includes('require(')) {
      errors.push(
        `${filename}: 'require()' is not supported in KubeJS — Node.js modules are unavailable`
      );
    }

    if (content.includes('process.')) {
      errors.push(
        `${filename}: 'process.' is not supported in KubeJS — Node.js process global is unavailable`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Returns the KubeJS filter expression that matches Octiv agent players.
   * @returns {string}
   */
  getAgentFilter() {
    return "player.name.startsWith('Octiv_')";
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads a directory and returns only .js filenames.
   * @param {string} dir
   * @returns {string[]}
   */
  _listJsFiles(dir) {
    try {
      const entries = this.fsModule.readdirSync(dir);
      return entries.filter(f => f.endsWith('.js'));
    } catch (_err) {
      return [];
    }
  }
}

module.exports = { KubeJSPlugin };
