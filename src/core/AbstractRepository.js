/**
 * AbstractRepository (Sotov adaptado para Prisma).
 *
 * Diferença principal para o Sotov original: em vez de receber um Model do
 * Sequelize, recebe o PrismaClient e o nome do delegate (ex.: 'cliente').
 *
 * ISOLAMENTO MULTI-TENANT
 * Repositórios com `tenantScoped: true` (padrão) EXIGEM `empresaId` como
 * primeiro argumento em toda operação e o injetam no `where`/`data`.
 * Esquecer o empresaId lança erro de programação — nunca vaza dado de outro tenant.
 *
 * TRANSAÇÕES
 * `repo.withTx(tx)` devolve uma cópia do repositório ligada à transação.
 *
 * SELECT EXPLÍCITO
 * Cada repositório define `defaultSelect`; nada de SELECT * por padrão.
 */
const MAX_PER_PAGE = 100;

export class AbstractRepository {
  /**
   * @param {import('@prisma/client').PrismaClient} prisma
   * @param {string} delegate nome do model no client (camelCase), ex.: 'cliente'
   * @param {{ tenantScoped?: boolean, defaultSelect?: object, defaultOrderBy?: object|object[] }} [options]
   */
  constructor(prisma, delegate, { tenantScoped = true, defaultSelect, defaultOrderBy } = {}) {
    this.db = prisma;
    this.delegate = delegate;
    this.tenantScoped = tenantScoped;
    this.defaultSelect = defaultSelect;
    this.defaultOrderBy = defaultOrderBy ?? { criadoEm: 'desc' };
  }

  get model() {
    return this.db[this.delegate];
  }

  /** Cópia do repositório que executa dentro da transação `tx`. */
  withTx(tx) {
    const clone = Object.create(Object.getPrototypeOf(this));
    Object.assign(clone, this, { db: tx });
    return clone;
  }

  scope(empresaId, where = {}) {
    if (!this.tenantScoped) return where;
    if (!empresaId) {
      throw new Error(`[${this.delegate}] empresaId é obrigatório em repositório multi-tenant`);
    }
    return { ...where, empresaId };
  }

  _select(select) {
    return select ?? this.defaultSelect;
  }

  async findById(empresaId, id, { select, include } = {}) {
    return this.model.findFirst({
      where: this.scope(empresaId, { id }),
      ...(include ? { include } : { select: this._select(select) }),
    });
  }

  async findOne(empresaId, where, { select, include, orderBy } = {}) {
    return this.model.findFirst({
      where: this.scope(empresaId, where),
      orderBy,
      ...(include ? { include } : { select: this._select(select) }),
    });
  }

  async findMany(empresaId, { where = {}, select, include, orderBy, skip, take } = {}) {
    return this.model.findMany({
      where: this.scope(empresaId, where),
      orderBy: orderBy ?? this.defaultOrderBy,
      skip,
      take: take ? Math.min(take, 1000) : undefined,
      ...(include ? { include } : { select: this._select(select) }),
    });
  }

  async count(empresaId, where = {}) {
    return this.model.count({ where: this.scope(empresaId, where) });
  }

  async exists(empresaId, where) {
    const found = await this.model.findFirst({ where: this.scope(empresaId, where), select: { id: true } });
    return Boolean(found);
  }

  /**
   * Paginação por offset com limite máximo garantido no servidor.
   * Lista + contagem rodam em uma única transação (snapshot consistente).
   */
  async paginate(empresaId, { where = {}, select, include, orderBy, page = 1, perPage = 20 } = {}) {
    const take = Math.min(Math.max(1, perPage), MAX_PER_PAGE);
    const skip = (Math.max(1, page) - 1) * take;
    const scoped = this.scope(empresaId, where);
    const [items, total] = await this.db.$transaction([
      this.model.findMany({
        where: scoped,
        orderBy: orderBy ?? this.defaultOrderBy,
        skip,
        take,
        ...(include ? { include } : { select: this._select(select) }),
      }),
      this.model.count({ where: scoped }),
    ]);
    return { items, total, page: Math.max(1, page), perPage: take };
  }

  async create(empresaId, data, { select, include } = {}) {
    return this.model.create({
      data: this.tenantScoped ? { ...data, empresaId: this.scope(empresaId).empresaId } : data,
      ...(include ? { include } : { select: this._select(select) }),
    });
  }

  /** Atualiza garantindo o tenant no where (P2025 -> 404 se não pertencer à empresa). */
  async update(empresaId, id, data, { select, include } = {}) {
    return this.model.update({
      where: this.scope(empresaId, { id }),
      data,
      ...(include ? { include } : { select: this._select(select) }),
    });
  }

  async delete(empresaId, id) {
    return this.model.delete({ where: this.scope(empresaId, { id }), select: { id: true } });
  }
}

export default AbstractRepository;
