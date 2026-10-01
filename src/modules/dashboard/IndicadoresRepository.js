/**
 * Consultas agregadas (dashboard/financeiro) em SQL parametrizado.
 * - Tagged templates do Prisma ($queryRaw`...`) => parâmetros, nunca concatenação (sem SQL injection)
 * - Filtro por intervalo em UTC (usa os índices empresa_id + inicio)
 * - Agrupamento por mês no FUSO da empresa
 * - REGRA: receita = somente status REALIZADO
 */
import { Prisma } from '@prisma/client';

const n = (v) => Number(v ?? 0);

export class IndicadoresRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async resumoAtendimentos(empresaId, { inicio, fim }) {
    const [r] = await this.prisma.$queryRaw`
      SELECT
        COALESCE(SUM(total_centavos) FILTER (WHERE status = 'REALIZADO'), 0)::bigint          AS receita,
        COALESCE(SUM(comissao_total_centavos) FILTER (WHERE status = 'REALIZADO'), 0)::bigint AS comissoes,
        COUNT(*) FILTER (WHERE status = 'REALIZADO')::int                                    AS realizados,
        COUNT(*) FILTER (WHERE status IN ('AGENDADO', 'CONFIRMADO'))::int                    AS agendados,
        COUNT(*) FILTER (WHERE status = 'CANCELADO')::int                                    AS cancelados
      FROM atendimentos
      WHERE empresa_id = ${empresaId}::uuid AND inicio >= ${inicio} AND inicio < ${fim}`;
    return { receita: n(r.receita), comissoes: n(r.comissoes), realizados: r.realizados, agendados: r.agendados, cancelados: r.cancelados };
  }

  async somaDespesas(empresaId, { dataInicio, dataFim }) {
    const [r] = await this.prisma.$queryRaw`
      SELECT COALESCE(SUM(valor_centavos), 0)::bigint AS total
      FROM despesas
      WHERE empresa_id = ${empresaId}::uuid AND status = 'PAGA' AND data >= ${dataInicio}::date AND data <= ${dataFim}::date`;
    return n(r.total);
  }

  /** Série mensal de receita e atendimentos realizados (mês no fuso da empresa). */
  async serieMensalAtendimentos(empresaId, { inicio, fim, tz }) {
    const rows = await this.prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM (inicio AT TIME ZONE ${tz}))::int AS mes,
             COALESCE(SUM(total_centavos) FILTER (WHERE status = 'REALIZADO'), 0)::bigint AS receita,
             COUNT(*) FILTER (WHERE status = 'REALIZADO')::int AS realizados,
             COUNT(*) FILTER (WHERE status = 'CANCELADO')::int AS cancelados
      FROM atendimentos
      WHERE empresa_id = ${empresaId}::uuid AND inicio >= ${inicio} AND inicio < ${fim}
      GROUP BY 1`;
    return rows.map((r) => ({ mes: r.mes, receita: n(r.receita), realizados: r.realizados, cancelados: r.cancelados }));
  }

  async serieMensalDespesas(empresaId, { ano }) {
    const rows = await this.prisma.$queryRaw`
      SELECT EXTRACT(MONTH FROM data)::int AS mes, COALESCE(SUM(valor_centavos), 0)::bigint AS total
      FROM despesas
      WHERE empresa_id = ${empresaId}::uuid AND status = 'PAGA'
        AND data >= make_date(${ano}::int, 1, 1) AND data < make_date(${ano}::int + 1, 1, 1)
      GROUP BY 1`;
    return rows.map((r) => ({ mes: r.mes, total: n(r.total) }));
  }

  async despesasPorCategoria(empresaId, { dataInicio, dataFim }) {
    const rows = await this.prisma.$queryRaw`
      SELECT c.id, c.nome, c.cor, COALESCE(SUM(d.valor_centavos), 0)::bigint AS total, COUNT(d.id)::int AS quantidade
      FROM despesas d
      JOIN categorias_despesa c ON c.id = d.categoria_id
      WHERE d.empresa_id = ${empresaId}::uuid AND d.status = 'PAGA' AND d.data >= ${dataInicio}::date AND d.data <= ${dataFim}::date
      GROUP BY c.id
      ORDER BY total DESC`;
    return rows.map((r) => ({ categoriaId: r.id, nome: r.nome, cor: r.cor, totalCentavos: n(r.total), quantidade: r.quantidade }));
  }

  /** Receita e quantidade por serviço (itens de atendimentos realizados). */
  async receitaPorServico(empresaId, { inicio, fim, limite = 10 }) {
    const rows = await this.prisma.$queryRaw`
      SELECT i.servico_id AS id, MAX(i.descricao) AS nome,
             SUM(i.quantidade)::int AS quantidade,
             COALESCE(SUM(i.total_centavos), 0)::bigint AS receita
      FROM atendimento_itens i
      JOIN atendimentos a ON a.id = i.atendimento_id
      WHERE a.empresa_id = ${empresaId}::uuid AND a.status = 'REALIZADO' AND a.inicio >= ${inicio} AND a.inicio < ${fim}
      GROUP BY i.servico_id
      ORDER BY receita DESC
      LIMIT ${limite}::int`;
    return rows.map((r) => ({ servicoId: r.id, nome: r.nome, quantidade: r.quantidade, receitaCentavos: n(r.receita) }));
  }

  async receitaPorFormaPagamento(empresaId, { inicio, fim }) {
    const rows = await this.prisma.$queryRaw`
      SELECT COALESCE(forma_pagamento::text, 'NAO_INFORMADO') AS forma, COALESCE(SUM(total_centavos), 0)::bigint AS total, COUNT(*)::int AS quantidade
      FROM atendimentos
      WHERE empresa_id = ${empresaId}::uuid AND status = 'REALIZADO' AND inicio >= ${inicio} AND inicio < ${fim}
      GROUP BY 1 ORDER BY total DESC`;
    return rows.map((r) => ({ formaPagamento: r.forma, totalCentavos: n(r.total), quantidade: r.quantidade }));
  }

  async comissoesPorProfissional(empresaId, { inicio, fim, profissionalId }) {
    const filtro = profissionalId ? Prisma.sql`AND a.profissional_id = ${profissionalId}::uuid` : Prisma.empty;
    const rows = await this.prisma.$queryRaw`
      SELECT p.id, p.nome, p.comissao_bps AS "comissaoBps",
             COUNT(a.id)::int AS atendimentos,
             COALESCE(SUM(a.total_centavos), 0)::bigint AS faturamento,
             COALESCE(SUM(a.comissao_total_centavos), 0)::bigint AS comissao
      FROM profissionais p
      LEFT JOIN atendimentos a ON a.profissional_id = p.id AND a.status = 'REALIZADO' AND a.inicio >= ${inicio} AND a.inicio < ${fim}
      WHERE p.empresa_id = ${empresaId}::uuid ${filtro}
      GROUP BY p.id
      ORDER BY comissao DESC, p.nome`;
    return rows.map((r) => ({
      profissionalId: r.id,
      nome: r.nome,
      comissaoBps: r.comissaoBps,
      atendimentos: r.atendimentos,
      faturamentoCentavos: n(r.faturamento),
      comissaoCentavos: n(r.comissao),
    }));
  }

  totalClientesAtivos(empresaId) {
    return this.prisma.cliente.count({ where: { empresaId, status: 'ATIVO' } });
  }
}
