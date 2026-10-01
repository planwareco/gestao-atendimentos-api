import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { dateOnly, hexColor, id, idParam, optionalText, pagination, text } from '../../utils/validation.js';

const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO'];
const campos = {
  categoriaId: id(),
  descricao: text(150).min(2),
  valorCentavos: Joi.number().integer().min(1).max(100_000_000),
  data: dateOnly(),
  formaPagamento: Joi.string()
    .valid(...FORMAS)
    .allow(null),
  observacao: optionalText(1000),
  status: Joi.string().valid('PENDENTE', 'PAGA'),
};
const categoria = { nome: text(60).min(2), cor: hexColor().allow(null), ativo: Joi.boolean() };

export function despesasRoutes({ services, guards }) {
  const { despesas } = services;
  return defineRoutes({
    prefix: '/v1/despesas',
    tag: 'Despesas',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/categorias',
        permission: 'despesas:ler',
        summary: 'Categorias de despesa',
        validate: { query: Joi.object({ incluirInativas: Joi.boolean().default(false) }) },
        handler: (req) => despesas.listarCategorias(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/categorias',
        status: 201,
        permission: 'despesas:escrever',
        summary: 'Cria categoria',
        validate: { body: Joi.object({ ...categoria, nome: categoria.nome.required() }) },
        handler: (req) => despesas.criarCategoria(req.ctx, req.body),
      },
      {
        method: 'put',
        path: '/categorias/:id',
        permission: 'despesas:escrever',
        summary: 'Atualiza categoria',
        validate: { params: idParam, body: Joi.object(categoria).min(1) },
        handler: (req) => despesas.atualizarCategoria(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/categorias/:id',
        status: 204,
        permission: 'despesas:escrever',
        summary: 'Exclui categoria sem despesas',
        validate: { params: idParam },
        handler: (req) => despesas.removerCategoria(req.ctx, req.params.id),
      },
      {
        method: 'get',
        path: '/',
        permission: 'despesas:ler',
        summary: 'Lista despesas (meta.totalValorCentavos = soma do filtro)',
        validate: {
          query: Joi.object({
            inicio: dateOnly(),
            fim: dateOnly(),
            categoriaId: id(),
            status: Joi.string().valid('PENDENTE', 'PAGA'),
            busca: Joi.string().trim().max(100),
            ...pagination,
          }),
        },
        handler: (req) => despesas.listar(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'despesas:escrever',
        summary: 'Lança despesa',
        validate: {
          body: Joi.object({
            ...campos,
            categoriaId: campos.categoriaId.required(),
            descricao: campos.descricao.required(),
            valorCentavos: campos.valorCentavos.required(),
            data: campos.data.required(),
          }),
        },
        handler: (req) => despesas.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'despesas:ler',
        summary: 'Detalha despesa',
        validate: { params: idParam },
        handler: (req) => despesas.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'despesas:escrever',
        summary: 'Atualiza despesa',
        validate: { params: idParam, body: Joi.object(campos).min(1) },
        handler: (req) => despesas.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/:id',
        status: 204,
        permission: 'despesas:escrever',
        summary: 'Exclui despesa',
        validate: { params: idParam },
        handler: (req) => despesas.remover(req.ctx, req.params.id),
      },
    ],
  });
}
