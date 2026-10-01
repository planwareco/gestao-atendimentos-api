/**
 * Orçamentos: itens, numeração sequencial por empresa, status, PDF e
 * conversão em atendimento (sem recadastrar nada).
 */
import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';
import { formatDateOnly, parseDateOnly, todayInTz } from '../../utils/dates.js';
import { calcularTotais } from '../../utils/money.js';
import { hashObject } from '../../security/crypto.js';
import { JOBS, QUEUES } from '../../queue/queues.js';

export const ORCAMENTO_SELECT = {
  id: true,
  numero: true,
  data: true,
  validade: true,
  observacoes: true,
  subtotalCentavos: true,
  descontoCentavos: true,
  acrescimoCentavos: true,
  totalCentavos: true,
  status: true,
  enviadoEm: true,
  aprovadoEm: true,
  recusadoEm: true,
  criadoEm: true,
  atualizadoEm: true,
  cliente: { select: { id: true, nome: true, email: true, telefone: true, whatsapp: true, documento: true } },
  itens: { select: { id: true, servicoId: true, descricao: true, quantidade: true, valorUnitarioCentavos: true, totalCentavos: true } },
  atendimento: { select: { id: true, inicio: true, status: true } },
};

const TRANSICOES = Object.freeze({
  RASCUNHO: ['ENVIADO', 'APROVADO', 'RECUSADO'],
  ENVIADO: ['APROVADO', 'RECUSADO', 'RASCUNHO'],
  EXPIRADO: ['ENVIADO'],
  APROVADO: [],
  RECUSADO: [],
});

const serializar = (o) => (o ? { ...o, data: formatDateOnly(o.data), validade: formatDateOnly(o.validade) } : o);

export class OrcamentosRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'orcamento', { defaultSelect: ORCAMENTO_SELECT, defaultOrderBy: { numero: 'desc' } });
  }
}

export class OrcamentosService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.orcamentosRepository;
  }

  async listar(ctx, { status, clienteId, numero, page, perPage }) {
    const where = { ...(status && { status }), ...(clienteId && { clienteId }), ...(numero && { numero }) };
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy: { numero: 'desc' } });
    return paginated(r.items.map(serializar), r);
  }

  async #obterBruto(ctx, id, tx) {
    const repo = tx ? this.repo.withTx(tx) : this.repo;
    return this.notFoundIfNull(await repo.findById(ctx.empresaId, id), 'Orçamento não encontrado.', 'ORCAMENTO_NAO_ENCONTRADO');
  }

  async obter(ctx, id) {
    return serializar(await this.#obterBruto(ctx, id));
  }

  /** Itens com serviço puxam nome/preço do cadastro; itens avulsos exigem descrição e valor. */
  async #montarItens(ctx, entrada) {
    const ids = entrada.filter((i) => i.servicoId).map((i) => i.servicoId);
    const servicos = ids.length ? await this.servicosRepository.findManyByIds(ctx.empresaId, ids) : [];
    const porId = new Map(servicos.map((s) => [s.id, s]));
    return entrada.map((i, idx) => {
      if (i.servicoId) {
        const s = porId.get(i.servicoId);
        if (!s)
          throw ApiError.unprocessable('Serviço não encontrado.', 'SERVICO_INVALIDO', [
            { field: `itens.${idx}.servicoId`, message: 'Serviço não encontrado.' },
          ]);
        return {
          servicoId: s.id,
          descricao: i.descricao ?? s.nome,
          quantidade: i.quantidade,
          valorUnitarioCentavos: i.valorUnitarioCentavos ?? s.valorCentavos,
        };
      }
      return { servicoId: null, descricao: i.descricao, quantidade: i.quantidade, valorUnitarioCentavos: i.valorUnitarioCentavos };
    });
  }

  #totais(itens, body) {
    const t = calcularTotais(itens, body);
    if (t.totalCentavos < 0) throw ApiError.unprocessable('O desconto não pode ser maior que o subtotal.', 'DESCONTO_INVALIDO');
    return t;
  }

  async criar(ctx, body) {
    const cliente = await this.prisma.cliente.findFirst({ where: { id: body.clienteId, empresaId: ctx.empresaId }, select: { id: true } });
    if (!cliente) throw ApiError.unprocessable('Cliente não encontrado.', 'CLIENTE_INVALIDO');
    const t = this.#totais(await this.#montarItens(ctx, body.itens), body);

    const criado = await this.prisma.$transaction(async (tx) => {
      // Numeração sequencial por empresa: o UPDATE trava a linha da empresa até o commit
      const { proximoNumeroOrcamento } = await tx.empresa.update({
        where: { id: ctx.empresaId },
        data: { proximoNumeroOrcamento: { increment: 1 } },
        select: { proximoNumeroOrcamento: true },
      });
      return this.repo.withTx(tx).create(ctx.empresaId, {
        numero: proximoNumeroOrcamento - 1,
        clienteId: body.clienteId,
        data: parseDateOnly(body.data ?? todayInTz(ctx.fusoHorario)),
        validade: body.validade ? parseDateOnly(body.validade) : null,
        observacoes: body.observacoes,
        subtotalCentavos: t.subtotalCentavos,
        descontoCentavos: t.descontoCentavos,
        acrescimoCentavos: t.acrescimoCentavos,
        totalCentavos: t.totalCentavos,
        itens: { create: t.itens },
      });
    });
    return serializar(criado);
  }

  async atualizar(ctx, id, body) {
    const atual = await this.#obterBruto(ctx, id);
    if (!['RASCUNHO', 'ENVIADO'].includes(atual.status)) {
      throw ApiError.unprocessable('Somente orçamentos em rascunho ou enviados podem ser editados.', 'ORCAMENTO_NAO_EDITAVEL');
    }
    if (body.clienteId) {
      const ok = await this.prisma.cliente.count({ where: { id: body.clienteId, empresaId: ctx.empresaId } });
      if (!ok) throw ApiError.unprocessable('Cliente não encontrado.', 'CLIENTE_INVALIDO');
    }
    const itens = body.itens
      ? await this.#montarItens(ctx, body.itens)
      : atual.itens.map(({ servicoId, descricao, quantidade, valorUnitarioCentavos }) => ({ servicoId, descricao, quantidade, valorUnitarioCentavos }));
    const t = this.#totais(itens, {
      descontoCentavos: body.descontoCentavos ?? atual.descontoCentavos,
      acrescimoCentavos: body.acrescimoCentavos ?? atual.acrescimoCentavos,
    });

    const atualizado = await this.prisma.$transaction(async (tx) => {
      if (body.itens) await tx.orcamentoItem.deleteMany({ where: { orcamentoId: id } });
      return this.repo.withTx(tx).update(ctx.empresaId, id, {
        clienteId: body.clienteId,
        data: body.data ? parseDateOnly(body.data) : undefined,
        validade: body.validade !== undefined ? parseDateOnly(body.validade) : undefined,
        observacoes: body.observacoes,
        subtotalCentavos: t.subtotalCentavos,
        descontoCentavos: t.descontoCentavos,
        acrescimoCentavos: t.acrescimoCentavos,
        totalCentavos: t.totalCentavos,
        ...(body.itens && { itens: { create: t.itens } }),
      });
    });
    return serializar(atualizado);
  }

  async alterarStatus(ctx, id, { status }) {
    const atual = await this.#obterBruto(ctx, id);
    if (!TRANSICOES[atual.status]?.includes(status)) {
      throw ApiError.unprocessable(`Não é possível alterar o orçamento de ${atual.status} para ${status}.`, 'TRANSICAO_INVALIDA');
    }
    const agora = new Date();
    const data = {
      status,
      ...(status === 'ENVIADO' && { enviadoEm: agora }),
      ...(status === 'APROVADO' && { aprovadoEm: agora }),
      ...(status === 'RECUSADO' && { recusadoEm: agora }),
    };
    const { count } = await this.prisma.orcamento.updateMany({ where: { id, empresaId: ctx.empresaId, status: atual.status }, data });
    if (count === 0) throw ApiError.conflict('O orçamento foi alterado por outra pessoa. Recarregue.', 'CONFLITO_CONCORRENCIA');
    return this.obter(ctx, id);
  }

  async remover(ctx, id) {
    const atual = await this.#obterBruto(ctx, id);
    if (atual.status !== 'RASCUNHO') throw ApiError.unprocessable('Somente rascunhos podem ser excluídos.', 'ORCAMENTO_NAO_REMOVIVEL');
    await this.repo.delete(ctx.empresaId, id);
    return null;
  }

  /** Orçamento aprovado -> atendimento na agenda, com os mesmos itens e valores. */
  async converter(ctx, id, { inicio, profissionalId, encaixe, observacoes }) {
    const orc = await this.#obterBruto(ctx, id);
    if (orc.status !== 'APROVADO') throw ApiError.unprocessable('Somente orçamentos aprovados podem virar atendimento.', 'ORCAMENTO_NAO_APROVADO');
    if (orc.atendimento) throw ApiError.conflict('Este orçamento já foi convertido em atendimento.', 'ORCAMENTO_JA_CONVERTIDO');
    if (orc.itens.some((i) => !i.servicoId)) {
      throw ApiError.unprocessable(
        'Itens avulsos (sem serviço cadastrado) não podem ir para a agenda. Vincule um serviço a cada item.',
        'ORCAMENTO_ITEM_SEM_SERVICO',
      );
    }
    return this.atendimentos.criar(
      ctx,
      {
        clienteId: orc.cliente.id,
        profissionalId,
        inicio,
        encaixe,
        observacoes: observacoes ?? orc.observacoes ?? undefined,
        descontoCentavos: orc.descontoCentavos,
        acrescimoCentavos: orc.acrescimoCentavos,
        itens: orc.itens.map((i) => ({ servicoId: i.servicoId, quantidade: i.quantidade, valorUnitarioCentavos: i.valorUnitarioCentavos })),
      },
      { orcamentoId: id },
    );
  }

  // ------------------------------------------------------------------ PDF

  async #dadosPdf(ctx, id) {
    const orc = await this.#obterBruto(ctx, id);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: ctx.empresaId },
      select: { nome: true, nomeFantasia: true, documento: true, email: true, telefone: true, whatsapp: true, endereco: true, aparencia: true },
    });
    const dados = { orcamento: serializar(orc), empresa };
    return { dados, versao: hashObject(dados) };
  }

  /**
   * Retorna o PDF se a versão atual já foi gerada; senão enfileira a geração e
   * devolve { status: 'PROCESSANDO' } (o front repete o GET em ~2s).
   */
  async pdf(ctx, id) {
    const { versao } = await this.#dadosPdf(ctx, id);
    const salvo = await this.prisma.orcamentoPdf.findUnique({ where: { orcamentoId: id }, select: { versao: true, conteudo: true, geradoEm: true } });
    if (salvo?.versao === versao) return { pronto: true, conteudo: salvo.conteudo, geradoEm: salvo.geradoEm };

    await this.queue.add(
      QUEUES.DOCUMENTOS,
      JOBS.PDF_ORCAMENTO,
      { empresaId: ctx.empresaId, orcamentoId: id, versao },
      { jobId: `pdf-${id}-${versao.slice(0, 16)}` },
    );
    return { pronto: false };
  }

  /** Executado pelo worker. */
  async gerarPdf({ empresaId, orcamentoId, versao }) {
    const ctx = { empresaId };
    const { dados, versao: atual } = await this.#dadosPdf(ctx, orcamentoId);
    if (atual !== versao) return { ignorado: 'versao-desatualizada' };
    const conteudo = await this.pdfRenderer.orcamento(dados);
    await this.prisma.orcamentoPdf.upsert({
      where: { orcamentoId },
      create: { orcamentoId, versao, conteudo },
      update: { versao, conteudo, geradoEm: new Date() },
      select: { orcamentoId: true },
    });
    return { bytes: conteudo.length };
  }

  /** Job diário: orçamentos enviados com validade vencida viram EXPIRADO. */
  async expirarVencidos() {
    const hoje = parseDateOnly(new Date().toISOString().slice(0, 10));
    const { count } = await this.prisma.orcamento.updateMany({ where: { status: 'ENVIADO', validade: { lt: hoje } }, data: { status: 'EXPIRADO' } });
    return { expirados: count };
  }
}
