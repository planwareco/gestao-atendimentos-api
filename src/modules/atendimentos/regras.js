/**
 * Regras de negócio PURAS dos atendimentos (sem banco) — fáceis de testar.
 *
 * REGRA DE OURO DO FATURAMENTO
 *   Só atendimento REALIZADO entra em faturamento, dashboard, comissão e total gasto.
 *   AGENDADO, CONFIRMADO e CANCELADO nunca contam como receita.
 */
import { ApiError } from '../../core/ApiError.js';
import { aplicarBps, calcularTotais } from '../../utils/money.js';

export const STATUS_FATURAVEL = 'REALIZADO';

/** Status que ocupam horário na agenda (cancelado libera o horário). */
export const STATUS_OCUPAM_AGENDA = ['AGENDADO', 'CONFIRMADO', 'REALIZADO'];

/** Status em que o atendimento ainda pode ser editado. */
export const STATUS_EDITAVEIS = ['AGENDADO', 'CONFIRMADO'];

export const TRANSICOES = Object.freeze({
  AGENDADO: ['CONFIRMADO', 'REALIZADO', 'CANCELADO'],
  CONFIRMADO: ['AGENDADO', 'REALIZADO', 'CANCELADO'],
  REALIZADO: [],
  CANCELADO: [],
});

export function assertTransicao(de, para) {
  if (!TRANSICOES[de]?.includes(para)) {
    throw ApiError.unprocessable(`Não é possível alterar um atendimento de ${de} para ${para}.`, 'TRANSICAO_INVALIDA');
  }
}

/**
 * Monta os itens a partir dos serviços cadastrados.
 * O preço vem do cadastro do serviço, a menos que um valor seja informado explicitamente.
 * @param {{servicoId:string, quantidade?:number, valorUnitarioCentavos?:number}[]} entrada
 * @param {Map<string, {id,nome,valorCentavos,duracaoMinutos,status}>} servicos
 */
export function montarItens(entrada, servicos, { exigirAtivo = true } = {}) {
  return entrada.map((item, i) => {
    const servico = servicos.get(item.servicoId);
    if (!servico)
      throw ApiError.unprocessable('Serviço não encontrado.', 'SERVICO_INVALIDO', [{ field: `itens.${i}.servicoId`, message: 'Serviço não encontrado.' }]);
    if (exigirAtivo && servico.status !== 'ATIVO') {
      throw ApiError.unprocessable(`O serviço "${servico.nome}" está inativo.`, 'SERVICO_INATIVO', [
        { field: `itens.${i}.servicoId`, message: 'Serviço inativo.' },
      ]);
    }
    return {
      servicoId: servico.id,
      descricao: servico.nome,
      quantidade: item.quantidade ?? 1,
      valorUnitarioCentavos: item.valorUnitarioCentavos ?? servico.valorCentavos,
      duracaoMinutos: servico.duracaoMinutos,
    };
  });
}

export function calcularAtendimento(itens, { descontoCentavos = 0, acrescimoCentavos = 0 }) {
  const totais = calcularTotais(itens, { descontoCentavos, acrescimoCentavos });
  if (totais.totalCentavos < 0) {
    throw ApiError.unprocessable('O desconto não pode ser maior que o valor dos serviços.', 'DESCONTO_INVALIDO', [
      { field: 'descontoCentavos', message: 'Maior que o subtotal.' },
    ]);
  }
  const duracaoTotalMinutos = itens.reduce((acc, i) => acc + i.duracaoMinutos * i.quantidade, 0);
  return { ...totais, duracaoTotalMinutos };
}

/**
 * Comissão por item, proporcional ao valor efetivamente cobrado
 * (desconto/acréscimo do atendimento são rateados entre os itens).
 */
export function calcularComissoes(itens, { subtotalCentavos, totalCentavos }, comissaoBps) {
  if (!comissaoBps || subtotalCentavos === 0) return itens.map((i) => ({ ...i, comissaoCentavos: 0 }));
  const fator = totalCentavos / subtotalCentavos;
  return itens.map((i) => ({ ...i, comissaoCentavos: aplicarBps(Math.round(i.totalCentavos * fator), comissaoBps) }));
}

export const sobrepoe = (aInicio, aFim, bInicio, bFim) => aInicio < bFim && bInicio < aFim;

/**
 * Horários livres de um dia.
 * @param {{ expediente: {inicio:Date,fim:Date}[], ocupados: {inicio:Date,fim:Date}[],
 *           duracaoMinutos:number, passoMinutos?:number, agora?:Date }} p
 * @returns {{inicio:Date, fim:Date}[]}
 */
export function calcularHorariosLivres({ expediente, ocupados, duracaoMinutos, passoMinutos = 15, agora = new Date() }) {
  const dur = duracaoMinutos * 60_000;
  const passo = passoMinutos * 60_000;
  const livres = [];
  for (const bloco of expediente) {
    for (let t = bloco.inicio.getTime(); t + dur <= bloco.fim.getTime(); t += passo) {
      const inicio = new Date(t);
      const fim = new Date(t + dur);
      if (inicio < agora) continue;
      if (ocupados.some((o) => sobrepoe(inicio, fim, o.inicio, o.fim))) continue;
      livres.push({ inicio, fim });
    }
  }
  return livres;
}
