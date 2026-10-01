/**
 * Prisma Client (Rust-free: engineType = "client" + driver adapter `pg`).
 * - Pool de conexões explícito (DATABASE_POOL_MAX) — importante no Neon/Render.
 * - statement_timeout evita queries presas segurando conexão.
 * - Queries lentas (> 500ms) são logadas para análise com EXPLAIN.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const SLOW_QUERY_MS = 500;

export function createPrisma({ url = config.db.url } = {}) {
  const adapter = new PrismaPg({
    connectionString: url,
    max: config.db.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: config.db.statementTimeoutMs,
    application_name: 'gestao-atendimentos-api',
  });

  const prisma = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
    ],
  });

  prisma.$on('query', (e) => {
    if (e.duration >= SLOW_QUERY_MS) {
      logger.warn({ durationMs: e.duration, query: e.query }, 'Query lenta');
    }
  });
  prisma.$on('warn', (e) => logger.warn({ prisma: e.message }, 'Prisma warn'));
  // Erros de query são lançados e tratados pelo errorHandler (não logamos em duplicidade)

  return prisma;
}
