/**
 * Ponto de entrada da API.
 * Graceful shutdown: ao receber SIGTERM (deploy no Render), para de aceitar
 * conexões, espera as requisições em andamento e fecha banco/Redis/filas.
 */
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { createContainer } from './container.js';
import { createApp } from './app.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main() {
  const container = createContainer();
  await container.prisma.$queryRaw`SELECT 1`;
  logger.info({ queue: container.queue.mode, cache: container.cache.backend }, '✅ Banco conectado');

  const state = { shuttingDown: false };
  const app = createApp(container, { state });
  const server = app.listen(config.port, () => logger.info(`🚀 API ouvindo em http://localhost:${config.port} — docs em /docs`));
  server.keepAliveTimeout = 65_000; // maior que o idle timeout do load balancer
  server.headersTimeout = 66_000;

  const shutdown = async (signal) => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    logger.info({ signal }, 'Encerrando com segurança...');
    const force = setTimeout(() => {
      logger.error('Timeout no shutdown — forçando saída');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    server.close(async () => {
      try {
        await container.close();
        logger.info('Encerrado.');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Erro no shutdown');
        process.exit(1);
      }
    });
    server.closeIdleConnections?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha ao iniciar a API');
  process.exit(1);
});
