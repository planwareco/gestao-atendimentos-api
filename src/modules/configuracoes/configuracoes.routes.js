import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { cep, documento, hexColor, optionalText, phone, text, uf } from '../../utils/validation.js';
import { SEGMENTOS } from './segmentos.js';
import { camposPersonalizadosSchema } from './camposExtras.js';

const atualizarSchema = Joi.object({
  nome: text(150).min(2),
  nomeFantasia: optionalText(150),
  documento: documento().allow(null),
  email: Joi.string().trim().lowercase().email().max(160),
  telefone: phone().allow(null),
  whatsapp: phone().allow(null),
  segmento: Joi.string().valid(...Object.keys(SEGMENTOS)),
  fusoHorario: Joi.string()
    .trim()
    .max(60)
    .custom((v, helpers) => {
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: v });
        return v;
      } catch {
        return helpers.error('any.invalid');
      }
    }),
  endereco: Joi.object({
    cep: cep(),
    logradouro: text(150),
    numero: text(20),
    complemento: optionalText(100),
    bairro: text(100),
    cidade: text(100),
    estado: uf(),
  }).allow(null),
  aparencia: Joi.object({
    nomeSistema: Joi.string().trim().max(40).allow(null).description('Nome exibido no topo do menu, junto da logo (null = nome da empresa)'),
    corPrimaria: hexColor(),
    corSecundaria: hexColor(),
    tema: Joi.string().valid('claro', 'escuro'),
    logoUrl: Joi.string()
      .uri({ scheme: ['https'] })
      .max(500)
      .allow(null),
    faviconUrl: Joi.string()
      .uri({ scheme: ['https'] })
      .max(500)
      .allow(null),
  }),
  camposPersonalizados: camposPersonalizadosSchema,
  aplicarPresetSegmento: Joi.boolean().default(false),
}).min(1);

export function configuracoesRoutes({ services, guards }) {
  const { configuracoes } = services;
  return defineRoutes({
    prefix: '/v1/configuracoes',
    tag: 'Configurações',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'configuracoes:gerenciar',
        summary: 'Dados, aparência, segmento e campos personalizados da empresa',
        handler: (req) => configuracoes.obter(req.ctx),
      },
      {
        method: 'put',
        path: '/',
        permission: 'configuracoes:gerenciar',
        summary: 'Atualiza dados da empresa, cores/logo e campos personalizados',
        validate: { body: atualizarSchema },
        handler: (req) => configuracoes.atualizar(req.ctx, req.body),
      },
    ],
  });
}
