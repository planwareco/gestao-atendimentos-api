/**
 * Cache-aside com Redis (compartilhado entre instâncias) e fallback em memória.
 *
 * Boas práticas aplicadas:
 *  - Chaves com namespace padronizado: `ga:<dominio>:<...>`
 *  - TTL obrigatório em toda escrita
 *  - Proteção contra cache stampede: requisições simultâneas pela mesma chave
 *    compartilham a mesma Promise (single-flight) dentro do processo
 *  - Invalidação por versão (`bump`) para conjuntos de chaves (ex.: dashboard)
 *  - Métricas simples de hit/miss
 *  - Nunca cachear dados sensíveis (senhas, tokens) — só contexto e agregados
 */
import { logger } from './logger.js';

const PREFIX = 'ga:';

class MemoryStore {
  constructor() {
    this.map = new Map();
  }
  async get(key) {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (hit.exp < Date.now()) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }
  async set(key, value, ttlSec) {
    this.map.set(key, { value, exp: Date.now() + ttlSec * 1000 });
    if (this.map.size > 10_000) this.map.delete(this.map.keys().next().value);
  }
  async del(...keys) {
    keys.forEach((k) => this.map.delete(k));
  }
  async incr(key) {
    const current = Number((await this.get(key)) ?? 0) + 1;
    await this.set(key, String(current), 86_400 * 30);
    return current;
  }
}

class RedisStore {
  constructor(redis) {
    this.redis = redis;
  }
  get(key) {
    return this.redis.get(key);
  }
  set(key, value, ttlSec) {
    return this.redis.set(key, value, 'EX', ttlSec);
  }
  del(...keys) {
    return keys.length ? this.redis.del(...keys) : 0;
  }
  async incr(key) {
    const v = await this.redis.incr(key);
    await this.redis.expire(key, 86_400 * 30);
    return v;
  }
}

export function createCache(redis) {
  const store = redis ? new RedisStore(redis) : new MemoryStore();
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, errors: 0 };

  const k = (key) => `${PREFIX}${key}`;

  async function get(key) {
    try {
      const raw = await store.get(k(key));
      if (raw == null) {
        stats.misses += 1;
        return null;
      }
      stats.hits += 1;
      return JSON.parse(raw);
    } catch (err) {
      stats.errors += 1;
      logger.warn({ err: err.message, key }, 'Falha ao ler cache — seguindo sem cache');
      return null;
    }
  }

  async function set(key, value, ttlSec) {
    try {
      await store.set(k(key), JSON.stringify(value), ttlSec);
    } catch (err) {
      stats.errors += 1;
      logger.warn({ err: err.message, key }, 'Falha ao gravar cache');
    }
  }

  async function del(...keys) {
    try {
      await store.del(...keys.map(k));
    } catch (err) {
      stats.errors += 1;
      logger.warn({ err: err.message }, 'Falha ao invalidar cache');
    }
  }

  /** Cache-aside com single-flight. */
  async function wrap(key, ttlSec, loader) {
    const cached = await get(key);
    if (cached !== null) return cached;
    if (inflight.has(key)) return inflight.get(key);
    const promise = (async () => {
      try {
        const value = await loader();
        if (value !== undefined && value !== null) await set(key, value, ttlSec);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  /** Versão de um namespace — trocar a versão invalida todas as chaves dele. */
  async function version(ns) {
    try {
      return (await store.get(k(`v:${ns}`))) ?? '0';
    } catch {
      return '0';
    }
  }

  async function bump(ns) {
    try {
      await store.incr(k(`v:${ns}`));
    } catch (err) {
      logger.warn({ err: err.message, ns }, 'Falha ao versionar cache');
    }
  }

  return { get, set, del, wrap, version, bump, stats, backend: redis ? 'redis' : 'memory' };
}
