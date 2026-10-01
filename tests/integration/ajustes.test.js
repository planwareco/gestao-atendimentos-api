/**
 * Ajustes 1.1: informação adicional do cliente e nome exibido no topo do menu.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { buildTestApp, criarEmpresaAtiva } from '../helpers/app.js';

let t;
let emp;

beforeAll(async () => {
  t = buildTestApp();
  emp = await criarEmpresaAtiva(t);
});
afterAll(() => t.close());

describe('Ajustes de cadastro e aparência', () => {
  it('cliente tem "informação adicional" e ela entra na busca', async () => {
    const c = await t.api.post('/v1/clientes').set(emp.auth).send({ nome: 'Jéssica', informacaoAdicional: 'Prefere horário da manhã' }).expect(201);
    expect(c.body.data.informacaoAdicional).toBe('Prefere horário da manhã');
    const busca = await t.api.get('/v1/clientes?busca=manhã').set(emp.auth).expect(200);
    expect(busca.body.data.map((x) => x.id)).toContain(c.body.data.id);
  });

  it('nome exibido no topo (aparencia.nomeSistema) é configurável e volta no /auth/me', async () => {
    await t.api
      .put('/v1/configuracoes')
      .set(emp.auth)
      .send({ aparencia: { nomeSistema: 'Studio Ana' } })
      .expect(200);
    const me = await t.api.get('/v1/auth/me').set(emp.auth).expect(200);
    expect(me.body.data.empresa.aparencia).toMatchObject({ nomeSistema: 'Studio Ana', corPrimaria: '#6D5EF8' });
  });
});
