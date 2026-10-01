import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { centavos, dateOnly, id, idParam, optionalText, pagination } from '../../utils/validation.js';
import { sendSuccess } from '../../core/http.js';

const item = Joi.object({
  servicoId: id(),
  descricao: Joi.string().trim().max(150).when('servicoId', { is: Joi.exist(), otherwise: Joi.required() }),
  quantidade: Joi.number().integer().min(1).max(1000).default(1),
  valorUnitarioCentavos: centavos().when('servicoId', { is: Joi.exist(), otherwise: Joi.required() }),
});

const campos = {
  clienteId: id(),
  data: dateOnly(),
  validade: dateOnly().allow(null),
  observacoes: optionalText(2000),
  descontoCentavos: centavos(),
  acrescimoCentavos: centavos(),
  itens: Joi.array().items(item).min(1).max(100),
};

export function orcamentosRoutes({ services, guards }) {
  const { orcamentos } = services;
  return defineRoutes({
    prefix: '/v1/orcamentos',
    tag: 'Orçamentos',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'orcamentos:ler',
        summary: 'Lista orçamentos',
        validate: {
          query: Joi.object({
            status: Joi.string().valid('RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'EXPIRADO'),
            clienteId: id(),
            numero: Joi.number().integer().min(1),
            ...pagination,
          }),
        },
        handler: (req) => orcamentos.listar(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'orcamentos:escrever',
        summary: 'Cria orçamento (número sequencial automático)',
        validate: { body: Joi.object({ ...campos, clienteId: campos.clienteId.required(), itens: campos.itens.required() }) },
        handler: (req) => orcamentos.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'orcamentos:ler',
        summary: 'Detalha orçamento',
        validate: { params: idParam },
        handler: (req) => orcamentos.obter(req.ctx, req.params.id),
      },
      {
        method: 'put',
        path: '/:id',
        permission: 'orcamentos:escrever',
        summary: 'Edita orçamento em RASCUNHO/ENVIADO (itens enviados substituem os atuais)',
        validate: { params: idParam, body: Joi.object(campos).min(1) },
        handler: (req) => orcamentos.atualizar(req.ctx, req.params.id, req.body),
      },
      {
        method: 'patch',
        path: '/:id/status',
        permission: 'orcamentos:escrever',
        summary: 'Enviar, aprovar ou recusar',
        validate: { params: idParam, body: Joi.object({ status: Joi.string().valid('RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO').required() }) },
        handler: (req) => orcamentos.alterarStatus(req.ctx, req.params.id, req.body),
      },
      {
        method: 'delete',
        path: '/:id',
        status: 204,
        permission: 'orcamentos:escrever',
        summary: 'Exclui rascunho',
        validate: { params: idParam },
        handler: (req) => orcamentos.remover(req.ctx, req.params.id),
      },
      {
        method: 'post',
        path: '/:id/converter',
        status: 201,
        permission: ['orcamentos:escrever'],
        summary: 'Converte orçamento APROVADO em atendimento na agenda',
        validate: {
          params: idParam,
          body: Joi.object({ inicio: Joi.date().iso().required(), profissionalId: id().allow(null), encaixe: Joi.boolean(), observacoes: optionalText(2000) }),
        },
        handler: (req) => orcamentos.converter(req.ctx, req.params.id, req.body),
      },
      {
        method: 'get',
        path: '/:id/pdf',
        permission: 'orcamentos:ler',
        binary: 'application/pdf',
        summary: 'PDF do orçamento (200 = arquivo; 202 = gerando, tente de novo em ~2s)',
        description: 'A geração roda na fila (Puppeteer). O PDF fica guardado e só é refeito quando o orçamento ou a identidade visual mudam.',
        validate: { params: idParam },
        handler: async (req, res) => {
          const r = await orcamentos.pdf(req.ctx, req.params.id);
          if (!r.pronto) {
            res.setHeader('Retry-After', '2');
            sendSuccess(res, { status: 202, data: { status: 'PROCESSANDO' }, message: 'O PDF está sendo gerado.' });
            return { __raw: true };
          }
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="orcamento-${req.params.id}.pdf"`);
          res.setHeader('Last-Modified', new Date(r.geradoEm).toUTCString());
          res.send(Buffer.from(r.conteudo));
          return { __raw: true };
        },
      },
    ],
  });
}
