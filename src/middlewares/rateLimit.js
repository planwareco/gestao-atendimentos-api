/**
 * Rate limiting por IP, por usuário/e-mail e por rota sensível.
 * Com Redis o limite é compartilhado entre instâncias; sem Redis, fica em memória.
 */
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { sendError } from '../core/http.js';

export function createRateLimiters({ redis, disabled = false }) {
  const make = (name, { windowMs, limit, keyGenerator, skipSuccessfulRequests = false, message }) => {
    if (disabled) return (_req, _res, next) => next();
    return rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skipSuccessfulRequests,
      keyGenerator,
      store: redis ? new RedisStore({ prefix: `ga:rl:${name}:`, sendCommand: (...args) => redis.call(...args) }) : undefined,
      handler: (req, res) =>
        sendError(res, {
          status: 429,
          message: message ?? 'Muitas requisições. Aguarde um pouco e tente novamente.',
          code: 'RATE_LIMITED',
          requestId: req.id,
        }),
    });
  };

  const ip = (req) => ipKeyGenerator(req.ip);
  const ipEmail = (req) => `${ip(req)}:${String(req.body?.email ?? '').toLowerCase()}`;

  return {
    /** Limite geral por IP para toda a API */
    global: make('global', { windowMs: 15 * 60_000, limit: 1000 }),
    /** Por usuário autenticado (aplicado após a autenticação) */
    porUsuario: make('usuario', {
      windowMs: 60_000,
      limit: 300,
      keyGenerator: (req) => req.ctx?.usuarioId ?? ip(req),
    }),
    /** Login: por IP e por IP+e-mail (só tentativas que falham contam) */
    loginIp: make('login-ip', { windowMs: 15 * 60_000, limit: 30, skipSuccessfulRequests: true }),
    loginEmail: make('login-email', {
      windowMs: 15 * 60_000,
      limit: 5,
      keyGenerator: ipEmail,
      skipSuccessfulRequests: true,
      message: 'Muitas tentativas de login. Aguarde 15 minutos.',
    }),
    cadastro: make('cadastro', { windowMs: 60 * 60_000, limit: 10 }),
    checkout: make('checkout', { windowMs: 15 * 60_000, limit: 30 }),
  };
}
