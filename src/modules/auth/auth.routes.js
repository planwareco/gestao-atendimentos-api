import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { senha } from '../../utils/validation.js';
import { clearRefreshCookie, setRefreshCookie } from '../../security/RefreshTokenManager.js';

export const REFRESH_COOKIE = 'ga_rt';
const COOKIE_PATH = '/v1/auth';

const loginSchema = Joi.object({
  email: Joi.string().trim().lowercase().email().max(160).required(),
  senha: Joi.string().max(72).required(),
});
const refreshSchema = Joi.object({ refreshToken: Joi.string().max(200) });
const senhaSchema = Joi.object({ senhaAtual: Joi.string().max(72).required(), novaSenha: senha().required() });

export function authRoutes({ services, guards, rateLimiters, config }) {
  const { auth } = services;
  const cookieOpts = { name: REFRESH_COOKIE, path: COOKIE_PATH, isProd: config.isProd, domain: config.auth.cookieDomain };
  const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });
  // Apps mobile (Expo) não usam cookie: com `X-Client: mobile` o refresh token volta no corpo.
  const isMobile = (req) => req.get('x-client') === 'mobile';

  const responderSessao = (req, res, { refresh, ...sessao }) => {
    setRefreshCookie(res, { ...cookieOpts, token: refresh.token, expiraEm: refresh.expiraEm });
    return isMobile(req) ? { ...sessao, refreshToken: refresh.token, refreshExpiraEm: refresh.expiraEm } : sessao;
  };

  return defineRoutes({
    prefix: '/v1/auth',
    tag: 'Auth',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'post',
        path: '/login',
        public: true,
        summary: 'Login (e-mail + senha). Refresh token vai em cookie httpOnly.',
        middlewares: [rateLimiters.loginIp, rateLimiters.loginEmail],
        validate: { body: loginSchema },
        handler: async (req, res) => responderSessao(req, res, await auth.login(req.body, meta(req))),
      },
      {
        method: 'post',
        path: '/refresh',
        public: true,
        summary: 'Renova o access token (rotação do refresh token)',
        validate: { body: refreshSchema },
        handler: async (req, res) => {
          const token = req.cookies?.[REFRESH_COOKIE] ?? req.body.refreshToken;
          try {
            return responderSessao(req, res, await auth.refresh(token, meta(req)));
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
        summary: 'Encerra a sessão atual',
        validate: { body: refreshSchema },
        handler: async (req, res) => {
          await auth.logout(req.cookies?.[REFRESH_COOKIE] ?? req.body.refreshToken);
          clearRefreshCookie(res, cookieOpts);
          return { message: 'Sessão encerrada.' };
        },
      },
      {
        method: 'get',
        path: '/me',
        allowPending: true,
        summary: 'Perfil do usuário logado, empresa, módulos e permissões efetivas',
        handler: (req) => auth.perfil(req.ctx.usuarioId),
      },
      {
        method: 'put',
        path: '/senha',
        summary: 'Alterar a própria senha (encerra as outras sessões)',
        validate: { body: senhaSchema },
        handler: (req) => auth.alterarSenha(req.ctx, req.body),
      },
      {
        method: 'post',
        path: '/checkout-link',
        allowPending: true,
        summary: 'Gera novo link de pagamento da adesão (empresa PENDENTE)',
        handler: (req) => auth.linkCheckout(req.ctx),
      },
    ],
  });
}
