/**
 * Monta a aplicação real para testes de integração (API + banco de teste),
 * trocando só as integrações externas por dublês via DI.
 */
import request from 'supertest';
import { config as baseConfig } from '../../src/config/env.js';
import { createContainer } from '../../src/container.js';
import { createApp } from '../../src/app.js';
import { createQueueProducer } from '../../src/queue/queues.js';
import { FakeEmailClient, FakePaymentGateway, FakePdfRenderer } from './fakes.js';

export function buildTestApp({ auth = {}, rateLimit = false } = {}) {
  const config = { ...baseConfig, auth: { ...baseConfig.auth, ...auth } };
  const gateway = new FakePaymentGateway();
  const emailClient = new FakeEmailClient();
  const pdfRenderer = new FakePdfRenderer();
  const queue = createQueueProducer({ redisUrl: null });
  const container = createContainer({ config, redis: null, queue, gateway, emailClient, pdfRenderer });
  const app = createApp(container, { disableRateLimit: !rateLimit });
  return { app, api: request(app), container, gateway, emailClient, pdfRenderer, queue, close: () => container.close() };
}

let seq = 0;
export const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const PAGADOR = {
  method: 'PIX',
  payerEmail: 'pagador@teste.com',
  payerFirstName: 'Fulano',
  payerLastName: 'Teste',
  payerDocument: '11144477735',
};

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

/** Cadastra uma empresa, paga a adesão (gateway fake) e faz login do proprietário. */
export async function criarEmpresaAtiva(t, { modulos = ['ORCAMENTOS', 'FINANCEIRO', 'MULTI_PROFISSIONAL'], segmento = 'OUTRO' } = {}) {
  const email = `dono-${uniq()}@teste.com`;
  const senha = 'Senha1234';
  const cad = await t.api
    .post('/v1/public/cadastro')
    .send({ empresa: { nome: `Empresa ${uniq()}`, email, segmento }, proprietario: { nome: 'Dono', email, senha }, modulos, aceiteTermos: true })
    .expect(201);
  const { checkoutToken } = cad.body.data;
  const pay = await t.api.post(`/v1/checkout/${checkoutToken}/payments`).send(PAGADOR).expect(201);
  t.gateway.aprovar(pay.body.data.id);
  await t.api.get(`/v1/checkout/${checkoutToken}/payments/${pay.body.data.id}?syncWithMp=true`).expect(200);
  const login = await t.api.post('/v1/auth/login').send({ email, senha }).expect(200);
  return {
    email,
    senha,
    checkoutToken,
    token: login.body.data.accessToken,
    empresaId: login.body.data.empresa.id,
    usuarioId: login.body.data.usuario.id,
    auth: bearer(login.body.data.accessToken),
  };
}

export async function criarServico(t, emp, body = {}) {
  const r = await t.api
    .post('/v1/servicos')
    .set(emp.auth)
    .send({ nome: `Serviço ${uniq()}`, valorCentavos: 5000, duracaoMinutos: 60, ...body })
    .expect(201);
  return r.body.data;
}

export async function criarCliente(t, emp, body = {}) {
  const r = await t.api
    .post('/v1/clientes')
    .set(emp.auth)
    .send({ nome: `Cliente ${uniq()}`, ...body })
    .expect(201);
  return r.body.data;
}
