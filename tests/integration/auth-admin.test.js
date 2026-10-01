/**
 * Sessões (refresh rotativo), rate limit e área do super admin (2FA, status, módulos).
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { generate } from 'otplib';
import { bearer, buildTestApp, criarEmpresaAtiva, uniq } from '../helpers/app.js';
import { hashPassword } from '../../src/security/password.js';

let t;
beforeAll(() => {
  t = buildTestApp({ auth: { adminRequire2fa: true } });
});
afterAll(() => t.close());

const cookieDe = (res, nome) => res.headers['set-cookie'].find((c) => c.startsWith(`${nome}=`)).split(';')[0];

describe('Sessão do usuário', () => {
  it('refresh rotativo: o token antigo não serve mais e o reuso derruba a sessão inteira', async () => {
    const emp = await criarEmpresaAtiva(t);
    const login = await t.api.post('/v1/auth/login').send({ email: emp.email, senha: emp.senha }).expect(200);
    const c1 = cookieDe(login, 'ga_rt');
    expect(login.body.data.refreshToken).toBeUndefined(); // web: só cookie

    const r1 = await t.api.post('/v1/auth/refresh').set('Cookie', c1).send({}).expect(200);
    const c2 = cookieDe(r1, 'ga_rt');
    expect(c2).not.toBe(c1);

    const reuso = await t.api.post('/v1/auth/refresh').set('Cookie', c1).send({}).expect(401);
    expect(reuso.body.code).toBe('REFRESH_REUTILIZADO');
    await t.api.post('/v1/auth/refresh').set('Cookie', c2).send({}).expect(401);
  });

  it('app mobile recebe o refresh token no corpo (X-Client: mobile)', async () => {
    const emp = await criarEmpresaAtiva(t);
    const r = await t.api.post('/v1/auth/login').set('X-Client', 'mobile').send({ email: emp.email, senha: emp.senha }).expect(200);
    const r2 = await t.api.post('/v1/auth/refresh').set('X-Client', 'mobile').send({ refreshToken: r.body.data.refreshToken }).expect(200);
    expect(r2.body.data.accessToken).toBeDefined();
  });

  it('trocar a senha encerra as outras sessões', async () => {
    const emp = await criarEmpresaAtiva(t);
    const outra = await t.api.post('/v1/auth/login').send({ email: emp.email, senha: emp.senha }).expect(200);
    await t.api.put('/v1/auth/senha').set(emp.auth).send({ senhaAtual: emp.senha, novaSenha: 'NovaSenha99' }).expect(200);
    await t.api.post('/v1/auth/refresh').set('Cookie', cookieDe(outra, 'ga_rt')).send({}).expect(401);
    await t.api.post('/v1/auth/login').send({ email: emp.email, senha: 'NovaSenha99' }).expect(200);
  });

  it('mensagem de credencial inválida não revela se o e-mail existe', async () => {
    const a = await t.api
      .post('/v1/auth/login')
      .send({ email: `nao-existe-${uniq()}@t.com`, senha: 'Qualquer123' })
      .expect(401);
    const emp = await criarEmpresaAtiva(t);
    const b = await t.api.post('/v1/auth/login').send({ email: emp.email, senha: 'Errada1234' }).expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  it('rate limit: bloqueia após 5 tentativas erradas para o mesmo e-mail', async () => {
    const comLimite = buildTestApp({ rateLimit: true });
    try {
      const email = `alvo-${uniq()}@t.com`;
      for (let i = 0; i < 5; i += 1) await comLimite.api.post('/v1/auth/login').send({ email, senha: 'Errada1234' }).expect(401);
      const r = await comLimite.api.post('/v1/auth/login').send({ email, senha: 'Errada1234' }).expect(429);
      expect(r.body.code).toBe('RATE_LIMITED');
      expect(r.headers.ratelimit).toBeDefined();
    } finally {
      await comLimite.close();
    }
  });
});

describe('Super admin', () => {
  let adminToken;
  const email = `admin-${uniq()}@plataforma.com`;
  const senha = 'SenhaAdmin123!';

  beforeAll(async () => {
    await t.container.prisma.admin.create({ data: { nome: 'Admin', email, senhaHash: await hashPassword(senha) } });
  });

  it('exige configurar 2FA e depois pede o código no login', async () => {
    const l1 = await t.api.post('/v1/admin/auth/login').send({ email, senha }).expect(200);
    expect(l1.body.data.mfaConfiguracaoObrigatoria).toBe(true);
    const tk = bearer(l1.body.data.accessToken);
    expect((await t.api.get('/v1/admin/empresas').set(tk).expect(403)).body.code).toBe('MFA_CONFIGURACAO_OBRIGATORIA');

    const cfg = await t.api.post('/v1/admin/auth/2fa/configurar').set(tk).expect(200);
    const { segredo } = cfg.body.data;
    await t.api.post('/v1/admin/auth/2fa/ativar').set(tk).send({ codigo: '000000' }).expect(422);
    await t.api
      .post('/v1/admin/auth/2fa/ativar')
      .set(tk)
      .send({ codigo: await generate({ secret: segredo }) })
      .expect(200);

    const l2 = await t.api.post('/v1/admin/auth/login').send({ email, senha }).expect(200);
    expect(l2.body.data).toMatchObject({ mfaObrigatorio: true });
    expect(l2.body.data.accessToken).toBeUndefined();
    await t.api.post('/v1/admin/auth/2fa/verificar').send({ mfaToken: l2.body.data.mfaToken, codigo: '123456' }).expect(401);
    const ok = await t.api
      .post('/v1/admin/auth/2fa/verificar')
      .send({ mfaToken: l2.body.data.mfaToken, codigo: await generate({ secret: segredo }) })
      .expect(200);
    adminToken = bearer(ok.body.data.accessToken);
    await t.api.get('/v1/admin/empresas').set(adminToken).expect(200);
  });

  it('token de usuário de tenant não acessa a área admin (e vice-versa)', async () => {
    const emp = await criarEmpresaAtiva(t);
    await t.api.get('/v1/admin/empresas').set(emp.auth).expect(401);
    await t.api.get('/v1/clientes').set(adminToken).expect(401);
  });

  it('somente leitura bloqueia escrita; desativar bloqueia tudo e encerra sessões; dados preservados', async () => {
    const emp = await criarEmpresaAtiva(t);
    await t.api.post('/v1/clientes').set(emp.auth).send({ nome: 'Antes' }).expect(201);

    await t.api
      .patch(`/v1/admin/empresas/${emp.empresaId}/status`)
      .set(adminToken)
      .send({ status: 'SOMENTE_LEITURA', motivo: 'Mensalidade atrasada' })
      .expect(200);
    await t.api.get('/v1/clientes').set(emp.auth).expect(200);
    expect((await t.api.post('/v1/clientes').set(emp.auth).send({ nome: 'X' }).expect(403)).body.code).toBe('EMPRESA_SOMENTE_LEITURA');

    const sessao = await t.api.post('/v1/auth/login').send({ email: emp.email, senha: emp.senha }).expect(200);
    await t.api.patch(`/v1/admin/empresas/${emp.empresaId}/status`).set(adminToken).send({ status: 'DESATIVADO' }).expect(200);
    expect((await t.api.get('/v1/clientes').set(emp.auth).expect(403)).body.code).toBe('EMPRESA_DESATIVADA');
    expect((await t.api.post('/v1/auth/login').send({ email: emp.email, senha: emp.senha }).expect(403)).body.code).toBe('EMPRESA_DESATIVADA');
    await t.api.post('/v1/auth/refresh').set('Cookie', cookieDe(sessao, 'ga_rt')).send({}).expect(401);

    await t.api.patch(`/v1/admin/empresas/${emp.empresaId}/status`).set(adminToken).send({ status: 'ATIVO' }).expect(200);
    const lista = await t.api.get('/v1/clientes').set(emp.auth).expect(200);
    expect(lista.body.data.map((c) => c.nome)).toContain('Antes');

    const log = await t.api.get(`/v1/admin/auditoria?empresaId=${emp.empresaId}&acao=EMPRESA_STATUS_ALTERADO`).set(adminToken).expect(200);
    expect(log.body.meta.total).toBe(3);
  });

  it('ligar/desligar módulos muda permissões na hora e recalcula o valor', async () => {
    const emp = await criarEmpresaAtiva(t, { modulos: [] });
    await t.api.get('/v1/orcamentos').set(emp.auth).expect(403);
    const r = await t.api
      .put(`/v1/admin/empresas/${emp.empresaId}/modulos`)
      .set(adminToken)
      .send({ modulos: ['ORCAMENTOS'] })
      .expect(200);
    expect(r.body.data.valorMensalCentavos).toBe(4990 + 1990);
    await t.api.get('/v1/orcamentos').set(emp.auth).expect(200);
  });

  it('altera preço do catálogo para novos cadastros sem afetar quem já contratou', async () => {
    const antes = await criarEmpresaAtiva(t, { modulos: [] });
    await t.api.put('/v1/admin/catalogo/plano').set(adminToken).send({ precoBaseCentavos: 5990 }).expect(200);
    const preco = await t.api.post('/v1/public/plano/preco').send({ modulos: [] }).expect(200);
    expect(preco.body.data.totalCentavos).toBe(5990);
    const det = await t.api.get(`/v1/admin/empresas/${antes.empresaId}`).set(adminToken).expect(200);
    expect(det.body.data.valorMensalCentavos).toBe(4990);
    await t.api.put('/v1/admin/catalogo/plano').set(adminToken).send({ precoBaseCentavos: 4990 }).expect(200);
  });
});
