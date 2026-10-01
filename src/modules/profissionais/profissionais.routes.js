import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { hexColor, id, idParam, pagination, phone, text } from '../../utils/validation.js';

const hhmm = () =>
  Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .messages({ 'string.pattern.base': 'Use HH:mm.' });
const intervalo = Joi.object({ inicio: hhmm().required(), fim: hhmm().required() }).custom((v, h) =>
  v.inicio < v.fim ? v : h.message('Horário inicial deve ser antes do final.'),
);
export const horarioTrabalhoSchema = Joi.object()
  .pattern(Joi.string().valid('0', '1', '2', '3', '4', '5', '6'), Joi.array().items(intervalo).max(6))
  .description('Chaves 0 (domingo) a 6 (sábado). Ex.: {"1":[{"inicio":"08:00","fim":"12:00"},{"inicio":"13:00","fim":"18:00"}]}');

const campos = {
  nome: text(120).min(2),
  email: Joi.string().trim().lowercase().email().max(160).allow(null),
  telefone: phone().allow(null),
  cor: hexColor().allow(null),
  comissaoBps: Joi.number().integer().min(0).max(10_000).description('Comissão em basis points: 4000 = 40%'),
  horarioTrabalho: horarioTrabalhoSchema,
  status: Joi.string().valid('ATIVO', 'INATIVO'),
  usuarioId: id().allow(null).description('Vincula a um usuário (papel PROFISSIONAL vê só a própria agenda)'),
  servicoIds: Joi.array().items(id()).max(200).unique(),
};

export function profissionaisRoutes({ services, guards }) {
  const { profissionais } = services;
  return defineRoutes({
    prefix: '/v1/profissionais',
    tag: 'Profissionais',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'profissionais:ler',
        summary: 'Lista profissionais (filtro por serviço que executa)',
        validate: { query: Joi.object({ status: Joi.string().valid('ATIVO', 'INATIVO'), servicoId: id(), ...pagination }) },
        handler: (req) => profissionais.listar(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'profissionais:escrever',
        summary: 'Cadastra profissional',
        validate: { body: Joi.object({ ...campos, nome: campos.nome.required() }) },
        handler: (req) => profissionais.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'profissionais:ler',
        summary: 'Detalha profissional',
        validate: { params: idParam },
        handler: (req) => profissionais.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'profissionais:escrever',
        summary: 'Atualiza profissional (servicoIds substitui a lista)',
        validate: { params: idParam, body: Joi.object(campos).min(1) },
        handler: (req) => profissionais.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/:id',
        status: 204,
        permission: 'profissionais:escrever',
        summary: 'Exclui profissional sem atendimentos',
        validate: { params: idParam },
        handler: (req) => profissionais.remover(req.ctx, req.params.id),
      },
    ],
  });
}
