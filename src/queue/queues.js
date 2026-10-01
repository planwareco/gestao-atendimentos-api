/**
 * Filas (BullMQ + Redis) para tudo que é lento ou depende de terceiros:
 * e-mails, geração de PDF, reconciliação de pagamentos e rotinas agendadas.
 *
 * - Retry com backoff exponencial (5 tentativas)
 * - Jobs que falharam todas as tentativas ficam no conjunto "failed" por 14 dias
 *   (funciona como Dead Letter Queue para inspeção/reprocessamento)
 * - jobId determinístico quando faz sentido (deduplicação, ex.: PDF de uma versão)
 *
 * Sem REDIS_URL (dev/test) os jobs rodam "inline" no próprio processo, de forma
 * assíncrona — o comportamento da API é o mesmo, só sem durabilidade.
 */
import { Queue } from 'bullmq';

export const QUEUES = Object.freeze({
  EMAILS: 'emails',
  DOCUMENTOS: 'documentos',
  MANUTENCAO: 'manutencao',
});

export const JOBS = Object.freeze({
  EMAIL: 'enviar-email',
  PDF_ORCAMENTO: 'gerar-pdf-orcamento',
  RECONCILIAR_PAGAMENTOS: 'reconciliar-pagamentos',
  EXPIRAR_ORCAMENTOS: 'expirar-orcamentos',
  LIMPAR_EXPIRADOS: 'limpar-expirados',
});

export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 14 * 24 * 3600 },
});

/** Converte a REDIS_URL em opções de conexão aceitas pelo BullMQ. */
export function bullConnection(redisUrl) {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

class BullProducer {
  constructor(redisUrl) {
    this.mode = 'bullmq';
    const connection = bullConnection(redisUrl);
    this.queues = Object.fromEntries(Object.values(QUEUES).map((name) => [name, new Queue(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS })]));
  }

  async add(queue, name, data, opts = {}) {
    const job = await this.queues[queue].add(name, data, opts);
    return { id: job.id };
  }

  async ping() {
    const client = await this.queues[QUEUES.EMAILS].client;
    return (await client.ping()) === 'PONG';
  }

  async close() {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
  }
}

class InlineProducer {
  constructor(logger) {
    this.mode = 'inline';
    this.logger = logger;
    this.processors = {};
    this.pending = new Set();
    this.seen = new Set();
  }

  setProcessors(processors) {
    this.processors = processors;
  }

  async add(_queue, name, data, opts = {}) {
    if (opts.jobId) {
      if (this.seen.has(opts.jobId)) return { id: opts.jobId, deduplicated: true };
      this.seen.add(opts.jobId);
    }
    const processor = this.processors[name];
    const id = opts.jobId ?? `${name}-${Date.now()}`;
    if (!processor) {
      this.logger?.warn({ name }, 'Job sem processador (modo inline)');
      return { id };
    }
    const run = (async () => {
      await new Promise((r) => setImmediate(r));
      try {
        await processor(data, { id, name, attemptsMade: 0 });
      } catch (err) {
        this.logger?.error({ err: err.message, name }, 'Job inline falhou');
      } finally {
        if (opts.jobId) this.seen.delete(opts.jobId);
      }
    })();
    this.pending.add(run);
    run.finally(() => this.pending.delete(run));
    return { id };
  }

  /** Aguarda jobs inline em andamento (usado em testes e no shutdown). */
  async drain() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  async ping() {
    return true;
  }

  async close() {
    await this.drain();
  }
}

export function createQueueProducer({ redisUrl, logger }) {
  return redisUrl ? new BullProducer(redisUrl) : new InlineProducer(logger);
}
