import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { centavos, id, idParam, optionalText, pagination } from '../../utils/validation.js';

const STATUS = ['AGENDADO', 'CONFIRMADO', 'REALIZADO', 'CANCELADO'];
const FORMAS = ['DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO'];

const item = Joi.object({
  servicoId: id().required(),
  quantidade: Joi.number().integer().min(1).max(100).default(1),
  valorUnitarioCentavos: centavos().description('Opcional: sobrescreve o preço do cadastro do serviço'),
});

const campos = {
  clienteId: id(),
  profissionalId: id().allow(null),
  inicio: Joi.date().iso(),
  fim: Joi.date().iso().greater(Joi.ref('inicio')).description('Opcional: padrão = início + soma das durações dos serviços'),
  itens: Joi.array().items(item).min(1).max(30),
  descontoCentavos: centavos(),
  acrescimoCentavos: centavos(),
  observacoes: optionalText(2000),
  encaixe: Joi.boolean().description('true = permite sobrepor outro atendimento no mesmo horário'),
  formaPagamento: Joi.string()
    .valid(...FORMAS)
    .allow(null),
  camposExtras: Joi.object().unknown(true).max(30),
};

const criarSchema = Joi.object({
  ...campos,
  clienteId: campos.clienteId.required(),
  inicio: campos.inicio.required(),
  itens: campos.itens.required(),
  status: Joi.string()
    .valid('AGENDADO', 'CONFIRMADO', 'REALIZADO')
    .default('AGENDADO')
    .description('REALIZADO permite lançar um atendimento já feito (ex.: cliente sem agendamento)'),
});

const statusSchema = Joi.object({
  status: Joi.string()
    .valid(...STATUS)
    .required(),
  motivo: Joi.string().trim().max(300).description('Motivo do cancelamento'),
  formaPagamento: Joi.string()
    .valid(...FORMAS)
    .description('Como o cliente pagou (ao marcar REALIZADO)'),
});

const listarQuery = Joi.object({
  inicio: Joi.date().iso(),
  fim: Joi.date().iso(),
  status: Joi.alternatives(
    Joi.string().valid(...STATUS),
    Joi.array()
      .items(Joi.string().valid(...STATUS))
      .max(4),
  ),
  clienteId: id(),
  profissionalId: id(),
  ...pagination,
});

export function atendimentosRoutes({ services, guards }) {
  const { atendimentos } = services;
  return defineRoutes({
    prefix: '/v1/atendimentos',
    tag: 'Atendimentos',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'atendimentos:ler',
        summary: 'Lista atendimentos (filtros: período, status, cliente, profissional)',
        validate: { query: listarQuery },
        handler: (req) => atendimentos.listar(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'atendimentos:escrever',
        summary: 'Cria atendimento com um ou mais serviços (detecta conflito de agenda)',
        validate: { body: criarSchema },
        handler: (req) => atendimentos.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'atendimentos:ler',
        summary: 'Detalha atendimento',
        validate: { params: idParam },
        handler: (req) => atendimentos.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'atendimentos:escrever',
        summary: 'Edita/remarca atendimento AGENDADO ou CONFIRMADO (itens enviados substituem os atuais)',
        validate: { params: idParam, body: Joi.object(campos).min(1) },
        handler: (req) => atendimentos.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'patch',
        path: '/:id/status',
        permission: 'atendimentos:escrever',
        summary: 'Confirmar, marcar como realizado ou cancelar',
        description:
          'Transições: AGENDADO→CONFIRMADO|REALIZADO|CANCELADO; CONFIRMADO→AGENDADO|REALIZADO|CANCELADO. REALIZADO e CANCELADO são finais. Só REALIZADO entra no faturamento.',
        validate: { params: idParam, body: statusSchema },
        handler: (req) => atendimentos.alterarStatus(req.ctx, req.params.id, req.body),
      },
    ],
  });
}
