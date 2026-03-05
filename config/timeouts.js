/**
 * Centralized Timeout Configuration
 *
 * All timing constants used across agent/*.js.
 * Override via environment variables where supported.
 * Values are in milliseconds unless noted otherwise.
 */

module.exports = {
  // -- Core Bot Lifecycle --

  /** Heartbeat publish frequency */
  HEARTBEAT_INTERVAL_MS: parseInt(process.env.HEARTBEAT_INTERVAL_MS) || 10000,

  /** Bot spawn timeout before retry */
  SPAWN_TIMEOUT_MS: parseInt(process.env.SPAWN_TIMEOUT_MS) || 30000,

  /** Base delay for exponential backoff on reconnect */
  BASE_RECONNECT_DELAY_MS: 1000,

  /** Max reconnect attempts before giving up */
  MAX_RECONNECT_ATTEMPTS: 10,

  // -- Navigation & Movement --

  /** Pathfinder goto timeout */
  PATHFINDER_TIMEOUT_MS: parseInt(process.env.PATHFINDER_TIMEOUT_MS) || 30000,

  /** Wait for ground after spawn */
  SPAWN_GROUND_WAIT_MS: parseInt(process.env.SPAWN_GROUND_WAIT_MS) || 2000,

  // -- Team Orchestration --

  /** Leader mission distribution interval */
  MISSION_LOOP_INTERVAL_MS: 10000,

  /** Explorer execution loop interval */
  EXPLORER_LOOP_INTERVAL_MS: 15000,

  /** Team status logging interval */
  STATUS_LOG_INTERVAL_MS: 30000,

  /** Force exit timeout during graceful shutdown */
  SHUTDOWN_TIMEOUT_MS: 10000,

  /** Delay between sequential builder spawns */
  BUILDER_SPAWN_INTERVAL_MS: 2000,

  // -- Coordination --

  /** AC-4 gathering check poll interval */
  GATHERING_POLL_INTERVAL_MS: 5000,

  // -- Deduplication & Cooldowns --

  /** Emergency event deduplication window */
  EMERGENCY_DEDUP_MS: parseInt(process.env.EMERGENCY_DEDUP_MS) || 3000,

  /** Safety threat cooldown */
  THREAT_COOLDOWN_MS: parseInt(process.env.SAFETY_THREAT_COOLDOWN_MS) || 2000,

  /** Agent chat message cooldown */
  CHAT_COOLDOWN_MS: parseInt(process.env.CHAT_COOLDOWN_MS) || 30000,

  /** Agent confession cooldown */
  CONFESS_COOLDOWN_MS: parseInt(process.env.CONFESS_COOLDOWN_MS) || 300000,

  // -- VM Sandbox --

  /** node:vm script execution timeout */
  VM_TIMEOUT_MS: parseInt(process.env.VM_TIMEOUT_MS) || 3000,

  // -- Learning Engines --

  /** Rumination digestion cycle interval (5 min) */
  RUMINATION_INTERVAL_MS: 5 * 60 * 1000,

  /** Deep rumination schedule (30 min) */
  DEEP_RUMINATION_INTERVAL_MS: 30 * 60 * 1000,

  // -- Redis (Blackboard) --

  /** Max backoff for Redis reconnect strategy */
  REDIS_RECONNECT_MAX_MS: 3000,

  /** TTL for latest status keys (seconds, not ms) */
  REDIS_KEY_EXPIRY_SECONDS: 300,

  // -- Skill System --

  /** Daily skill reset interval (24h) */
  SKILL_DAILY_RESET_MS: 24 * 60 * 60 * 1000,

  // -- Remote Control --

  /** RC command response timeout */
  RC_RESPONSE_TIMEOUT_MS: 30000,

  // -- Mining --

  /** Mining session total timeout */
  MINING_SESSION_TIMEOUT_MS: parseInt(process.env.MINING_SESSION_TIMEOUT_MS) || 120000,

  /** Single block dig timeout */
  MINING_DIG_TIMEOUT_MS: parseInt(process.env.MINING_DIG_TIMEOUT_MS) || 5000,

  /** Navigation to ore timeout */
  MINING_NAV_TIMEOUT_MS: parseInt(process.env.MINING_NAV_TIMEOUT_MS) || 15000,

  /** Smelting operation timeout */
  MINING_SMELT_TIMEOUT_MS: parseInt(process.env.MINING_SMELT_TIMEOUT_MS) || 30000,

  /** Inventory item count threshold to consider "full" */
  MINING_INVENTORY_THRESHOLD: parseInt(process.env.MINING_INVENTORY_THRESHOLD) || 32,

  // -- Obsidian Bridge --

  /** Throttle window for per-agent vault file writes */
  OBSIDIAN_AGENT_DEBOUNCE_MS: parseInt(process.env.OBSIDIAN_AGENT_DEBOUNCE_MS) || 3000,

  /** Event buffer flush interval */
  OBSIDIAN_EVENT_FLUSH_MS: parseInt(process.env.OBSIDIAN_EVENT_FLUSH_MS) || 2000,

  /** System vitals heartbeat refresh interval */
  OBSIDIAN_HEARTBEAT_MS: parseInt(process.env.OBSIDIAN_HEARTBEAT_MS) || 10000,

  /** Max events kept in rolling event log */
  OBSIDIAN_MAX_EVENTS: parseInt(process.env.OBSIDIAN_MAX_EVENTS) || 50,

  /** Obsidian REST API request timeout */
  OBSIDIAN_API_TIMEOUT_MS: parseInt(process.env.OBSIDIAN_API_TIMEOUT_MS) || 5000,

  // -- Voice / TTS --

  /** Max queued TTS messages */
  TTS_QUEUE_MAX: 10,

  /** Pause between TTS messages (ms) */
  TTS_SILENCE_BETWEEN_MS: 500,

  /** Voice channel reconnect delay (ms) */
  VOICE_RECONNECT_DELAY_MS: 5000,

  /** Max TTS text length (chars) before truncation */
  TTS_MAX_TEXT_LENGTH: 500,
};
