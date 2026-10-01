/**
 * Isolamento entre empresas (tenants), RBAC/ABAC e módulos contratados.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { bearer, buildTestApp, criarCliente, criarEmpresaAtiva, criarServico, uniq } from '../helpers/app.js';

let t;
let a;
let b;
beforeAll(async () => {
  t = buildTestApp();
  a = await criarEmpresaAtiva(t);
  b = await criarEmpresaAtiva(t);
});
afterAll(() => t.close());

describe('Isolamento multi-tenant', () => {
  it('empresa B não lê, altera nem exclui dados da empresa A (404, sem revelar existência)', async () => {
    const cliente = await criarCliente(t, a, { nome: 'Cliente da A' });
    await t.api.get(`/v1/clientes/${cliente.id}`).set(b.auth).expect(404);
    await t.api.put(`/v1/clientes/${cliente.id}`).set(b.auth).send({ nome: 'Invadido' }).expect(404);
    await t.api.delete(`/v1/clientes/${cliente.id}`).set(b.auth).expect(404);
    const lista = await t.api.get('/v1/clientes?busca=Cliente da A').set(b.auth).expect(200);
    expect(lista.body.data).toHaveLength(0);
    const original = await t.api.get(`/v1/clientes/${cliente.id}`).set(a.auth).expect(200);
    expect(original.body.data.nome).toBe('Cliente da A');
  });

  it('não permite usar serviço/cliente de outra empresa em atendimento', async () => {
    const servicoA = await criarServico(t, a);
    const clienteB = await criarCliente(t, b);
    const r = await t.api
      .post('/v1/atendimentos')
      .set(b.auth)
      .send({ clienteId: clienteB.id, inicio: '2026-11-02T13:00:00Z', itens: [{ servicoId: servicoA.id }] })
      .expect(422);
    expect(r.body.code).toBe('SERVICO_INVALIDO');
  });

  it('repositório multi-tenant recusa operação sem empresaId', async () => {
    await expect(t.container.repos.clientesRepository.findById(undefined, 'x')).rejects.toThrow(/empresaId é obrigatório/);
  });
});

describe('Módulos contratados', () => {
  it('empresa só com NÚCLEO recebe 403 MODULO_NAO_CONTRATADO em orçamentos/financeiro', async () => {
    const basica = await criarEmpresaAtiva(t, { modulos: [] });
    const r1 = await t.api.get('/v1/orcamentos').set(basica.auth).expect(403);
    expect(r1.body.code).toBe('MODULO_NAO_CONTRATADO');
    await t.api.get('/v1/despesas').set(basica.auth).expect(403);
    await t.api.get('/v1/usuarios').set(basica.auth).expect(403);
    await t.api.get('/v1/clientes').set(basica.auth).expect(200);
  });
});

describe('Papéis (RBAC) e escopo do profissional (ABAC)', () => {
  let ana;
  let anaProf;
  let servico;
  let cliente;

  beforeAll(async () => {
    servico = await criarServico(t, a, { valorCentavos: 10000 });
    cliente = await criarCliente(t, a);
    anaProf = (
      await t.api
        .post('/v1/profissionais')
        .set(a.auth)
        .send({ nome: 'Ana', comissaoBps: 3000, servicoIds: [servico.id] })
        .expect(201)
    ).body.data;
    const email = `ana-${uniq()}@t.com`;
    await t.api
      .post('/v1/usuarios')
      .set(a.auth)
      .send({ nome: 'Ana', email, senha: 'Senha1234', papel: 'PROFISSIONAL', profissionalId: anaProf.id })
      .expect(201);
    const login = await t.api.post('/v1/auth/login').send({ email, senha: 'Senha1234' }).expect(200);
    ana = { auth: bearer(login.body.data.accessToken), permissoes: login.body.data.permissoes };
  });

  it('profissional não acessa financeiro, usuários nem configurações', async () => {
    expect(ana.permissoes).not.toContain('financeiro:ver');
    expect((await t.api.get('/v1/financeiro/resultado?inicio=2026-01-01&fim=2026-01-31').set(ana.auth).expect(403)).body.code).toBe('PERMISSAO_NEGADA');
    await t.api.get('/v1/usuarios').set(ana.auth).expect(403);
    await t.api.get('/v1/configuracoes').set(ana.auth).expect(403);
    await t.api.get('/v1/dashboard').set(ana.auth).expect(403);
  });

  it('profissional só vê e cria atendimentos na própria agenda', async () => {
    const doDono = await t.api
      .post('/v1/atendimentos')
      .set(a.auth)
      .send({ clienteId: cliente.id, inicio: '2026-11-03T13:00:00Z', itens: [{ servicoId: servico.id }] })
      .expect(201);
    await t.api.get(`/v1/atendimentos/${doDono.body.data.id}`).set(ana.auth).expect(404);

    // mesmo pedindo outro profissional, o atendimento vai para a agenda dela
    const dela = await t.api
      .post('/v1/atendimentos')
      .set(ana.auth)
      .send({ clienteId: cliente.id, profissionalId: null, inicio: '2026-11-03T13:00:00Z', itens: [{ servicoId: servico.id }] })
      .expect(201);
    expect(dela.body.data.profissional.id).toBe(anaProf.id);

    const lista = await t.api.get('/v1/atendimentos').set(ana.auth).expect(200);
    expect(lista.body.data.every((x) => x.profissional?.id === anaProf.id)).toBe(true);

    const realizado = await t.api.patch(`/v1/atendimentos/${dela.body.data.id}/status`).set(ana.auth).send({ status: 'REALIZADO' }).expect(200);
    expect(realizado.body.data.comissaoTotalCentavos).toBe(3000);
  });

  it('desativar usuário derruba o acesso imediatamente', async () => {
    const email = `rec-${uniq()}@t.com`;
    const u = await t.api.post('/v1/usuarios').set(a.auth).send({ nome: 'Rec', email, senha: 'Senha1234', papel: 'RECEPCIONISTA' }).expect(201);
    const login = await t.api.post('/v1/auth/login').send({ email, senha: 'Senha1234' }).expect(200);
    const rec = bearer(login.body.data.accessToken);
    await t.api.get('/v1/clientes').set(rec).expect(200);
    await t.api.patch(`/v1/usuarios/${u.body.data.id}`).set(a.auth).send({ ativo: false }).expect(200);
    await t.api.get('/v1/clientes').set(rec).expect(401);
    expect((await t.api.post('/v1/auth/login').send({ email, senha: 'Senha1234' }).expect(403)).body.code).toBe('USUARIO_INATIVO');
  });

  it('não permite remover o último proprietário', async () => {
    const r = await t.api.patch(`/v1/usuarios/${a.usuarioId}`).set(a.auth).send({ ativo: false }).expect(422);
    expect(r.body.code).toBe('ALTERACAO_PROPRIA_PROIBIDA');
  });

  it('respostas nunca expõem hash de senha', async () => {
    const r = await t.api.get('/v1/usuarios').set(a.auth).expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/senhaHash|argon2/);
  });
});
