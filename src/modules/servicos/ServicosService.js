import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';

export const SERVICO_SELECT = {
  id: true,
  nome: true,
  descricao: true,
  categoria: true,
  valorCentavos: true,
  duracaoMinutos: true,
  status: true,
  criadoEm: true,
  atualizadoEm: true,
};

export class ServicosRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'servico', { defaultSelect: SERVICO_SELECT, defaultOrderBy: { nome: 'asc' } });
  }

  /** Busca vários serviços da empresa de uma vez (evita N+1 ao montar itens). */
  findManyByIds(empresaId, ids) {
    return this.findMany(empresaId, { where: { id: { in: [...new Set(ids)] } } });
  }
}

export class ServicosService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.servicosRepository;
  }

  async listar(ctx, { busca, status, categoria, page, perPage }) {
    const where = {
      ...(status && { status }),
      ...(categoria && { categoria }),
      ...(busca && { nome: { contains: busca, mode: 'insensitive' } }),
    };
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy: { nome: 'asc' } });
    return paginated(r.items, r);
  }

  async categorias(ctx) {
    const rows = await this.prisma.servico.findMany({
      where: { empresaId: ctx.empresaId, categoria: { not: null } },
      distinct: ['categoria'],
      select: { categoria: true },
      orderBy: { categoria: 'asc' },
    });
    return rows.map((r) => r.categoria);
  }

  async obter(ctx, id) {
    return this.notFoundIfNull(await this.repo.findById(ctx.empresaId, id), 'Serviço não encontrado.', 'SERVICO_NAO_ENCONTRADO');
  }

  criar(ctx, body) {
    return this.repo.create(ctx.empresaId, body);
  }

  async atualizar(ctx, id, body) {
    await this.obter(ctx, id);
    return this.repo.update(ctx.empresaId, id, body);
  }

  async remover(ctx, id) {
    await this.obter(ctx, id);
    const usado = await this.prisma.atendimentoItem.count({ where: { servicoId: id } });
    if (usado) throw ApiError.conflict('Serviço já usado em atendimentos. Inative-o em vez de excluir.', 'SERVICO_EM_USO');
    await this.repo.delete(ctx.empresaId, id);
    return null;
  }
}
