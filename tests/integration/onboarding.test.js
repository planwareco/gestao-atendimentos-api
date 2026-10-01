/**
 * Fluxo crítico do SaaS: cadastro -> pagamento da adesão -> ativação.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PAGADOR, bearer, buildTestApp, uniq } from '../helpers/app.js';

let t;
beforeAll(() => {
  t = buildTestApp();
});
afterAll(() => t.close());

async function cadastrar(modulos = ['FINANCEIRO']) {
  const email = `dono-${uniq()}@teste.com`;
  const r = await t.api.post('/v1/public/cadastro').send({
    empresa: { nome: 'Studio Ana', email, segmento: 'SALAO_BELEZA' },
    proprietario: { nome: 'Ana', email, senha: 'Senha1234' },
    modulos,
    aceiteTermos: true,
  });
  return { r, email };
}

describe('Onboarding SaaS', () => {
  it('calcula o preço: base + módulos escolhidos (núcleo sempre incluso)', async () => {
    const r = await t.api
      .post('/v1/public/plano/preco')
      .send({ modulos: ['ORCAMENTOS', 'FINANCEIRO'] })
      .expect(200);
    expect(r.body.data.totalCentavos).toBe(4990 + 1990 + 1990);
    expect(r.body.data.modulos.map((m) => m.codigo)).toEqual(expect.arrayContaining(['NUCLEO', 'ORCAMENTOS', 'FINANCEIRO']));
  });

  it('rejeita módulo inexistente e cadastro sem aceite dos termos', async () => {
    await t.api
      .post('/v1/public/plano/preco')
      .send({ modulos: ['XPTO'] })
      .expect(422);
    const email = `x-${uniq()}@t.com`;
    await t.api
      .post('/v1/public/cadastro')
      .send({ empresa: { nome: 'X', email }, proprietario: { nome: 'X', email, senha: 'Senha1234' } })
      .expect(422);
  });

  it('cria empresa PENDENTE, bloqueia o sistema com 402 e não cobra valor enviado pelo cliente', async () => {
    const { r, email } = await cadastrar(['FINANCEIRO']);
    expect(r.status).toBe(201);
    expect(r.body.data.empresa.status).toBe('PENDENTE');
    expect(r.headers['set-cookie'].join(';')).toMatch(/ga_rt=.*HttpOnly/);
    const token = r.body.data.sessao.accessToken;

    const bloqueado = await t.api.get('/v1/clientes').set(bearer(token)).expect(402);
    expect(bloqueado.body.code).toBe('ASSINATURA_PENDENTE');
    await t.api.get('/v1/auth/me').set(bearer(token)).expect(200);

    const { checkoutToken } = r.body.data;
    const pay = await t.api
      .post(`/v1/checkout/${checkoutToken}/payments`)
      .send({ ...PAGADOR, amount: 0.01, description: 'hack', externalReference: 'outra-empresa' })
      .expect(201);
    const enviado = t.gateway.calls.find((c) => c.op === 'create').payload;
    expect(enviado.amount).toBe(69.8); // 4990 + 1990 centavos — calculado no servidor
    expect(enviado.externalReference).toMatch(/^adesao:/);
    expect(pay.body.data.pix.qrCode).toBeDefined();

    // ainda pendente
    await t.api.get(`/v1/checkout/${checkoutToken}/payments/${pay.body.data.id}`).expect(200);
    await t.api.get('/v1/clientes').set(bearer(token)).expect(402);

    // aprovado -> ativa (idempotente: consultar de novo não ativa duas vezes)
    t.gateway.aprovar(pay.body.data.id);
    await t.api.get(`/v1/checkout/${checkoutToken}/payments/${pay.body.data.id}?syncWithMp=true`).expect(200);
    await t.api.get(`/v1/checkout/${checkoutToken}/payments/${pay.body.data.id}?syncWithMp=true`).expect(200);
    await t.api.get('/v1/clientes').set(bearer(token)).expect(200);

    const auditoria = await t.container.prisma.logAuditoria.count({ where: { empresaId: r.body.data.empresa.id, acao: 'ASSINATURA_ATIVADA' } });
    expect(auditoria).toBe(1);

    await t.queue.drain();
    expect(t.emailClient.enviados.map((e) => e.to)).toEqual(expect.arrayContaining([email]));
    expect(t.emailClient.enviados.some((e) => /confirmado/i.test(e.subject))).toBe(true);

    // não permite pagar de novo
    const denovo = await t.api.post(`/v1/checkout/${checkoutToken}/payments`).send(PAGADOR).expect(409);
    expect(denovo.body.code).toBe('ASSINATURA_JA_ATIVA');
  });

  it('cartão aprovado na hora ativa imediatamente', async () => {
    const { r } = await cadastrar([]);
    const { checkoutToken } = r.body.data;
    await t.api
      .post(`/v1/checkout/${checkoutToken}/payments`)
      .send({ ...PAGADOR, method: 'CREDIT_CARD', cardToken: 'tok_123', paymentMethodId: 'visa', installments: 1 })
      .expect(201);
    const me = await t.api.get('/v1/auth/me').set(bearer(r.body.data.sessao.accessToken)).expect(200);
    expect(me.body.data.empresa.status).toBe('ATIVO');
  });

  it('valida campos por método (cartão exige cardToken; boleto exige endereço)', async () => {
    const { r } = await cadastrar([]);
    const { checkoutToken } = r.body.data;
    await t.api
      .post(`/v1/checkout/${checkoutToken}/payments`)
      .send({ ...PAGADOR, method: 'CREDIT_CARD' })
      .expect(422);
    await t.api
      .post(`/v1/checkout/${checkoutToken}/payments`)
      .send({ ...PAGADOR, method: 'BOLETO' })
      .expect(422);
  });

  it('Idempotency-Key: mesma chave devolve a mesma resposta; corpo diferente é rejeitado', async () => {
    const { r } = await cadastrar([]);
    const { checkoutToken } = r.body.data;
    const a = await t.api.post(`/v1/checkout/${checkoutToken}/payments`).set('Idempotency-Key', 'chave-1').send(PAGADOR).expect(201);
    await new Promise((res) => setTimeout(res, 50));
    const b = await t.api.post(`/v1/checkout/${checkoutToken}/payments`).set('Idempotency-Key', 'chave-1').send(PAGADOR).expect(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    const c = await t.api
      .post(`/v1/checkout/${checkoutToken}/payments`)
      .set('Idempotency-Key', 'chave-1')
      .send({ ...PAGADOR, payerFirstName: 'Outro' })
      .expect(422);
    expect(c.body.code).toBe('IDEMPOTENCY_KEY_REUTILIZADA');
  });

  it('uma empresa não consulta pagamento de outra; token de checkout adulterado é recusado', async () => {
    const e1 = await cadastrar([]);
    const e2 = await cadastrar([]);
    const pay = await t.api.post(`/v1/checkout/${e1.r.body.data.checkoutToken}/payments`).send(PAGADOR).expect(201);
    await t.api.get(`/v1/checkout/${e2.r.body.data.checkoutToken}/payments/${pay.body.data.id}`).expect(404);
    const r = await t.api.get(`/v1/checkout/${e1.r.body.data.checkoutToken}x/resumo`).expect(401);
    expect(r.body.code).toBe('CHECKOUT_INVALIDO');
  });

  it('job de reconciliação ativa empresa quando o usuário fechou a aba', async () => {
    const { r } = await cadastrar([]);
    const pay = await t.api.post(`/v1/checkout/${r.body.data.checkoutToken}/payments`).send(PAGADOR).expect(201);
    t.gateway.aprovar(pay.body.data.id);
    const res = await t.container.services.assinatura.reconciliarPendentes();
    expect(res.ativadas).toBeGreaterThanOrEqual(1);
    const empresa = await t.container.prisma.empresa.findUnique({ where: { id: r.body.data.empresa.id }, select: { status: true } });
    expect(empresa.status).toBe('ATIVO');
  });

  it('e-mail já cadastrado retorna 409', async () => {
    const { email } = await cadastrar([]);
    const r = await t.api
      .post('/v1/public/cadastro')
      .send({ empresa: { nome: 'Outra', email }, proprietario: { nome: 'Xavier', email, senha: 'Senha1234' }, aceiteTermos: true })
      .expect(409);
    expect(r.body.code).toBe('EMAIL_EM_USO');
  });
});
