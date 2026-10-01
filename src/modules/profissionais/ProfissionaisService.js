import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';

export const PROFISSIONAL_SELECT = {
  id: true,
  nome: true,
  email: true,
  telefone: true,
  cor: true,
  comissaoBps: true,
  horarioTrabalho: true,
  status: true,
  usuarioId: true,
  criadoEm: true,
  atualizadoEm: true,
  servicos: { select: { servico: { select: { id: true, nome: true } } } },
};

const serializar = (p) => (p ? { ...p, servicos: p.servicos.map((s) => s.servico) } : p);

export class ProfissionaisRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'profissional', { defaultSelect: PROFISSIONAL_SELECT, defaultOrderBy: { nome: 'asc' } });
  }
}

export class ProfissionaisService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.profissionaisRepository;
  }

  async listar(ctx, { status, servicoId, page, perPage }) {
    const where = { ...(status && { status }), ...(servicoId && { servicos: { some: { servicoId } } }) };
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy: { nome: 'asc' } });
    return paginated(r.items.map(serializar), r);
  }

  async obter(ctx, id) {
    return serializar(this.notFoundIfNull(await this.repo.findById(ctx.empresaId, id), 'Profissional não encontrado.', 'PROFISSIONAL_NAO_ENCONTRADO'));
  }

  async #validarVinculos(ctx, { servicoIds, usuarioId }, profissionalId) {
    if (servicoIds?.length) {
      const total = await this.prisma.servico.count({ where: { empresaId: ctx.empresaId, id: { in: servicoIds } } });
      if (total !== servicoIds.length) throw ApiError.unprocessable('Um ou mais serviços não pertencem à empresa.', 'SERVICO_INVALIDO');
    }
    if (usuarioId) {
      const u = await this.prisma.usuario.findFirst({
        where: { id: usuarioId, empresaId: ctx.empresaId },
        select: { id: true, profissional: { select: { id: true } } },
      });
      if (!u) throw ApiError.unprocessable('Usuário não pertence à empresa.', 'USUARIO_INVALIDO');
      if (u.profissional && u.profissional.id !== profissionalId)
        throw ApiError.conflict('Este usuário já está vinculado a outro profissional.', 'USUARIO_JA_VINCULADO');
    }
  }

  async criar(ctx, { servicoIds = [], ...data }) {
    await this.#validarVinculos(ctx, { servicoIds, usuarioId: data.usuarioId });
    const criado = await this.repo.create(ctx.empresaId, {
      ...data,
      servicos: { create: servicoIds.map((servicoId) => ({ servicoId })) },
    });
    if (data.usuarioId) await this.contexto.invalidarUsuario(data.usuarioId);
    return serializar(criado);
  }

  async atualizar(ctx, id, { servicoIds, ...data }) {
    const atual = await this.obter(ctx, id);
    await this.#validarVinculos(ctx, { servicoIds, usuarioId: data.usuarioId }, id);
    const atualizado = await this.prisma.$transaction(async (tx) => {
      if (servicoIds) {
        await tx.profissionalServico.deleteMany({ where: { profissionalId: id } });
        if (servicoIds.length) await tx.profissionalServico.createMany({ data: servicoIds.map((servicoId) => ({ profissionalId: id, servicoId })) });
      }
      return this.repo.withTx(tx).update(ctx.empresaId, id, data);
    });
    // vínculo com usuário muda o "profissionalId" da sessão
    await Promise.all([atual.usuarioId, data.usuarioId].filter(Boolean).map((u) => this.contexto.invalidarUsuario(u)));
    return serializar(atualizado);
  }

  async remover(ctx, id) {
    const atual = await this.obter(ctx, id);
    const usado = await this.prisma.atendimento.count({ where: { empresaId: ctx.empresaId, profissionalId: id } });
    if (usado) throw ApiError.conflict('Profissional possui atendimentos. Inative-o em vez de excluir.', 'PROFISSIONAL_COM_HISTORICO');
    await this.repo.delete(ctx.empresaId, id);
    if (atual.usuarioId) await this.contexto.invalidarUsuario(atual.usuarioId);
    return null;
  }
}
