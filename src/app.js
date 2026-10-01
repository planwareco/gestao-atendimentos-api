/**
 * Montagem do Express. Recebe o container pronto (DI) — não cria dependências.
 * Ordem dos middlewares importa:
 *   request id/log -> segurança (helmet/cors) -> parsers -> health -> rate limit -> rotas -> 404 -> erros
 */
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import { createRateLimiters } from './middlewares/rateLimit.js';
import { createGuards } from './middlewares/guards.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { buildOpenApi } from './docs/openapi.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { publicRoutes } from './modules/cadastro/public.routes.js';
import { checkoutRoutes } from './modules/assinatura/checkout.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { configuracoesRoutes } from './modules/configuracoes/configuracoes.routes.js';
import { clientesRoutes } from './modules/clientes/clientes.routes.js';
import { servicosRoutes } from './modules/servicos/servicos.routes.js';
import { profissionaisRoutes } from './modules/profissionais/profissionais.routes.js';
import { atendimentosRoutes } from './modules/atendimentos/atendimentos.routes.js';
import { agendaRoutes } from './modules/agenda/agenda.routes.js';
import { orcamentosRoutes } from './modules/orcamentos/orcamentos.routes.js';
import { despesasRoutes } from './modules/despesas/despesas.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { usuariosRoutes } from './modules/usuarios/usuarios.routes.js';

const REQUEST_ID_RE = /^[\w-]{8,64}$/;

export function createApp(container, { state = { shuttingDown: false }, disableRateLimit = false } = {}) {
  const { config, logger, prisma, redis, cache, queue, services } = container;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy); // atrás do proxy do Render: req.ip correto

  // Correlation ID + log estruturado por requisição
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url.startsWith('/health') },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // Documentação (antes do helmet: o Swagger UI precisa de CSP mais permissivo)
  const openapi = () => buildOpenApi({ title: `${config.appName} — API`, version: '1.0.0', serverUrl: config.apiUrl });
  app.get('/docs/openapi.json', (_req, res) => res.json(openapi()));
  app.use('/docs', swaggerUi.serve, (req, res, next) => swaggerUi.setup(openapi(), { customSiteTitle: `${config.appName} — API` })(req, res, next));

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true, // cookie do refresh token
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', 'X-Client'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Idempotent-Replayed', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use(healthRoutes({ prisma, queue, redis, cache, state }));

  const rateLimiters = createRateLimiters({ redis, disabled: disableRateLimit });
  app.use(rateLimiters.global);

  const guards = createGuards({ services, rateLimiters, config });
  const deps = { services, guards, rateLimiters, config, prisma };

  const modules = [
    publicRoutes(deps),
    checkoutRoutes(deps),
    authRoutes(deps),
    ...adminRoutes(deps),
    configuracoesRoutes(deps),
    clientesRoutes(deps),
    servicosRoutes(deps),
    profissionaisRoutes(deps),
    atendimentosRoutes(deps),
    agendaRoutes(deps),
    orcamentosRoutes(deps),
    despesasRoutes(deps),
    ...dashboardRoutes(deps),
    usuariosRoutes(deps),
  ];
  for (const { prefix, router } of modules) app.use(prefix, router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
