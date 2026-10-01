/**
 * Atendimentos, agenda (conflito e concorrência), faturamento e orçamentos.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { buildTestApp, criarCliente, criarEmpresaAtiva, criarServico } from '../helpers/app.js';

let t;
let emp;
let corte;
let escova;
let cliente;

beforeAll(async () => {
  t = buildTestApp();
  emp = await criarEmpresaAtiva(t);
  corte = await criarServico(t, emp, { nome: 'Corte', valorCentavos: 8000, duracaoMinutos: 60 });
  escova = await criarServico(t, emp, { nome: 'Escova', valorCentavos: 3000, duracaoMinutos: 30 });
  cliente = await criarCliente(t, emp, { nome: 'Maria' });
});
afterAll(() => t.close());

const novo = (body) =>
  t.api
    .post('/v1/atendimentos')
    .set(emp.auth)
    .send({ clienteId: cliente.id, itens: [{ servicoId: corte.id }], ...body });

describe('Atendimentos', () => {
  it('calcula total e fim pela duração dos serviços', async () => {
    const r = await novo({ inicio: '2026-12-01T12:00:00Z', itens: [{ servicoId: corte.id }, { servicoId: escova.id }], descontoCentavos: 1000 }).expect(201);
    expect(r.body.data).toMatchObject({ subtotalCentavos: 11000, totalCentavos: 10000, status: 'AGENDADO', fim: '2026-12-01T13:30:00.000Z' });
    expect(r.body.data.itens).toHaveLength(2);
  });

  it('detecta conflito de agenda e permite encaixe explícito', async () => {
    await novo({ inicio: '2026-12-02T12:00:00Z' }).expect(201);
    const conflito = await novo({ inicio: '2026-12-02T12:30:00Z' }).expect(409);
    expect(conflito.body.code).toBe('AGENDA_CONFLITO');
    await novo({ inicio: '2026-12-02T12:30:00Z', encaixe: true }).expect(201);
    await novo({ inicio: '2026-12-02T13:00:00Z', itens: [{ servicoId: escova.id }], encaixe: false }).expect(409);
  });

  it('cancelado libera o horário', async () => {
    const r = await novo({ inicio: '2026-12-03T12:00:00Z' }).expect(201);
    await t.api.patch(`/v1/atendimentos/${r.body.data.id}/status`).set(emp.auth).send({ status: 'CANCELADO', motivo: 'Cliente desmarcou' }).expect(200);
    await novo({ inicio: '2026-12-03T12:00:00Z' }).expect(201);
  });

  it('CONCORRÊNCIA: 6 pedidos simultâneos para o mesmo horário -> só 1 é aceito', async () => {
    const respostas = await Promise.all(Array.from({ length: 6 }, () => novo({ inicio: '2026-12-04T15:00:00Z' })));
    const status = respostas.map((r) => r.status).sort();
    expect(status.filter((s) => s === 201)).toHaveLength(1);
    expect(status.filter((s) => s === 409)).toHaveLength(5);
  });

  it('respeita a máquina de estados', async () => {
    const r = await novo({ inicio: '2026-12-05T12:00:00Z' }).expect(201);
    const id = r.body.data.id;
    await t.api.patch(`/v1/atendimentos/${id}/status`).set(emp.auth).send({ status: 'REALIZADO', formaPagamento: 'PIX' }).expect(200);
    const invalido = await t.api.patch(`/v1/atendimentos/${id}/status`).set(emp.auth).send({ status: 'CANCELADO' }).expect(422);
    expect(invalido.body.code).toBe('TRANSICAO_INVALIDA');
    const edit = await t.api.put(`/v1/atendimentos/${id}`).set(emp.auth).send({ observacoes: 'x' }).expect(422);
    expect(edit.body.code).toBe('ATENDIMENTO_NAO_EDITAVEL');
  });

  it('remarcar recalcula o fim e checa conflito ignorando o próprio atendimento', async () => {
    const r = await novo({ inicio: '2026-12-06T12:00:00Z' }).expect(201);
    const upd = await t.api.put(`/v1/atendimentos/${r.body.data.id}`).set(emp.auth).send({ inicio: '2026-12-06T12:30:00Z' }).expect(200);
    expect(upd.body.data.fim).toBe('2026-12-06T13:30:00.000Z');
  });
});

describe('Faturamento: só REALIZADO conta', () => {
  it('dashboard, financeiro e resumo do cliente usam a mesma regra', async () => {
    const e = await criarEmpresaAtiva(t);
    const s = await criarServico(t, e, { valorCentavos: 10000, duracaoMinutos: 30 });
    const c = await criarCliente(t, e);
    const criar = (inicio) =>
      t.api
        .post('/v1/atendimentos')
        .set(e.auth)
        .send({ clienteId: c.id, inicio, itens: [{ servicoId: s.id }] })
        .expect(201);

    const a1 = await criar('2026-03-10T13:00:00Z');
    const a2 = await criar('2026-03-11T13:00:00Z');
    const a3 = await criar('2026-03-12T13:00:00Z');
    await criar('2026-03-13T13:00:00Z'); // fica AGENDADO
    await t.api.patch(`/v1/atendimentos/${a1.body.data.id}/status`).set(e.auth).send({ status: 'REALIZADO' }).expect(200);
    await t.api.patch(`/v1/atendimentos/${a2.body.data.id}/status`).set(e.auth).send({ status: 'CONFIRMADO' }).expect(200);
    await t.api.patch(`/v1/atendimentos/${a3.body.data.id}/status`).set(e.auth).send({ status: 'CANCELADO' }).expect(200);

    const dash = await t.api.get('/v1/dashboard?ano=2026&mes=3').set(e.auth).expect(200);
    expect(dash.body.data.indicadores).toMatchObject({
      entradasCentavos: 10000,
      atendimentosRealizados: 1,
      atendimentosAgendados: 2,
      atendimentosCancelados: 1,
      ticketMedioCentavos: 10000,
    });
    expect(dash.body.data.graficos.entradasSaidasPorMes[2].entradasCentavos).toBe(10000);

    const cat = (await t.api.get('/v1/despesas/categorias').set(e.auth).expect(200)).body.data[0];
    await t.api.post('/v1/despesas').set(e.auth).send({ categoriaId: cat.id, descricao: 'Material', valorCentavos: 2500, data: '2026-03-15' }).expect(201);

    const fin = await t.api.get('/v1/financeiro/resultado?inicio=2026-03-01&fim=2026-03-31').set(e.auth).expect(200);
    expect(fin.body.data).toMatchObject({ faturamentoBrutoCentavos: 10000, despesasCentavos: 2500, resultadoCentavos: 7500 });

    // cache do dashboard é invalidado quando entra despesa
    const dash2 = await t.api.get('/v1/dashboard?ano=2026&mes=3').set(e.auth).expect(200);
    expect(dash2.body.data.indicadores.despesasCentavos).toBe(2500);

    const resumo = await t.api.get(`/v1/clientes/${c.id}/resumo`).set(e.auth).expect(200);
    expect(resumo.body.data).toMatchObject({ totalGastoCentavos: 10000, atendimentosRealizados: 1, atendimentosCancelados: 1 });
  });
});

describe('Orçamentos', () => {
  it('numeração sequencial por empresa mesmo com criação simultânea', async () => {
    const e = await criarEmpresaAtiva(t);
    const c = await criarCliente(t, e);
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.api
          .post('/v1/orcamentos')
          .set(e.auth)
          .send({ clienteId: c.id, itens: [{ descricao: 'Avulso', valorUnitarioCentavos: 1000 }] }),
      ),
    );
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(rs.map((r) => r.body.data.numero).sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it('aprovado vira atendimento uma única vez', async () => {
    const o = await t.api
      .post('/v1/orcamentos')
      .set(emp.auth)
      .send({ clienteId: cliente.id, descontoCentavos: 500, itens: [{ servicoId: corte.id, quantidade: 1 }] })
      .expect(201);
    expect(o.body.data.totalCentavos).toBe(7500);
    await t.api.post(`/v1/orcamentos/${o.body.data.id}/converter`).set(emp.auth).send({ inicio: '2026-12-20T12:00:00Z' }).expect(422);
    await t.api.patch(`/v1/orcamentos/${o.body.data.id}/status`).set(emp.auth).send({ status: 'APROVADO' }).expect(200);
    const at = await t.api.post(`/v1/orcamentos/${o.body.data.id}/converter`).set(emp.auth).send({ inicio: '2026-12-20T12:00:00Z' }).expect(201);
    expect(at.body.data).toMatchObject({ totalCentavos: 7500, orcamentoId: o.body.data.id });
    const denovo = await t.api.post(`/v1/orcamentos/${o.body.data.id}/converter`).set(emp.auth).send({ inicio: '2026-12-21T12:00:00Z' }).expect(409);
    expect(denovo.body.code).toBe('ORCAMENTO_JA_CONVERTIDO');
  });

  it('PDF: 202 enquanto gera na fila, 200 quando pronto, e só regera se o orçamento mudar', async () => {
    const o = await t.api
      .post('/v1/orcamentos')
      .set(emp.auth)
      .send({ clienteId: cliente.id, itens: [{ servicoId: escova.id }] })
      .expect(201);
    const url = `/v1/orcamentos/${o.body.data.id}/pdf`;
    await t.api.get(url).set(emp.auth).expect(202);
    await t.queue.drain();
    const pdf = await t.api.get(url).set(emp.auth).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const antes = t.pdfRenderer.renderizados;
    await t.api.get(url).set(emp.auth).expect(200);
    expect(t.pdfRenderer.renderizados).toBe(antes);

    await t.api.put(`/v1/orcamentos/${o.body.data.id}`).set(emp.auth).send({ observacoes: 'Nova condição' }).expect(200);
    await t.api.get(url).set(emp.auth).expect(202);
  });
});
