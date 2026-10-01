/**
 * Despesas (conceito financeiro) e categorias configuráveis.
 * "Insumo" é só uma categoria de despesa — funciona para qualquer segmento.
 */
import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';
import { formatDateOnly, parseDateOnly } from '../../utils/dates.js';

export const DESPESA_SELECT = {
  id: true,
  descricao: true,
  valorCentavos: true,
  data: true,
  formaPagamento: true,
  observacao: true,
  status: true,
  criadoEm: true,
  atualizadoEm: true,
  categoria: { select: { id: true, nome: true, cor: true } },
};

const serializar = (d) => (d ? { ...d, data: formatDateOnly(d.data) } : d);

export class DespesasRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'despesa', { defaultSelect: DESPESA_SELECT, defaultOrderBy: [{ data: 'desc' }, { criadoEm: 'desc' }] });
  }
}

export class CategoriasDespesaRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'categoriaDespesa', { defaultSelect: { id: true, nome: true, cor: true, ativo: true }, defaultOrderBy: { nome: 'asc' } });
  }
}

export class DespesasService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.despesasRepository;
    this.categorias = deps.categoriasDespesaRepository;
  }

  async listar(ctx, { inicio, fim, categoriaId, status, busca, page, perPage }) {
    const where = {
      ...(categoriaId && { categoriaId }),
      ...(status && { status }),
      ...(busca && { descricao: { contains: busca, mode: 'insensitive' } }),
      ...((inicio || fim) && { data: { ...(inicio && { gte: parseDateOnly(inicio) }), ...(fim && { lte: parseDateOnly(fim) }) } }),
    };
    const [r, soma] = await Promise.all([
      this.repo.paginate(ctx.empresaId, { where, page, perPage }),
      this.prisma.despesa.aggregate({ where: { ...where, empresaId: ctx.empresaId }, _sum: { valorCentavos: true } }),
    ]);
    const res = paginated(r.items.map(serializar), r);
    res.meta.totalValorCentavos = soma._sum.valorCentavos ?? 0;
    return res;
  }

  async obter(ctx, id) {
    return serializar(this.notFoundIfNull(await this.repo.findById(ctx.empresaId, id), 'Despesa não encontrada.', 'DESPESA_NAO_ENCONTRADA'));
  }

  async #validarCategoria(ctx, categoriaId) {
    if (!categoriaId) return;
    const ok = await this.categorias.exists(ctx.empresaId, { id: categoriaId });
    if (!ok) throw ApiError.unprocessable('Categoria não encontrada.', 'CATEGORIA_INVALIDA', [{ field: 'categoriaId', message: 'Categoria não encontrada.' }]);
  }

  async criar(ctx, body) {
    await this.#validarCategoria(ctx, body.categoriaId);
    const criada = await this.repo.create(ctx.empresaId, { ...body, data: parseDateOnly(body.data) });
    await this.cache.bump(`dash:${ctx.empresaId}`);
    return serializar(criada);
  }

  async atualizar(ctx, id, body) {
    await this.obter(ctx, id);
    await this.#validarCategoria(ctx, body.categoriaId);
    const atualizada = await this.repo.update(ctx.empresaId, id, { ...body, ...(body.data && { data: parseDateOnly(body.data) }) });
    await this.cache.bump(`dash:${ctx.empresaId}`);
    return serializar(atualizada);
  }

  async remover(ctx, id) {
    await this.obter(ctx, id);
    await this.repo.delete(ctx.empresaId, id);
    await this.cache.bump(`dash:${ctx.empresaId}`);
    return null;
  }

  // ---- categorias
  listarCategorias(ctx, { incluirInativas }) {
    return this.categorias.findMany(ctx.empresaId, { where: incluirInativas ? {} : { ativo: true } });
  }

  criarCategoria(ctx, body) {
    return this.categorias.create(ctx.empresaId, body);
  }

  async atualizarCategoria(ctx, id, body) {
    this.notFoundIfNull(await this.categorias.findById(ctx.empresaId, id), 'Categoria não encontrada.', 'CATEGORIA_NAO_ENCONTRADA');
    return this.categorias.update(ctx.empresaId, id, body);
  }

  async removerCategoria(ctx, id) {
    this.notFoundIfNull(await this.categorias.findById(ctx.empresaId, id), 'Categoria não encontrada.', 'CATEGORIA_NAO_ENCONTRADA');
    const usada = await this.repo.count(ctx.empresaId, { categoriaId: id });
    if (usada) throw ApiError.conflict('Categoria com despesas lançadas. Desative-a em vez de excluir.', 'CATEGORIA_EM_USO');
    await this.categorias.delete(ctx.empresaId, id);
    return null;
  }
}
