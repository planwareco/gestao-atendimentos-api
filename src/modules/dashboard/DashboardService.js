/**
 * Dashboard e Financeiro.
 * Todo número de receita vem de IndicadoresRepository, que aplica a regra
 * "só REALIZADO fatura" num único lugar — Dashboard, Financeiro e Histórico
 * nunca implementam essa lógica por conta própria.
 *
 * Cache: 60s por empresa/período, invalidado por versão sempre que um
 * atendimento ou despesa muda (cache.bump(`dash:<empresaId>`)).
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { MODULOS } from '../../security/permissions.js';
import { dayRangeUtc, partsInTz, zonedToUtc } from '../../utils/dates.js';

const pad = (v) => String(v).padStart(2, '0');
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();

function periodo(ano, mes, tz) {
  const mIni = mes ?? 1;
  const mFim = mes ?? 12;
  const dataInicio = `${ano}-${pad(mIni)}-01`;
  const dataFim = `${ano}-${pad(mFim)}-${pad(ultimoDia(ano, mFim))}`;
  return { dataInicio, dataFim, inicio: zonedToUtc(dataInicio, '00:00', tz), fim: dayRangeUtc(dataFim, tz).fim };
}

export class DashboardService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.indicadoresRepository;
  }

  async dashboard(ctx, { ano, mes }) {
    const tz = ctx.fusoHorario;
    const hoje = partsInTz(new Date(), tz);
    ano ??= hoje.year;
    const mesCards = mes ?? (ano === hoje.year ? hoje.month : 12);
    const comFinanceiro = ctx.modulos.has(MODULOS.FINANCEIRO);

    const versao = await this.cache.version(`dash:${ctx.empresaId}`);
    const chave = `dash:${ctx.empresaId}:${versao}:${ano}:${mes ?? 'ano'}:${mesCards}:${comFinanceiro ? 1 : 0}`;

    return this.cache.wrap(chave, 60, async () => {
      const pAno = periodo(ano, null, tz);
      const pMes = periodo(ano, mesCards, tz);
      const pGraficos = mes ? pMes : pAno;

      const [cardsMes, despesasMes, clientes, serieAt, serieDesp, porCategoria, porServico] = await Promise.all([
        this.repo.resumoAtendimentos(ctx.empresaId, pMes),
        comFinanceiro ? this.repo.somaDespesas(ctx.empresaId, pMes) : 0,
        this.repo.totalClientesAtivos(ctx.empresaId),
        this.repo.serieMensalAtendimentos(ctx.empresaId, { ...pAno, tz }),
        comFinanceiro ? this.repo.serieMensalDespesas(ctx.empresaId, { ano }) : [],
        comFinanceiro ? this.repo.despesasPorCategoria(ctx.empresaId, pGraficos) : [],
        this.repo.receitaPorServico(ctx.empresaId, pGraficos),
      ]);

      const porMesAt = new Map(serieAt.map((r) => [r.mes, r]));
      const porMesDesp = new Map(serieDesp.map((r) => [r.mes, r.total]));
      const mensal = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const at = porMesAt.get(m);
        const entradas = at?.receita ?? 0;
        const saidas = porMesDesp.get(m) ?? 0;
        return {
          mes: m,
          entradasCentavos: entradas,
          saidasCentavos: saidas,
          saldoCentavos: entradas - saidas,
          atendimentosRealizados: at?.realizados ?? 0,
          atendimentosCancelados: at?.cancelados ?? 0,
        };
      });

      let acumulado = 0;
      const evolucaoFaturamento = mensal.map((m) => ({ mes: m.mes, acumuladoCentavos: (acumulado += m.entradasCentavos) }));

      return {
        periodo: { ano, mes: mes ?? null, mesIndicadores: mesCards, fusoHorario: tz },
        indicadores: {
          entradasCentavos: cardsMes.receita,
          despesasCentavos: despesasMes,
          comissoesCentavos: cardsMes.comissoes,
          saldoCentavos: cardsMes.receita - despesasMes - cardsMes.comissoes,
          atendimentosRealizados: cardsMes.realizados,
          atendimentosAgendados: cardsMes.agendados,
          atendimentosCancelados: cardsMes.cancelados,
          ticketMedioCentavos: cardsMes.realizados ? Math.round(cardsMes.receita / cardsMes.realizados) : 0,
          totalClientes: clientes,
        },
        graficos: {
          entradasSaidasPorMes: mensal,
          despesasPorCategoria: porCategoria,
          receitaPorServico: porServico,
          evolucaoFaturamento,
        },
        financeiroDisponivel: comFinanceiro,
      };
    });
  }

  #intervalo(ctx, { inicio, fim }) {
    if (inicio > fim) throw ApiError.unprocessable('A data inicial deve ser anterior à final.', 'PERIODO_INVALIDO');
    const tz = ctx.fusoHorario;
    return { dataInicio: inicio, dataFim: fim, inicio: zonedToUtc(inicio, '00:00', tz), fim: dayRangeUtc(fim, tz).fim };
  }

  /** Faturamento bruto − despesas − comissões = resultado. */
  async resultado(ctx, query) {
    const p = this.#intervalo(ctx, query);
    const [at, despesas, porForma, porCategoria] = await Promise.all([
      this.repo.resumoAtendimentos(ctx.empresaId, p),
      this.repo.somaDespesas(ctx.empresaId, p),
      this.repo.receitaPorFormaPagamento(ctx.empresaId, p),
      this.repo.despesasPorCategoria(ctx.empresaId, p),
    ]);
    return {
      periodo: { inicio: p.dataInicio, fim: p.dataFim },
      faturamentoBrutoCentavos: at.receita,
      despesasCentavos: despesas,
      comissoesCentavos: at.comissoes,
      resultadoCentavos: at.receita - despesas - at.comissoes,
      atendimentosRealizados: at.realizados,
      receitaPorFormaPagamento: porForma,
      despesasPorCategoria: porCategoria,
    };
  }

  async comissoes(ctx, query) {
    const p = this.#intervalo(ctx, query);
    const linhas = await this.repo.comissoesPorProfissional(ctx.empresaId, { ...p, profissionalId: query.profissionalId });
    return {
      periodo: { inicio: p.dataInicio, fim: p.dataFim },
      totalComissoesCentavos: linhas.reduce((a, l) => a + l.comissaoCentavos, 0),
      profissionais: linhas,
    };
  }
}
