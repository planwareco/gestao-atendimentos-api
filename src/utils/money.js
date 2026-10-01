/**
 * Dinheiro em centavos (inteiros). Nunca usar float para somar valores.
 */
export const reaisParaCentavos = (reais) => Math.round(Number(reais) * 100);
export const centavosParaReais = (centavos) => Number((centavos / 100).toFixed(2));

export function formatBRL(centavos) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);
}

/** Aplica percentual em basis points (4000 = 40%) com arredondamento bancário simples. */
export function aplicarBps(centavos, bps) {
  return Math.round((centavos * bps) / 10_000);
}

/**
 * Calcula totais a partir dos itens.
 * @param {{quantidade:number, valorUnitarioCentavos:number}[]} itens
 * @param {{descontoCentavos?:number, acrescimoCentavos?:number}} ajustes
 */
export function calcularTotais(itens, { descontoCentavos = 0, acrescimoCentavos = 0 } = {}) {
  const itensCalculados = itens.map((i) => ({ ...i, totalCentavos: i.quantidade * i.valorUnitarioCentavos }));
  const subtotalCentavos = itensCalculados.reduce((acc, i) => acc + i.totalCentavos, 0);
  const totalCentavos = subtotalCentavos - descontoCentavos + acrescimoCentavos;
  return { itens: itensCalculados, subtotalCentavos, descontoCentavos, acrescimoCentavos, totalCentavos };
}
