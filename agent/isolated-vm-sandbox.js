/**
 * IsolatedVMSandbox — secure code execution using isolated-vm
 * 
 * Replaces vm2 (CVE-2023-37466) with isolated-vm for true V8 isolation.
 * No Proxy escape vulnerability, proper timeout enforcement.
 */
const ivm = require('isolated-vm');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MEMORY_LIMIT_MB = 128;

class IsolatedVMSandbox {
  constructor(options = {}) {
    this.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
    this.memoryLimit = options.memoryLimit || DEFAULT_MEMORY_LIMIT_MB;
  }

  /**
   * Run code in isolated V8 context with timeout and memory limits.
   * @param {string} code - JavaScript code to execute
   * @returns {Promise<any>} - Result of code execution
   */
  async run(code) {
    // Create new isolate (separate V8 instance)
    const isolate = new ivm.Isolate({ memoryLimit: this.memoryLimit });
    
    try {
      // Create context within isolate
      const context = await isolate.createContext();
      
      // Compile script
      const script = await isolate.compileScript(code);
      
      // Run with timeout
      const result = await script.run(context, { timeout: this.timeout });
      
      // Copy result back to main context
      if (result && typeof result === 'object') {
        return await result.copy();
      }
      
      return result;
    } catch (err) {
      // Handle timeout errors
      if (err.message && err.message.includes('Script execution timed out')) {
        throw new Error(`Execution timeout exceeded (${this.timeout}ms)`);
      }
      
      // Re-throw other errors
      throw err;
    } finally {
      // Always dispose isolate to free memory
      isolate.dispose();
    }
  }

  /**
   * Run code with custom context (variables available in sandbox).
   * @param {string} code - JavaScript code to execute
   * @param {object} contextVars - Variables to inject into sandbox
   * @returns {Promise<any>} - Result of code execution
   */
  async runWithContext(code, contextVars = {}) {
    const isolate = new ivm.Isolate({ memoryLimit: this.memoryLimit });
    
    try {
      const context = await isolate.createContext();
      const jail = context.global;
      
      // Inject context variables
      for (const [key, value] of Object.entries(contextVars)) {
        await jail.set(key, new ivm.ExternalCopy(value).copyInto());
      }
      
      // Compile and run
      const script = await isolate.compileScript(code);
      const result = await script.run(context, { timeout: this.timeout });
      
      if (result && typeof result === 'object') {
        return await result.copy();
      }
      
      return result;
    } catch (err) {
      if (err.message && err.message.includes('Script execution timed out')) {
        throw new Error(`Execution timeout exceeded (${this.timeout}ms)`);
      }
      throw err;
    } finally {
      isolate.dispose();
    }
  }

  /**
   * Validate code syntax without executing.
   * @param {string} code - JavaScript code to validate
   * @returns {Promise<boolean>} - true if valid, throws if invalid
   */
  async validate(code) {
    const isolate = new ivm.Isolate({ memoryLimit: this.memoryLimit });
    
    try {
      await isolate.compileScript(code);
      return true;
    } finally {
      isolate.dispose();
    }
  }
}

module.exports = { IsolatedVMSandbox };
