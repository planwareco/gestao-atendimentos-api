/**
 * Health checks para o Render/orquestrador:
 *   /health/live  -> processo está de pé (liveness)
 *   /health/ready -> banco e Redis respondendo (readiness)
 *   /health       -> alias de ready (mesmo formato do payment-system-mp)
 */
import { Router } from 'express';

export function healthRoutes({ prisma, queue, redis, cache, state }) {
  const router = Router();

  const check = async (fn, timeoutMs = 2000) => {
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
      return 'ok';
    } catch {
      return 'unreachable';
    }
  };

  const ready = async (_req, res) => {
    const [database, redisStatus] = await Promise.all([check(() => prisma.$queryRaw`SELECT 1`), redis ? check(() => redis.ping()) : 'disabled']);
    const ok = database === 'ok' && redisStatus !== 'unreachable' && !state.shuttingDown;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database,
      redis: redisStatus,
      queue: queue.mode,
      cache: { backend: cache.backend, ...cache.stats },
      uptimeSec: Math.round(process.uptime()),
    });
  };

  router.get('/health/live', (_req, res) => res.json({ status: state.shuttingDown ? 'shutting-down' : 'ok' }));
  router.get('/health/ready', ready);
  router.get('/health', ready);
  return router;
}
