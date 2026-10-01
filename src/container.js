/**
 * Composition root (Injeção de Dependência — princípio do Sotov).
 *
 * TODA dependência é criada aqui e injetada por construtor. Nenhum service
 * importa o Prisma ou outro service diretamente. Resultado:
 *  - testes trocam qualquer peça (ex.: gateway de pagamento falso) sem mocks globais
 *  - a API e o worker montam exatamente o mesmo grafo de objetos
 */
import { config as defaultConfig } from './config/env.js';
import { createPrisma } from './config/prisma.js';
import { createRedis } from './config/redis.js';
import { logger as defaultLogger } from './utils/logger.js';
import { createCache } from './utils/cache.js';
import { createQueueProducer } from './queue/queues.js';
import { createProcessors } from './queue/processors.js';
import { PaymentGatewayClient } from './integrations/PaymentGatewayClient.js';
import { EmailClient } from './integrations/EmailClient.js';
import { PdfRenderer } from './pdf/PdfRenderer.js';
import { RefreshTokenManager } from './security/RefreshTokenManager.js';

import { ContextoService } from './modules/contexto/ContextoService.js';
import { AuditoriaService } from './modules/auditoria/AuditoriaService.js';
import { AuthService } from './modules/auth/AuthService.js';
import { CatalogoService } from './modules/catalogo/CatalogoService.js';
import { CadastroService } from './modules/cadastro/CadastroService.js';
import { AssinaturaService } from './modules/assinatura/AssinaturaService.js';
import { AdminAuthService } from './modules/admin/AdminAuthService.js';
import { AdminEmpresasService } from './modules/admin/AdminEmpresasService.js';
import { ConfiguracoesService } from './modules/configuracoes/ConfiguracoesService.js';
import { ClientesRepository } from './modules/clientes/ClientesRepository.js';
import { ClientesService } from './modules/clientes/ClientesService.js';
import { ServicosRepository, ServicosService } from './modules/servicos/ServicosService.js';
import { ProfissionaisRepository, ProfissionaisService } from './modules/profissionais/ProfissionaisService.js';
import { AtendimentosRepository, AtendimentosService } from './modules/atendimentos/AtendimentosService.js';
import { AgendaService } from './modules/agenda/AgendaService.js';
import { OrcamentosRepository, OrcamentosService } from './modules/orcamentos/OrcamentosService.js';
import { CategoriasDespesaRepository, DespesasRepository, DespesasService } from './modules/despesas/DespesasService.js';
import { IndicadoresRepository } from './modules/dashboard/IndicadoresRepository.js';
import { DashboardService } from './modules/dashboard/DashboardService.js';
import { UsuariosRepository, UsuariosService } from './modules/usuarios/UsuariosService.js';

/**
 * @param {Partial<{config, logger, prisma, redis, queue, gateway, emailClient, pdfRenderer}>} overrides
 */
export function createContainer(overrides = {}) {
  const config = overrides.config ?? defaultConfig;
  const logger = overrides.logger ?? defaultLogger;
  const prisma = overrides.prisma ?? createPrisma();
  const redis = 'redis' in overrides ? overrides.redis : createRedis();
  const cache = createCache(redis);
  const queue = overrides.queue ?? createQueueProducer({ redisUrl: config.redisUrl, logger });
  const gateway = overrides.gateway ?? new PaymentGatewayClient({ ...config.payments, logger });
  const emailClient =
    overrides.emailClient ?? new EmailClient({ apiKey: config.email.brevoApiKey, from: config.email.from, fromName: config.email.fromName, logger });
  const pdfRenderer = overrides.pdfRenderer ?? new PdfRenderer({ executablePath: config.pdf.executablePath, logger });

  const refreshTokens = new RefreshTokenManager({ prisma, delegate: 'refreshToken', subjectField: 'usuarioId', ttlDays: config.auth.refreshTtlDays, logger });
  const adminRefreshTokens = new RefreshTokenManager({
    prisma,
    delegate: 'adminRefreshToken',
    subjectField: 'adminId',
    ttlDays: config.auth.adminRefreshTtlDays,
    logger,
  });

  // ---------- repositórios
  const repos = {
    clientesRepository: new ClientesRepository(prisma),
    servicosRepository: new ServicosRepository(prisma),
    profissionaisRepository: new ProfissionaisRepository(prisma),
    atendimentosRepository: new AtendimentosRepository(prisma),
    orcamentosRepository: new OrcamentosRepository(prisma),
    despesasRepository: new DespesasRepository(prisma),
    categoriasDespesaRepository: new CategoriasDespesaRepository(prisma),
    indicadoresRepository: new IndicadoresRepository(prisma),
    usuariosRepository: new UsuariosRepository(prisma),
  };

  // ---------- services
  const base = { prisma, cache, queue, config, logger };
  const contexto = new ContextoService(base);
  const auditoria = new AuditoriaService(base);
  const configuracoes = new ConfiguracoesService({ ...base, auditoria });
  const catalogo = new CatalogoService({ ...base, auditoria });
  const atendimentos = new AtendimentosService({ ...base, ...repos, configuracoes });

  const services = {
    contexto,
    auditoria,
    configuracoes,
    catalogo,
    atendimentos,
    auth: new AuthService({ ...base, refreshTokens, contexto, auditoria }),
    cadastro: new CadastroService({ ...base, catalogo, auditoria }),
    assinatura: new AssinaturaService({ ...base, gateway, contexto, auditoria }),
    adminAuth: new AdminAuthService({ ...base, refreshTokens: adminRefreshTokens, auditoria }),
    adminEmpresas: new AdminEmpresasService({ ...base, contexto, auditoria }),
    clientes: new ClientesService({ ...base, ...repos, configuracoes }),
    servicos: new ServicosService({ ...base, ...repos }),
    profissionais: new ProfissionaisService({ ...base, ...repos, contexto }),
    agenda: new AgendaService(base),
    orcamentos: new OrcamentosService({ ...base, ...repos, atendimentos, pdfRenderer }),
    despesas: new DespesasService({ ...base, ...repos }),
    dashboard: new DashboardService({ ...base, ...repos }),
    usuarios: new UsuariosService({ ...base, ...repos, contexto, auditoria }),
  };

  const container = { config, logger, prisma, redis, cache, queue, gateway, emailClient, pdfRenderer, refreshTokens, adminRefreshTokens, repos, services };

  // Sem Redis, os jobs rodam no próprio processo
  if (queue.mode === 'inline') queue.setProcessors(createProcessors(container));

  container.close = async () => {
    await queue.close?.();
    await pdfRenderer.close?.();
    await prisma.$disconnect();
    if (redis) await redis.quit().catch(() => redis.disconnect());
  };

  return container;
}
