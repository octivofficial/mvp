/**
 * Redis Client Factory — Single-node or Cluster with Full Jitter reconnection.
 *
 * Usage:
 *   Single (default): createRedisClient()
 *   Cluster: REDIS_CLUSTER_NODES=host1:7000,host2:7001 createRedisClient()
 *
 * Both paths share the same Full Jitter reconnection strategy.
 * redis v5 cluster client is API-compatible — Blackboard methods work unchanged.
 */
const { createClient, createCluster } = require("redis");
const T = require("../config/timeouts");

/**
 * Full Jitter exponential backoff — avoids thundering herd.
 * Returns delay in [0, min(base * 2^retries, cap)) or false to stop.
 * See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
 */
function fullJitterStrategy(retries) {
  if (retries > T.MAX_RECONNECT_ATTEMPTS) return false;
  const base = T.REDIS_RECONNECT_BASE_MS;
  const cap = T.REDIS_RECONNECT_CAP_MS;
  const expBackoff = Math.min(base * Math.pow(2, retries), cap);
  return Math.floor(Math.random() * expBackoff);
}

/**
 * Parse REDIS_CLUSTER_NODES env string into rootNodes array.
 * Format: "host1:7000,host2:7001,host3:7002"
 */
function parseClusterNodes(envStr) {
  return envStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hp) => {
      const [host, port] = hp.split(":");
      return { url: `redis://${host}:${port || 6379}` };
    });
}

/**
 * Check if cluster mode is enabled via environment variable.
 */
function isClusterMode() {
  return !!process.env.REDIS_CLUSTER_NODES;
}

/**
 * Create a redis client — single-node or cluster based on REDIS_CLUSTER_NODES env.
 * @param {object} [options] - { url, socket, cluster }
 * @returns {import('redis').RedisClientType | import('redis').RedisClusterType}
 */
function createRedisClient(options = {}) {
  const socketOpts = {
    reconnectStrategy: fullJitterStrategy,
    ...options.socket,
  };

  if (isClusterMode()) {
    const rootNodes = parseClusterNodes(process.env.REDIS_CLUSTER_NODES);
    return createCluster({
      rootNodes,
      defaults: { socket: socketOpts },
      ...options.cluster,
    });
  }

  const url =
    options.url || process.env.BLACKBOARD_REDIS_URL || "redis://localhost:6380";
  return createClient({ url, socket: socketOpts });
}

module.exports = {
  createRedisClient,
  fullJitterStrategy,
  parseClusterNodes,
  isClusterMode,
};
