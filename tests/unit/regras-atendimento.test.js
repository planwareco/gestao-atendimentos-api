import { describe, expect, it } from '@jest/globals';
import {
  assertTransicao,
  calcularAtendimento,
  calcularComissoes,
  calcularHorariosLivres,
  montarItens,
  sobrepoe,
} from '../../src/modules/atendimentos/regras.js';

const servicos = new Map([
  ['s1', { id: 's1', nome: 'Corte', valorCentavos: 8000, duracaoMinutos: 60, status: 'ATIVO' }],
  ['s2', { id: 's2', nome: 'Escova', valorCentavos: 3000, duracaoMinutos: 30, status: 'ATIVO' }],
  ['s3', { id: 's3', nome: 'Antigo', valorCentavos: 1000, duracaoMinutos: 15, status: 'INATIVO' }],
]);

describe('montarItens', () => {
  it('usa preço e nome do cadastro do serviço', () => {
    const itens = montarItens([{ servicoId: 's1' }, { servicoId: 's2', quantidade: 2 }], servicos);
    expect(itens).toEqual([
      { servicoId: 's1', descricao: 'Corte', quantidade: 1, valorUnitarioCentavos: 8000, duracaoMinutos: 60 },
      { servicoId: 's2', descricao: 'Escova', quantidade: 2, valorUnitarioCentavos: 3000, duracaoMinutos: 30 },
    ]);
  });

  it('permite sobrescrever o valor unitário', () => {
    const [item] = montarItens([{ servicoId: 's1', valorUnitarioCentavos: 7000 }], servicos);
    expect(item.valorUnitarioCentavos).toBe(7000);
  });

  it('rejeita serviço inexistente ou inativo', () => {
    expect(() => montarItens([{ servicoId: 'x' }], servicos)).toThrow(expect.objectContaining({ code: 'SERVICO_INVALIDO' }));
    expect(() => montarItens([{ servicoId: 's3' }], servicos)).toThrow(expect.objectContaining({ code: 'SERVICO_INATIVO' }));
  });
});

describe('calcularAtendimento', () => {
  it('soma itens, aplica desconto/acréscimo e calcula a duração total', () => {
    const itens = montarItens([{ servicoId: 's1' }, { servicoId: 's2', quantidade: 2 }], servicos);
    const r = calcularAtendimento(itens, { descontoCentavos: 1000, acrescimoCentavos: 500 });
    expect(r.subtotalCentavos).toBe(14000);
    expect(r.totalCentavos).toBe(13500);
    expect(r.duracaoTotalMinutos).toBe(120);
  });

  it('não permite desconto maior que o subtotal', () => {
    const itens = montarItens([{ servicoId: 's2' }], servicos);
    expect(() => calcularAtendimento(itens, { descontoCentavos: 5000 })).toThrow(expect.objectContaining({ code: 'DESCONTO_INVALIDO' }));
  });
});

describe('calcularComissoes', () => {
  it('aplica o percentual do profissional proporcional ao valor cobrado (desconto rateado)', () => {
    const itens = [{ totalCentavos: 8000 }, { totalCentavos: 2000 }];
    // subtotal 10.000, total 9.000 (10% de desconto), comissão 40%
    const r = calcularComissoes(itens, { subtotalCentavos: 10000, totalCentavos: 9000 }, 4000);
    expect(r.map((i) => i.comissaoCentavos)).toEqual([2880, 720]);
  });

  it('sem percentual = comissão zero', () => {
    expect(calcularComissoes([{ totalCentavos: 100 }], { subtotalCentavos: 100, totalCentavos: 100 }, 0)[0].comissaoCentavos).toBe(0);
  });
});

describe('máquina de estados', () => {
  it.each([
    ['AGENDADO', 'CONFIRMADO'],
    ['AGENDADO', 'REALIZADO'],
    ['AGENDADO', 'CANCELADO'],
    ['CONFIRMADO', 'REALIZADO'],
    ['CONFIRMADO', 'AGENDADO'],
  ])('%s -> %s é permitido', (de, para) => expect(() => assertTransicao(de, para)).not.toThrow());

  it.each([
    ['REALIZADO', 'CANCELADO'],
    ['CANCELADO', 'AGENDADO'],
    ['REALIZADO', 'AGENDADO'],
  ])('%s -> %s é bloqueado (status final)', (de, para) =>
    expect(() => assertTransicao(de, para)).toThrow(expect.objectContaining({ code: 'TRANSICAO_INVALIDA' })),
  );
});

describe('agenda', () => {
  const t = (h, m = 0) => new Date(Date.UTC(2026, 9, 5, h, m));

  it('detecta sobreposição (encostar não é conflito)', () => {
    expect(sobrepoe(t(10), t(11), t(10, 30), t(11, 30))).toBe(true);
    expect(sobrepoe(t(10), t(11), t(11), t(12))).toBe(false);
  });

  it('sugere horários livres respeitando expediente e ocupados', () => {
    const livres = calcularHorariosLivres({
      expediente: [{ inicio: t(8), fim: t(12) }],
      ocupados: [{ inicio: t(9), fim: t(10) }],
      duracaoMinutos: 60,
      passoMinutos: 60,
      agora: t(0),
    });
    expect(livres.map((l) => l.inicio.getUTCHours())).toEqual([8, 10, 11]);
  });

  it('não sugere horários no passado', () => {
    const livres = calcularHorariosLivres({ expediente: [{ inicio: t(8), fim: t(12) }], ocupados: [], duracaoMinutos: 60, passoMinutos: 60, agora: t(9, 30) });
    expect(livres.map((l) => l.inicio.getUTCHours())).toEqual([10, 11]);
  });
});
