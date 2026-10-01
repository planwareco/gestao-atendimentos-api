/**
 * Worker de filas (processo separado da API — no Render, um "Background Worker").
 * Processa e-mails, PDFs e rotinas agendadas; nada disso roda no request principal.
 */
import { Worker } from 'bullmq';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { createContainer } from './container.js';
import { createProcessors } from './queue/processors.js';
import { DEFAULT_JOB_OPTIONS, JOBS, QUEUES, bullConnection } from './queue/queues.js';

const CONCURRENCY = { [QUEUES.EMAILS]: 5, [QUEUES.DOCUMENTOS]: 2, [QUEUES.MANUTENCAO]: 1 };

async function main() {
  if (!config.redisUrl) {
    logger.fatal('REDIS_URL é obrigatório para o worker.');
    process.exit(1);
  }

  const container = createContainer();
  const processors = createProcessors(container);
  const connection = bullConnection(config.redisUrl);

  const workers = Object.values(QUEUES).map((queueName) => {
    const worker = new Worker(
      queueName,
      async (job) => {
        const processor = processors[job.name];
        if (!processor) throw new Error(`Sem processador para o job ${job.name}`);
        return processor(job.data, job);
      },
      { connection, concurrency: CONCURRENCY[queueName] },
    );
    worker.on('completed', (job) => logger.info({ queue: queueName, job: job.name, id: job.id }, 'Job concluído'));
    worker.on('failed', (job, err) =>
      logger[job && job.attemptsMade >= (job.opts.attempts ?? 1) ? 'error' : 'warn'](
        { queue: queueName, job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message },
        'Job falhou',
      ),
    );
    worker.on('error', (err) => logger.error({ err: err.message, queue: queueName }, 'Erro no worker'));
    return worker;
  });

  // Rotinas agendadas (idempotente: upsert não duplica a cada deploy)
  const manutencao = container.queue.queues[QUEUES.MANUTENCAO];
  await manutencao.upsertJobScheduler(
    'reconciliar-pagamentos',
    { every: 5 * 60_000 },
    { name: JOBS.RECONCILIAR_PAGAMENTOS, opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } },
  );
  await manutencao.upsertJobScheduler('expirar-orcamentos', { pattern: '10 3 * * *', tz: 'America/Sao_Paulo' }, { name: JOBS.EXPIRAR_ORCAMENTOS });
  await manutencao.upsertJobScheduler('limpar-expirados', { pattern: '30 4 * * *', tz: 'America/Sao_Paulo' }, { name: JOBS.LIMPAR_EXPIRADOS });

  logger.info({ queues: Object.values(QUEUES) }, '🛠️  Worker iniciado');

  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Encerrando worker (aguardando jobs em andamento)...');
    await Promise.allSettled(workers.map((w) => w.close()));
    await container.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Falha ao iniciar o worker');
  process.exit(1);
});
