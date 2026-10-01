/**
 * Agenda = visualização dos atendimentos (dia/semana/mês) + horários livres.
 * Não tem tabela própria: evita duplicar dados.
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { dayRangeUtc, partsInTz, zonedToUtc } from '../../utils/dates.js';
import { STATUS_OCUPAM_AGENDA, calcularHorariosLivres } from '../atendimentos/regras.js';

const MAX_DIAS = 62;

export class AgendaService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async listar(ctx, { inicio, fim, profissionalId, incluirCancelados }) {
    if ((fim - inicio) / 86_400_000 > MAX_DIAS) throw ApiError.unprocessable(`Período máximo da agenda: ${MAX_DIAS} dias.`, 'PERIODO_MUITO_LONGO');
    const where = {
      empresaId: ctx.empresaId,
      inicio: { lt: fim },
      fim: { gt: inicio },
      ...(incluirCancelados ? {} : { status: { in: STATUS_OCUPAM_AGENDA } }),
      ...(profissionalId && { profissionalId }),
    };
    if (!ctx.podeVerTodos) where.profissionalId = ctx.profissionalId ?? '00000000-0000-0000-0000-000000000000';

    return this.prisma.atendimento.findMany({
      where,
      orderBy: { inicio: 'asc' },
      take: 2000,
      select: {
        id: true,
        inicio: true,
        fim: true,
        status: true,
        encaixe: true,
        totalCentavos: true,
        observacoes: true,
        cliente: { select: { id: true, nome: true, whatsapp: true } },
        profissional: { select: { id: true, nome: true, cor: true } },
        itens: { select: { descricao: true, quantidade: true } },
      },
    });
  }

  /**
   * Sugere horários livres para um dia, considerando:
   *  - expediente do profissional (horarioTrabalho) ou o expediente informado
   *  - atendimentos que já ocupam a agenda
   *  - duração (informada ou somada dos serviços)
   */
  async horariosLivres(ctx, { data, profissionalId, servicoIds, duracaoMinutos, passoMinutos, expedienteInicio, expedienteFim }) {
    const tz = ctx.fusoHorario;
    if (!ctx.podeVerTodos) profissionalId = ctx.profissionalId;

    let duracao = duracaoMinutos;
    if (!duracao) {
      if (!servicoIds?.length) throw ApiError.unprocessable('Informe duracaoMinutos ou servicoIds.', 'DURACAO_OBRIGATORIA');
      const servicos = await this.prisma.servico.findMany({ where: { empresaId: ctx.empresaId, id: { in: servicoIds } }, select: { duracaoMinutos: true } });
      duracao = servicos.reduce((a, s) => a + s.duracaoMinutos, 0);
      if (!duracao) throw ApiError.unprocessable('Serviços não encontrados.', 'SERVICO_INVALIDO');
    }

    let blocos = [{ inicio: expedienteInicio, fim: expedienteFim }];
    if (profissionalId) {
      const p = await this.prisma.profissional.findFirst({ where: { id: profissionalId, empresaId: ctx.empresaId }, select: { horarioTrabalho: true } });
      if (!p) throw ApiError.notFound('Profissional não encontrado.', 'PROFISSIONAL_NAO_ENCONTRADO');
      const diaSemana = partsInTz(zonedToUtc(data, '12:00', tz), tz).weekday;
      const configurado = p.horarioTrabalho?.[String(diaSemana)];
      if (Array.isArray(configurado)) blocos = configurado; // [] = folga
    }

    const expediente = blocos.map((b) => ({ inicio: zonedToUtc(data, b.inicio, tz), fim: zonedToUtc(data, b.fim, tz) }));
    const { inicio, fim } = dayRangeUtc(data, tz);
    const ocupados = await this.prisma.atendimento.findMany({
      where: {
        empresaId: ctx.empresaId,
        profissionalId: profissionalId ?? null,
        status: { in: STATUS_OCUPAM_AGENDA },
        inicio: { lt: fim },
        fim: { gt: inicio },
      },
      select: { inicio: true, fim: true },
    });

    const livres = calcularHorariosLivres({ expediente, ocupados, duracaoMinutos: duracao, passoMinutos });
    return { data, profissionalId: profissionalId ?? null, duracaoMinutos: duracao, horarios: livres };
  }
}
