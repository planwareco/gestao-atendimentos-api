import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { cep, dateOnly, documento, idParam, optionalText, pagination, phone, text, uf } from '../../utils/validation.js';

const campos = {
  nome: text(150).min(2),
  informacaoAdicional: optionalText(500).description('Informação adicional (aparece logo após o nome)'),
  telefone: phone().allow(null),
  whatsapp: phone().allow(null),
  email: Joi.string().trim().lowercase().email().max(160).allow(null),
  documento: documento().allow(null),
  dataNascimento: dateOnly().allow(null),
  cep: cep().allow(null),
  logradouro: optionalText(150),
  numero: optionalText(20),
  complemento: optionalText(100),
  bairro: optionalText(100),
  cidade: optionalText(100),
  estado: uf().allow(null),
  observacoes: optionalText(2000),
  status: Joi.string().valid('ATIVO', 'INATIVO'),
  camposExtras: Joi.object().unknown(true).max(30),
};

const criarSchema = Joi.object({ ...campos, nome: campos.nome.required() });
const atualizarSchema = Joi.object(campos).min(1);
const listarQuery = Joi.object({
  busca: Joi.string().trim().max(100),
  status: Joi.string().valid('ATIVO', 'INATIVO'),
  ordenar: Joi.string().valid('nome', 'recentes').default('nome'),
  ...pagination,
});

export function clientesRoutes({ services, guards }) {
  const { clientes } = services;
  return defineRoutes({
    prefix: '/v1/clientes',
    tag: 'Clientes',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'clientes:ler',
        summary: 'Lista clientes (busca por nome, e-mail, telefone ou documento)',
        validate: { query: listarQuery },
        handler: (req) => clientes.listar(req.ctx, req.query),
      },
      {
        method: 'get',
        path: '/aniversariantes',
        permission: 'clientes:ler',
        summary: 'Aniversariantes dos próximos N dias',
        validate: { query: Joi.object({ dias: Joi.number().integer().min(0).max(60).default(7) }) },
        handler: (req) => clientes.aniversariantes(req.ctx, req.query),
      },
      {
        method: 'get',
        path: '/inativos',
        permission: 'clientes:ler',
        summary: 'Clientes para reativação (sem atendimento realizado há mais de N dias)',
        validate: { query: Joi.object({ dias: Joi.number().integer().min(1).max(730).default(60) }) },
        handler: (req) => clientes.inativos(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'clientes:escrever',
        summary: 'Cadastra cliente',
        validate: { body: criarSchema },
        handler: (req) => clientes.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'clientes:ler',
        summary: 'Detalha cliente',
        validate: { params: idParam },
        handler: (req) => clientes.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'clientes:escrever',
        summary: 'Atualiza cliente',
        validate: { params: idParam, body: atualizarSchema },
        handler: (req) => clientes.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/:id',
        status: 204,
        permission: 'clientes:escrever',
        summary: 'Exclui cliente sem histórico (com histórico: inative)',
        validate: { params: idParam },
        handler: (req) => clientes.remover(req.ctx, req.params.id),
      },
      {
        method: 'get',
        path: '/:id/resumo',
        permission: 'clientes:ler',
        summary: 'Total gasto, ticket médio, frequência, último/próximo atendimento',
        validate: { params: idParam },
        handler: (req) => clientes.resumo(req.ctx, req.params.id),
      },
      {
        method: 'get',
        path: '/:id/historico',
        permission: 'clientes:ler',
        summary: 'Histórico de atendimentos do cliente',
        validate: { params: idParam, query: Joi.object({ status: Joi.string().valid('AGENDADO', 'CONFIRMADO', 'REALIZADO', 'CANCELADO'), ...pagination }) },
        handler: (req) => clientes.historico(req.ctx, req.params.id, req.query),
      },
    ],
  });
}
