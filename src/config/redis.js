/**
 * Conexão Redis (cache compartilhado, rate limit distribuído e filas BullMQ).
 * Retorna null quando REDIS_URL não está definido (dev/test sem Redis).
 */
import IORedis from 'ioredis';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export function createRedis({ url = config.redisUrl, forQueue = false } = {}) {
  if (!url) return null;
  const client = new IORedis(url, {
    // BullMQ exige maxRetriesPerRequest = null nas conexões dos workers
    maxRetriesPerRequest: forQueue ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  return client;
}
