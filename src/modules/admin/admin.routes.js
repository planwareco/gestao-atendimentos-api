import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { paginated } from '../../core/http.js';
import { centavos, id, pagination, text } from '../../utils/validation.js';
import { clearRefreshCookie, setRefreshCookie } from '../../security/RefreshTokenManager.js';

const ADMIN_COOKIE = 'ga_art';
const ADMIN_COOKIE_PATH = '/v1/admin/auth';

const loginSchema = Joi.object({ email: Joi.string().trim().lowercase().email().required(), senha: Joi.string().max(72).required() });
const mfaSchema = Joi.object({
  mfaToken: Joi.string().max(1000).required(),
  codigo: Joi.string()
    .trim()
    .pattern(/^\d{6}$/)
    .required(),
});
const codigoSchema = Joi.object({
  codigo: Joi.string()
    .trim()
    .pattern(/^\d{6}$/)
    .required(),
});
const refreshSchema = Joi.object({ refreshToken: Joi.string().max(200) });

const empresaParams = Joi.object({ id: id().required() });
const listarEmpresasQuery = Joi.object({
  status: Joi.string().valid('PENDENTE', 'ATIVO', 'SOMENTE_LEITURA', 'DESATIVADO'),
  busca: Joi.string().trim().max(100),
  ...pagination,
});
const statusSchema = Joi.object({
  status: Joi.string().valid('ATIVO', 'SOMENTE_LEITURA', 'DESATIVADO').required(),
  motivo: text(300),
});
const modulosSchema = Joi.object({
  modulos: Joi.array().items(Joi.string().trim().uppercase().max(40)).max(20).unique().required(),
  recalcularValor: Joi.boolean().default(true),
});
const usuarioParams = Joi.object({ id: id().required(), usuarioId: id().required() });
const usuarioSchema = Joi.object({
  ativo: Joi.boolean(),
  papel: Joi.string().valid('PROPRIETARIO', 'RECEPCIONISTA', 'PROFISSIONAL'),
}).or('ativo', 'papel');
const planoSchema = Joi.object({ precoBaseCentavos: centavos().required(), nome: text(80) });
const moduloParams = Joi.object({ codigo: Joi.string().trim().uppercase().max(40).required() });
const moduloSchema = Joi.object({
  nome: text(80),
  descricao: text(300).allow(null),
  precoCentavos: centavos(),
  ativo: Joi.boolean(),
  ordem: Joi.number().integer().min(0).max(1000),
}).min(1);
const auditoriaQuery = Joi.object({ empresaId: id(), acao: Joi.string().trim().max(80), ...pagination });

export function adminRoutes({ services, guards, rateLimiters, config }) {
  const { adminAuth, adminEmpresas, catalogo, auditoria } = services;
  const cookieOpts = { name: ADMIN_COOKIE, path: ADMIN_COOKIE_PATH, isProd: config.isProd, domain: config.auth.cookieDomain };
  const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
  const responder = (res, result) => {
    if (!result.refresh) return result; // etapa de 2FA pendente
    const { refresh, ...sessao } = result;
    setRefreshCookie(res, { ...cookieOpts, token: refresh.token, expiraEm: refresh.expiraEm });
    return sessao;
  };

  const auth = defineRoutes({
    prefix: '/v1/admin/auth',
    tag: 'Admin — Auth',
    security: 'admin',
    guard: (route) => guards.admin(route),
    routes: [
      {
        method: 'post',
        path: '/login',
        public: true,
        summary: 'Login do super admin. Com 2FA ativo, devolve { mfaObrigatorio, mfaToken }',
        middlewares: [rateLimiters.loginIp, rateLimiters.loginEmail],
        validate: { body: loginSchema },
        handler: async (req, res) => responder(res, await adminAuth.login(req.body, meta(req))),
      },
      {
        method: 'post',
        path: '/2fa/verificar',
        public: true,
        summary: 'Segunda etapa do login: código TOTP de 6 dígitos',
        middlewares: [rateLimiters.loginIp],
        validate: { body: mfaSchema },
        handler: async (req, res) => responder(res, await adminAuth.verificar2fa(req.body, meta(req))),
      },
      {
        method: 'post',
        path: '/refresh',
        public: true,
        summary: 'Renova o access token do admin',
        validate: { body: refreshSchema },
        handler: async (req, res) => {
          try {
            return responder(res, await adminAuth.refresh(req.cookies?.[ADMIN_COOKIE] ?? req.body.refreshToken, meta(req)));
          } catch (err) {
            clearRefreshCookie(res, cookieOpts);
            throw err;
          }
        },
      },
      {
        method: 'post',
        path: '/logout',
        public: true,
        summary: 'Encerra a sessão do admin',
        validate: { body: refreshSchema },
        handler: async (req, res) => {
          await adminAuth.logout(req.cookies?.[ADMIN_COOKIE] ?? req.body.refreshToken);
          clearRefreshCookie(res, cookieOpts);
          return { message: 'Sessão encerrada.' };
        },
      },
      { method: 'get', path: '/me', allowMfaSetup: true, summary: 'Admin logado', handler: (req) => adminAuth.carregarAdminAtivo(req.admin.id) },
      {
        method: 'post',
        path: '/2fa/configurar',
        allowMfaSetup: true,
        summary: 'Gera segredo TOTP (otpauth URL para QR Code)',
        handler: (req) => adminAuth.configurar2fa(req.admin),
      },
      {
        method: 'post',
        path: '/2fa/ativar',
        allowMfaSetup: true,
        summary: 'Confirma o 2FA com um código do app autenticador',
        validate: { body: codigoSchema },
        handler: (req) => adminAuth.ativar2fa(req.admin, req.body),
      },
    ],
  });

  const gestao = defineRoutes({
    prefix: '/v1/admin',
    tag: 'Admin — Gestão',
    security: 'admin',
    guard: (route) => guards.admin(route),
    routes: [
      { method: 'get', path: '/metricas', summary: 'Empresas por status, receita mensal contratada, novos cadastros', handler: () => adminEmpresas.metricas() },
      {
        method: 'get',
        path: '/empresas',
        summary: 'Lista empresas (filtro por status e busca por nome/e-mail/documento)',
        validate: { query: listarEmpresasQuery },
        handler: async (req) => {
          const r = await adminEmpresas.listar(req.query);
          return paginated(r.items, r);
        },
      },
      {
        method: 'get',
        path: '/empresas/:id',
        summary: 'Detalhe da empresa: módulos, usuários, pagamentos',
        validate: { params: empresaParams },
        handler: (req) => adminEmpresas.obter(req.params.id),
      },
      {
        method: 'patch',
        path: '/empresas/:id/status',
        summary: 'Altera status: ATIVO, SOMENTE_LEITURA ou DESATIVADO',
        description: 'SOMENTE_LEITURA bloqueia toda escrita da empresa. DESATIVADO bloqueia o login e encerra as sessões. Os dados nunca são apagados.',
        validate: { params: empresaParams, body: statusSchema },
        handler: (req) => adminEmpresas.alterarStatus(req.admin, req.params.id, req.body),
      },
      {
        method: 'put',
        path: '/empresas/:id/modulos',
        summary: 'Define os módulos (permissões) da empresa',
        validate: { params: empresaParams, body: modulosSchema },
        handler: (req) => adminEmpresas.definirModulos(req.admin, req.params.id, req.body),
      },
      {
        method: 'patch',
        path: '/empresas/:id/usuarios/:usuarioId',
        summary: 'Ativa/desativa um usuário da empresa ou troca o papel',
        validate: { params: usuarioParams, body: usuarioSchema },
        handler: (req) => adminEmpresas.alterarUsuario(req.admin, req.params.id, req.params.usuarioId, req.body),
      },
      { method: 'get', path: '/catalogo', summary: 'Plano Start e módulos (inclusive inativos)', handler: () => catalogo.listarAdmin() },
      {
        method: 'put',
        path: '/catalogo/plano',
        summary: 'Altera o preço base do plano (vale para novos cadastros)',
        validate: { body: planoSchema },
        handler: (req) => catalogo.atualizarPlano(req.admin, req.body),
      },
      {
        method: 'patch',
        path: '/catalogo/modulos/:codigo',
        summary: 'Altera preço/nome/disponibilidade de um módulo (vale para novos cadastros)',
        validate: { params: moduloParams, body: moduloSchema },
        handler: (req) => catalogo.atualizarModulo(req.admin, req.params.codigo, req.body),
      },
      {
        method: 'get',
        path: '/auditoria',
        summary: 'Log de auditoria (operações sensíveis)',
        validate: { query: auditoriaQuery },
        handler: async (req) => {
          const r = await auditoria.listar(req.query);
          return paginated(r.items, r);
        },
      },
    ],
  });

  return [auth, gestao];
}
