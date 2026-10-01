/**
 * Auditoria de operações sensíveis (mudança de status de empresa, módulos,
 * papéis de usuário, ativação de assinatura, login de admin...).
 *
 * `registrar` aceita um client de transação para gravar junto com a operação.
 * Falha de auditoria fora de transação NÃO derruba a operação principal.
 */
export class AuditoriaService {
  constructor({ prisma, logger }) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async registrar({ acao, entidade, entidadeId, empresaId, adminId, usuarioId, dados, ip }, tx) {
    const db = tx ?? this.prisma;
    const data = { acao, entidade, entidadeId: entidadeId ? String(entidadeId) : null, empresaId, adminId, usuarioId, dados, ip };
    if (tx) return db.logAuditoria.create({ data, select: { id: true } });
    try {
      return await db.logAuditoria.create({ data, select: { id: true } });
    } catch (err) {
      this.logger.error({ err: err.message, acao }, 'Falha ao registrar auditoria');
      return null;
    }
  }

  async listar({ empresaId, adminId, acao, page, perPage }) {
    const where = { ...(empresaId && { empresaId }), ...(adminId && { adminId }), ...(acao && { acao }) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.logAuditoria.findMany({
        where,
        orderBy: { criadoEm: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          acao: true,
          entidade: true,
          entidadeId: true,
          empresaId: true,
          adminId: true,
          usuarioId: true,
          dados: true,
          ip: true,
          criadoEm: true,
        },
      }),
      this.prisma.logAuditoria.count({ where }),
    ]);
    return { items, total, page, perPage };
  }
}
