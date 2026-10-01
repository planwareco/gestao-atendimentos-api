/**
 * Atendimentos — entidade central do sistema.
 * A Agenda e o Histórico são apenas VISÕES dos atendimentos (sem dados duplicados).
 *
 * Concorrência na agenda:
 *   Criar/remarcar roda numa transação com advisory lock do Postgres por
 *   (empresa, profissional). Duas recepcionistas marcando o mesmo horário ao mesmo
 *   tempo: uma consegue, a outra recebe 409 AGENDA_CONFLITO.
 */
import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';
import { addMinutes } from '../../utils/dates.js';
import { MODULOS } from '../../security/permissions.js';
import { validarCamposExtras } from '../configuracoes/camposExtras.js';
import { STATUS_EDITAVEIS, STATUS_OCUPAM_AGENDA, assertTransicao, calcularAtendimento, calcularComissoes, montarItens } from './regras.js';

export const ATENDIMENTO_SELECT = {
  id: true,
  inicio: true,
  fim: true,
  status: true,
  encaixe: true,
  observacoes: true,
  subtotalCentavos: true,
  descontoCentavos: true,
  acrescimoCentavos: true,
  totalCentavos: true,
  comissaoTotalCentavos: true,
  formaPagamento: true,
  camposExtras: true,
  confirmadoEm: true,
  realizadoEm: true,
  canceladoEm: true,
  motivoCancelamento: true,
  orcamentoId: true,
  criadoEm: true,
  atualizadoEm: true,
  cliente: { select: { id: true, nome: true, telefone: true, whatsapp: true } },
  profissional: { select: { id: true, nome: true, cor: true } },
  itens: {
    select: {
      id: true,
      servicoId: true,
      descricao: true,
      quantidade: true,
      valorUnitarioCentavos: true,
      totalCentavos: true,
      duracaoMinutos: true,
      comissaoCentavos: true,
    },
  },
};

export class AtendimentosRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'atendimento', { defaultSelect: ATENDIMENTO_SELECT, defaultOrderBy: { inicio: 'asc' } });
  }

  /** Trava por (empresa, profissional) até o fim da transação. */
  async lockAgenda(empresaId, profissionalId) {
    const chave = `${empresaId}:${profissionalId ?? 'sem-profissional'}`;
    await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chave}, 0))`;
  }

  findConflito(empresaId, { profissionalId, inicio, fim, ignorarId }) {
    return this.model.findFirst({
      where: {
        empresaId,
        profissionalId: profissionalId ?? null,
        status: { in: STATUS_OCUPAM_AGENDA },
        inicio: { lt: fim },
        fim: { gt: inicio },
        ...(ignorarId && { id: { not: ignorarId } }),
      },
      select: { id: true, inicio: true, fim: true, cliente: { select: { nome: true } } },
    });
  }
}

export class AtendimentosService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.atendimentosRepository;
  }

  /** ABAC: quem não tem `atendimentos:todos` só vê os próprios. */
  #escopo(ctx, where = {}) {
    if (ctx.podeVerTodos) return where;
    if (!ctx.profissionalId) return { ...where, id: '00000000-0000-0000-0000-000000000000' }; // sem vínculo = nada
    return { ...where, profissionalId: ctx.profissionalId };
  }

  async listar(ctx, { inicio, fim, status, clienteId, profissionalId, page, perPage }) {
    const where = this.#escopo(ctx, {
      ...(status && { status: { in: [status].flat() } }),
      ...(clienteId && { clienteId }),
      ...(profissionalId && { profissionalId }),
      ...((inicio || fim) && { inicio: { ...(inicio && { gte: inicio }), ...(fim && { lt: fim }) } }),
    });
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy: { inicio: 'desc' } });
    return paginated(r.items, r);
  }

  async obter(ctx, id, tx) {
    const repo = tx ? this.repo.withTx(tx) : this.repo;
    const a = await repo.findOne(ctx.empresaId, this.#escopo(ctx, { id }));
    return this.notFoundIfNull(a, 'Atendimento não encontrado.', 'ATENDIMENTO_NAO_ENCONTRADO');
  }

  async #validarRelacionamentos(ctx, { clienteId, profissionalId }) {
    const checks = [];
    if (clienteId) {
      checks.push(
        this.prisma.cliente.findFirst({ where: { id: clienteId, empresaId: ctx.empresaId }, select: { status: true } }).then((c) => {
          if (!c) throw ApiError.unprocessable('Cliente não encontrado.', 'CLIENTE_INVALIDO', [{ field: 'clienteId', message: 'Cliente não encontrado.' }]);
          if (c.status !== 'ATIVO') throw ApiError.unprocessable('Cliente inativo.', 'CLIENTE_INATIVO', [{ field: 'clienteId', message: 'Cliente inativo.' }]);
        }),
      );
    }
    if (profissionalId) {
      if (!ctx.modulos.has(MODULOS.MULTI_PROFISSIONAL)) {
        throw ApiError.forbidden('O módulo Multi-profissional não está contratado.', 'MODULO_NAO_CONTRATADO');
      }
      checks.push(
        this.prisma.profissional.findFirst({ where: { id: profissionalId, empresaId: ctx.empresaId }, select: { status: true } }).then((p) => {
          if (!p)
            throw ApiError.unprocessable('Profissional não encontrado.', 'PROFISSIONAL_INVALIDO', [
              { field: 'profissionalId', message: 'Profissional não encontrado.' },
            ]);
          if (p.status !== 'ATIVO') throw ApiError.unprocessable('Profissional inativo.', 'PROFISSIONAL_INATIVO');
        }),
      );
    }
    await Promise.all(checks);
  }

  async #montar(ctx, body) {
    const servicos = await this.servicosRepository.findManyByIds(
      ctx.empresaId,
      body.itens.map((i) => i.servicoId),
    );
    const itens = montarItens(body.itens, new Map(servicos.map((s) => [s.id, s])));
    const calc = calcularAtendimento(itens, body);
    const fim = body.fim ?? addMinutes(body.inicio, calc.duracaoTotalMinutos);
    if (fim <= body.inicio) throw ApiError.unprocessable('O horário final deve ser depois do inicial.', 'PERIODO_INVALIDO');
    return { calc, fim };
  }

  async #camposExtras(ctx, valores) {
    if (valores === undefined) return undefined;
    return validarCamposExtras(await this.configuracoes.camposPersonalizados(ctx.empresaId), 'atendimento', valores);
  }

  async #garantirHorarioLivre(repo, ctx, { profissionalId, inicio, fim, encaixe, ignorarId }) {
    await repo.lockAgenda(ctx.empresaId, profissionalId);
    if (encaixe) return;
    const conflito = await repo.findConflito(ctx.empresaId, { profissionalId, inicio, fim, ignorarId });
    if (conflito) {
      throw new ApiError(409, `Horário ocupado por ${conflito.cliente.nome}. Escolha outro horário ou marque como encaixe.`, 'AGENDA_CONFLITO', [
        { field: 'inicio', message: `Conflito com atendimento ${conflito.id} (${conflito.inicio.toISOString()} – ${conflito.fim.toISOString()})` },
      ]);
    }
  }

  async #comissaoBps(tx, empresaId, profissionalId) {
    if (!profissionalId) return 0;
    const p = await tx.profissional.findFirst({ where: { id: profissionalId, empresaId }, select: { comissaoBps: true } });
    return p?.comissaoBps ?? 0;
  }

  /** @param {{ orcamentoId?: string }} [opcoes] usado na conversão de orçamento */
  async criar(ctx, body, { orcamentoId } = {}) {
    // Profissional sem permissão ampla só cria atendimento para si mesmo
    const profissionalId = ctx.podeVerTodos ? (body.profissionalId ?? null) : ctx.profissionalId;
    if (!ctx.podeVerTodos && !profissionalId) throw ApiError.forbidden('Seu usuário não está vinculado a um profissional.', 'PROFISSIONAL_NAO_VINCULADO');

    await this.#validarRelacionamentos(ctx, { clienteId: body.clienteId, profissionalId });
    const { calc, fim } = await this.#montar(ctx, body);
    const camposExtras = (await this.#camposExtras(ctx, body.camposExtras ?? {})) ?? {};
    const status = body.status ?? 'AGENDADO';
    const agora = new Date();

    const criado = await this.prisma.$transaction(async (tx) => {
      const repo = this.repo.withTx(tx);
      await this.#garantirHorarioLivre(repo, ctx, { profissionalId, inicio: body.inicio, fim, encaixe: body.encaixe });

      const itens = status === 'REALIZADO' ? calcularComissoes(calc.itens, calc, await this.#comissaoBps(tx, ctx.empresaId, profissionalId)) : calc.itens;
      return repo.create(ctx.empresaId, {
        clienteId: body.clienteId,
        profissionalId,
        orcamentoId,
        inicio: body.inicio,
        fim,
        status,
        encaixe: body.encaixe ?? false,
        observacoes: body.observacoes,
        subtotalCentavos: calc.subtotalCentavos,
        descontoCentavos: calc.descontoCentavos,
        acrescimoCentavos: calc.acrescimoCentavos,
        totalCentavos: calc.totalCentavos,
        comissaoTotalCentavos: itens.reduce((a, i) => a + (i.comissaoCentavos ?? 0), 0),
        formaPagamento: body.formaPagamento,
        camposExtras,
        criadoPorId: ctx.usuarioId,
        ...(status === 'CONFIRMADO' && { confirmadoEm: agora }),
        ...(status === 'REALIZADO' && { realizadoEm: agora }),
        itens: { create: itens },
      });
    });
    await this.#invalidarAgregados(ctx);
    return criado;
  }

  async atualizar(ctx, id, body) {
    const atual = await this.obter(ctx, id);
    if (!STATUS_EDITAVEIS.includes(atual.status)) {
      throw ApiError.unprocessable(`Atendimento ${atual.status.toLowerCase()} não pode ser editado.`, 'ATENDIMENTO_NAO_EDITAVEL');
    }
    const profissionalId = ctx.podeVerTodos ? (body.profissionalId !== undefined ? body.profissionalId : (atual.profissional?.id ?? null)) : ctx.profissionalId;
    await this.#validarRelacionamentos(ctx, {
      clienteId: body.clienteId,
      profissionalId: profissionalId !== (atual.profissional?.id ?? null) ? profissionalId : null,
    });

    const merged = {
      inicio: body.inicio ?? atual.inicio,
      itens: body.itens ?? atual.itens.map((i) => ({ servicoId: i.servicoId, quantidade: i.quantidade, valorUnitarioCentavos: i.valorUnitarioCentavos })),
      descontoCentavos: body.descontoCentavos ?? atual.descontoCentavos,
      acrescimoCentavos: body.acrescimoCentavos ?? atual.acrescimoCentavos,
      // se mudou início ou itens e não informou fim, recalcula pela duração
      fim: body.fim ?? (body.inicio || body.itens ? undefined : atual.fim),
    };
    const { calc, fim } = await this.#montar(ctx, merged);
    const camposExtras = await this.#camposExtras(ctx, body.camposExtras);
    const encaixe = body.encaixe ?? atual.encaixe;

    const atualizado = await this.prisma.$transaction(async (tx) => {
      const repo = this.repo.withTx(tx);
      await this.#garantirHorarioLivre(repo, ctx, { profissionalId, inicio: merged.inicio, fim, encaixe, ignorarId: id });
      if (body.itens) await tx.atendimentoItem.deleteMany({ where: { atendimentoId: id } });
      return repo.update(ctx.empresaId, id, {
        clienteId: body.clienteId,
        profissionalId,
        inicio: merged.inicio,
        fim,
        encaixe,
        observacoes: body.observacoes,
        subtotalCentavos: calc.subtotalCentavos,
        descontoCentavos: calc.descontoCentavos,
        acrescimoCentavos: calc.acrescimoCentavos,
        totalCentavos: calc.totalCentavos,
        formaPagamento: body.formaPagamento,
        camposExtras,
        ...(body.itens && { itens: { create: calc.itens } }),
      });
    });
    await this.#invalidarAgregados(ctx);
    return atualizado;
  }

  /**
   * Muda o status respeitando a máquina de estados.
   * REALIZADO calcula as comissões e passa a contar no faturamento.
   */
  async alterarStatus(ctx, id, { status, motivo, formaPagamento }) {
    const atual = await this.obter(ctx, id);
    assertTransicao(atual.status, status);
    const agora = new Date();

    const resultado = await this.prisma.$transaction(async (tx) => {
      const data = { status };
      if (status === 'CONFIRMADO') data.confirmadoEm = agora;
      if (status === 'CANCELADO') Object.assign(data, { canceladoEm: agora, motivoCancelamento: motivo ?? null });
      if (status === 'REALIZADO') {
        Object.assign(data, { realizadoEm: agora, formaPagamento: formaPagamento ?? atual.formaPagamento });
        const bps = await this.#comissaoBps(tx, ctx.empresaId, atual.profissional?.id);
        const itens = calcularComissoes(atual.itens, atual, bps);
        // sequencial: dentro de uma transação todas as queries usam a MESMA conexão
        for (const i of itens) {
          await tx.atendimentoItem.update({ where: { id: i.id }, data: { comissaoCentavos: i.comissaoCentavos }, select: { id: true } });
        }
        data.comissaoTotalCentavos = itens.reduce((a, i) => a + i.comissaoCentavos, 0);
      }
      // trava otimista: só altera se ninguém mudou o status no meio do caminho
      const { count } = await tx.atendimento.updateMany({ where: { id, empresaId: ctx.empresaId, status: atual.status }, data });
      if (count === 0) throw ApiError.conflict('O atendimento foi alterado por outra pessoa. Recarregue e tente novamente.', 'CONFLITO_CONCORRENCIA');
      return this.obter(ctx, id, tx);
    });
    await this.#invalidarAgregados(ctx);
    return resultado;
  }

  async #invalidarAgregados(ctx) {
    await this.cache.bump(`dash:${ctx.empresaId}`);
  }
}
