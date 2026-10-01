import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';
import { formatDateOnly, parseDateOnly, todayInTz } from '../../utils/dates.js';
import { validarCamposExtras } from '../configuracoes/camposExtras.js';

const serializar = (c) => (c ? { ...c, dataNascimento: formatDateOnly(c.dataNascimento) } : c);

export class ClientesService extends AbstractService {
  /** @param {{ clientesRepository: import('./ClientesRepository.js').ClientesRepository, configuracoes, prisma }} deps */
  constructor(deps) {
    super(deps);
    this.repo = deps.clientesRepository;
  }

  async listar(ctx, { busca, status, page, perPage, ordenar }) {
    const where = { ...(status && { status }) };
    if (busca) {
      const digitos = busca.replace(/\D/g, '');
      where.OR = [
        { nome: { contains: busca, mode: 'insensitive' } },
        { informacaoAdicional: { contains: busca, mode: 'insensitive' } },
        { email: { contains: busca, mode: 'insensitive' } },
        ...(digitos.length >= 3 ? [{ telefone: { contains: digitos } }, { whatsapp: { contains: digitos } }, { documento: { contains: digitos } }] : []),
      ];
    }
    const orderBy = ordenar === 'recentes' ? { criadoEm: 'desc' } : { nome: 'asc' };
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy });
    return paginated(r.items.map(serializar), r);
  }

  async obter(ctx, id) {
    return serializar(this.notFoundIfNull(await this.repo.findById(ctx.empresaId, id), 'Cliente não encontrado.', 'CLIENTE_NAO_ENCONTRADO'));
  }

  async #dados(ctx, body) {
    const data = { ...body };
    if ('dataNascimento' in body) data.dataNascimento = parseDateOnly(body.dataNascimento);
    if (body.camposExtras !== undefined) {
      const defs = await this.configuracoes.camposPersonalizados(ctx.empresaId);
      data.camposExtras = validarCamposExtras(defs, 'cliente', body.camposExtras);
    }
    return data;
  }

  async criar(ctx, body) {
    const data = await this.#dados(ctx, { camposExtras: {}, ...body });
    return serializar(await this.repo.create(ctx.empresaId, data));
  }

  async atualizar(ctx, id, body) {
    await this.obter(ctx, id);
    return serializar(await this.repo.update(ctx.empresaId, id, await this.#dados(ctx, body)));
  }

  /**
   * Exclusão definitiva só para cliente sem histórico.
   * Com atendimentos/orçamentos, o correto é inativar (status INATIVO) — o histórico financeiro não pode sumir.
   */
  async remover(ctx, id) {
    await this.obter(ctx, id);
    const [atendimentos, orcamentos] = await Promise.all([
      this.prisma.atendimento.count({ where: { empresaId: ctx.empresaId, clienteId: id } }),
      this.prisma.orcamento.count({ where: { empresaId: ctx.empresaId, clienteId: id } }),
    ]);
    if (atendimentos + orcamentos > 0) {
      throw ApiError.conflict('Cliente possui histórico. Inative o cadastro em vez de excluir.', 'CLIENTE_COM_HISTORICO');
    }
    await this.repo.delete(ctx.empresaId, id);
    return null;
  }

  /** Resumo comercial: total gasto, ticket médio, frequência, último e próximo atendimento. */
  async resumo(ctx, id) {
    const cliente = await this.obter(ctx, id);
    const base = { empresaId: ctx.empresaId, clienteId: id };
    const [agg, proximo, cancelados] = await Promise.all([
      this.prisma.atendimento.aggregate({
        where: { ...base, status: 'REALIZADO' },
        _sum: { totalCentavos: true },
        _count: { _all: true },
        _min: { inicio: true },
        _max: { inicio: true },
      }),
      this.prisma.atendimento.findFirst({
        where: { ...base, status: { in: ['AGENDADO', 'CONFIRMADO'] }, inicio: { gte: new Date() } },
        orderBy: { inicio: 'asc' },
        select: { id: true, inicio: true, status: true },
      }),
      this.prisma.atendimento.count({ where: { ...base, status: 'CANCELADO' } }),
    ]);

    const total = agg._count._all;
    const gasto = agg._sum.totalCentavos ?? 0;
    const ultimo = agg._max.inicio;
    const frequenciaMediaDias = total > 1 ? Math.round((agg._max.inicio - agg._min.inicio) / 86_400_000 / (total - 1)) : null;
    const diasDesdeUltimo = ultimo ? Math.floor((Date.now() - ultimo.getTime()) / 86_400_000) : null;

    return {
      cliente: { id: cliente.id, nome: cliente.nome, status: cliente.status },
      totalGastoCentavos: gasto,
      atendimentosRealizados: total,
      atendimentosCancelados: cancelados,
      ticketMedioCentavos: total ? Math.round(gasto / total) : 0,
      ultimoAtendimento: ultimo,
      diasDesdeUltimo,
      frequenciaMediaDias,
      // previsão simples: atrasado se passou 1,5x a frequência habitual
      situacaoRetorno:
        frequenciaMediaDias && diasDesdeUltimo != null
          ? diasDesdeUltimo > frequenciaMediaDias * 1.5
            ? 'ATRASADO'
            : diasDesdeUltimo >= frequenciaMediaDias
              ? 'PROVAVEL_RETORNO'
              : 'EM_DIA'
          : null,
      proximoAtendimento: proximo,
    };
  }

  /** Histórico de atendimentos (cancelados aparecem, mas identificados). */
  async historico(ctx, id, { page, perPage, status }) {
    await this.obter(ctx, id);
    const where = { empresaId: ctx.empresaId, clienteId: id, ...(status && { status }) };
    if (!ctx.podeVerTodos) where.profissionalId = ctx.profissionalId ?? '00000000-0000-0000-0000-000000000000';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.atendimento.findMany({
        where,
        orderBy: { inicio: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          inicio: true,
          fim: true,
          status: true,
          totalCentavos: true,
          formaPagamento: true,
          profissional: { select: { id: true, nome: true } },
          itens: { select: { descricao: true, quantidade: true, totalCentavos: true } },
        },
      }),
      this.prisma.atendimento.count({ where }),
    ]);
    return paginated(items, { total, page, perPage });
  }

  async aniversariantes(ctx, { dias }) {
    const rows = await this.repo.aniversariantes(ctx.empresaId, { hoje: todayInTz(ctx.fusoHorario), dias });
    return rows.map(serializar);
  }

  inativos(ctx, { dias }) {
    return this.repo.inativos(ctx.empresaId, { dias });
  }
}
