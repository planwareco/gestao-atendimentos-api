import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { centavos, idParam, optionalText, pagination, text } from '../../utils/validation.js';

const campos = {
  nome: text(120).min(2),
  descricao: optionalText(500),
  categoria: optionalText(80),
  valorCentavos: centavos(),
  duracaoMinutos: Joi.number().integer().min(5).max(1440),
  status: Joi.string().valid('ATIVO', 'INATIVO'),
};
const criarSchema = Joi.object({
  ...campos,
  nome: campos.nome.required(),
  valorCentavos: campos.valorCentavos.required(),
  duracaoMinutos: campos.duracaoMinutos.required(),
});
const atualizarSchema = Joi.object(campos).min(1);
const listarQuery = Joi.object({
  busca: Joi.string().trim().max(100),
  status: Joi.string().valid('ATIVO', 'INATIVO'),
  categoria: Joi.string().trim().max(80),
  ...pagination,
});

export function servicosRoutes({ services, guards }) {
  const { servicos } = services;
  return defineRoutes({
    prefix: '/v1/servicos',
    tag: 'Serviços',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'servicos:ler',
        summary: 'Lista serviços',
        validate: { query: listarQuery },
        handler: (req) => servicos.listar(req.ctx, req.query),
      },
      { method: 'get', path: '/categorias', permission: 'servicos:ler', summary: 'Categorias em uso', handler: (req) => servicos.categorias(req.ctx) },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'servicos:escrever',
        summary: 'Cadastra serviço (valor em centavos, duração em minutos)',
        validate: { body: criarSchema },
        handler: (req) => servicos.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'servicos:ler',
        summary: 'Detalha serviço',
        validate: { params: idParam },
        handler: (req) => servicos.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'servicos:escrever',
        summary: 'Atualiza serviço',
        validate: { params: idParam, body: atualizarSchema },
        handler: (req) => servicos.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/:id',
        status: 204,
        permission: 'servicos:escrever',
        summary: 'Exclui serviço nunca usado',
        validate: { params: idParam },
        handler: (req) => servicos.remover(req.ctx, req.params.id),
      },
    ],
  });
}
