import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { documento, phone, senha, text } from '../../utils/validation.js';
import { SEGMENTOS } from '../configuracoes/segmentos.js';
import { setRefreshCookie } from '../../security/RefreshTokenManager.js';
import { REFRESH_COOKIE } from '../auth/auth.routes.js';

const cadastroSchema = Joi.object({
  empresa: Joi.object({
    nome: text(150).min(2).required(),
    nomeFantasia: text(150),
    documento: documento(),
    email: Joi.string().trim().lowercase().email().max(160).required(),
    telefone: phone(),
    whatsapp: phone(),
    segmento: Joi.string()
      .valid(...Object.keys(SEGMENTOS))
      .default('OUTRO'),
  }).required(),
  proprietario: Joi.object({
    nome: text(120).min(2).required(),
    email: Joi.string().trim().lowercase().email().max(160).required(),
    senha: senha().required(),
  }).required(),
  modulos: Joi.array().items(Joi.string().trim().uppercase().max(40)).max(20).unique().default([]),
  aceiteTermos: Joi.boolean().valid(true).required().messages({ 'any.only': 'É preciso aceitar os termos de uso.' }),
});

const precoSchema = Joi.object({
  modulos: Joi.array().items(Joi.string().trim().uppercase().max(40)).max(20).unique().default([]),
});

export function publicRoutes({ services, rateLimiters, config }) {
  const { catalogo, cadastro, auth } = services;

  return defineRoutes({
    prefix: '/v1/public',
    tag: 'Público (cadastro)',
    routes: [
      {
        method: 'get',
        path: '/plano',
        public: true,
        summary: 'Plano Start: preço base e módulos opcionais com preço',
        handler: () => catalogo.obterPlano(),
      },
      {
        method: 'get',
        path: '/segmentos',
        public: true,
        summary: 'Segmentos de negócio disponíveis (pet shop, salão, fisioterapia...)',
        handler: () => Object.entries(SEGMENTOS).map(([codigo, s]) => ({ codigo, nome: s.nome, rotulos: s.rotulos })),
      },
      {
        method: 'post',
        path: '/plano/preco',
        public: true,
        summary: 'Simula o preço mensal para os módulos escolhidos',
        validate: { body: precoSchema },
        handler: (req) => catalogo.calcularPreco(req.body.modulos),
      },
      {
        method: 'post',
        path: '/cadastro',
        public: true,
        status: 201,
        summary: 'Cria a empresa (PENDENTE) + proprietário e já devolve a sessão e o link de pagamento',
        middlewares: [rateLimiters.cadastro],
        validate: { body: cadastroSchema },
        handler: async (req, res) => {
          const meta = { ip: req.ip, userAgent: req.get('user-agent') };
          const result = await cadastro.cadastrar(req.body, meta);
          const { refresh, ...sessao } = await auth.iniciarSessao(result.usuarioId, meta);
          setRefreshCookie(res, {
            name: REFRESH_COOKIE,
            path: '/v1/auth',
            isProd: config.isProd,
            domain: config.auth.cookieDomain,
            token: refresh.token,
            expiraEm: refresh.expiraEm,
          });
          const { usuarioId: _u, ...publico } = result;
          return { ...publico, sessao: req.get('x-client') === 'mobile' ? { ...sessao, refreshToken: refresh.token } : sessao };
        },
      },
    ],
  });
}
