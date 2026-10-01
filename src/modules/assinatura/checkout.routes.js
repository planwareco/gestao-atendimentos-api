/**
 * Rotas consumidas pelo PaymentWidget (payment-widget-react).
 *
 * O widget é configurado com:
 *   apiBaseUrl = `${API_URL}/v1/checkout/${checkoutToken}`
 * e chama exatamente o contrato que ele espera:
 *   GET  /config | POST /payments | GET /payments/:id | POST /payments/:id/cancel | GET /payments/:id/receipt
 *
 * O token do link (JWT de 72h) identifica a empresa — funciona sem cookie/header,
 * então o widget não precisa saber nada sobre a autenticação do sistema.
 */
import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { idempotency } from '../../middlewares/idempotency.js';
import { ApiError } from '../../core/ApiError.js';

const tokenParam = Joi.object({ token: Joi.string().max(1000).required() });
const pagamentoParams = tokenParam.keys({ id: Joi.string().trim().max(64).required() });

const METODOS = ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'ACCOUNT_MONEY'];
const CARTAO = ['CREDIT_CARD', 'DEBIT_CARD'];

const pagamentoSchema = Joi.object({
  method: Joi.string()
    .valid(...METODOS)
    .required(),
  payerEmail: Joi.string().trim().email().max(160).required(),
  payerFirstName: Joi.string().trim().max(60).required(),
  payerLastName: Joi.string().trim().max(60).required(),
  payerDocument: Joi.string()
    .trim()
    .replace(/\D/g, '')
    .pattern(/^(\d{11}|\d{14})$/)
    .required(),
  cardToken: Joi.when('method', { is: Joi.valid(...CARTAO), then: Joi.string().max(200).required(), otherwise: Joi.forbidden() }),
  paymentMethodId: Joi.when('method', { is: Joi.valid(...CARTAO), then: Joi.string().max(40).required(), otherwise: Joi.forbidden() }),
  installments: Joi.when('method', { is: Joi.valid(...CARTAO), then: Joi.number().integer().min(1).max(12).default(1), otherwise: Joi.forbidden() }),
  issuerId: Joi.when('method', { is: Joi.valid(...CARTAO), then: Joi.string().max(40), otherwise: Joi.forbidden() }),
  payerAddress: Joi.when('method', {
    is: 'BOLETO',
    then: Joi.object({
      zipCode: Joi.string().trim().replace(/\D/g, '').length(8).required(),
      streetName: Joi.string().trim().max(150).required(),
      streetNumber: Joi.string().trim().max(20).required(),
      neighborhood: Joi.string().trim().max(100).required(),
      city: Joi.string().trim().max(100).required(),
      federalUnit: Joi.string().trim().uppercase().length(2).required(),
    }).required(),
    otherwise: Joi.forbidden(),
  }),
}); // amount/description/externalReference enviados pelo front são DESCARTADOS (stripUnknown)

export function checkoutRoutes({ services, guards, rateLimiters, prisma }) {
  const { assinatura } = services;
  const guard = () => [guards.checkout(), rateLimiters.checkout];

  return defineRoutes({
    prefix: '/v1/checkout/:token',
    tag: 'Checkout (PaymentWidget)',
    guard,
    routes: [
      {
        method: 'get',
        path: '/resumo',
        summary: 'Resumo da adesão: valor calculado no servidor, módulos e public key',
        validate: { params: tokenParam },
        handler: (req) => assinatura.resumo(req.checkout.empresaId),
      },
      {
        method: 'get',
        path: '/config',
        summary: 'Contrato do PaymentWidget: { publicKey }',
        validate: { params: tokenParam },
        handler: () => assinatura.configWidget(),
      },
      {
        method: 'post',
        path: '/payments',
        status: 201,
        summary: 'Cria o pagamento da adesão (aceita header Idempotency-Key)',
        description: 'O valor é definido pelo servidor. Campos `amount`, `description` e `externalReference` enviados pelo widget são ignorados.',
        validate: { params: tokenParam, body: pagamentoSchema },
        middlewares: [idempotency({ prisma, scope: (req) => `checkout:${req.checkout.empresaId}` })],
        handler: (req) => assinatura.criarPagamento(req.checkout.empresaId, req.body),
      },
      {
        method: 'get',
        path: '/payments/:id',
        summary: 'Consulta o pagamento (?syncWithMp=true força consulta ao Mercado Pago). Ativa a empresa quando APPROVED.',
        validate: { params: pagamentoParams, query: Joi.object({ syncWithMp: Joi.boolean().default(false) }) },
        handler: (req) => assinatura.consultarPagamento(req.checkout.empresaId, req.params.id, { sync: req.query.syncWithMp }),
      },
      {
        method: 'post',
        path: '/payments/:id/cancel',
        summary: 'Cancela um pagamento ainda pendente',
        validate: { params: pagamentoParams },
        handler: (req) => assinatura.cancelarPagamento(req.checkout.empresaId, req.params.id),
      },
      {
        method: 'post',
        path: '/payments/:id/refund',
        summary: 'Não disponível no checkout (estornos são feitos pelo admin)',
        validate: { params: pagamentoParams },
        handler: () => {
          throw ApiError.forbidden('Estorno não disponível pelo checkout. Fale com o suporte.', 'ESTORNO_NAO_PERMITIDO');
        },
      },
      {
        method: 'get',
        path: '/payments/:id/receipt',
        summary: 'Comprovante em PDF (somente pagamentos aprovados)',
        binary: 'application/pdf',
        validate: { params: pagamentoParams },
        handler: async (req, res) => {
          const { buffer, contentType } = await assinatura.comprovante(req.checkout.empresaId, req.params.id);
          res.setHeader('Content-Type', contentType ?? 'application/pdf');
          res.setHeader('Content-Disposition', `inline; filename="comprovante-${req.params.id}.pdf"`);
          res.send(buffer);
          return { __raw: true };
        },
      },
    ],
  });
}
