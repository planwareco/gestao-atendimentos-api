/**
 * Contexto de sessão (usuário + empresa) com cache curto.
 *
 * Executado em TODA requisição autenticada, por isso fica em cache (30s).
 * Mudanças críticas (status da empresa, módulos, desativação de usuário)
 * chamam `invalidar*` para valer imediatamente.
 */
const TTL_SEC = 30;

export class ContextoService {
  constructor({ prisma, cache }) {
    this.prisma = prisma;
    this.cache = cache;
  }

  usuario(usuarioId) {
    return this.cache.wrap(`ctx:usuario:${usuarioId}`, TTL_SEC, async () => {
      const u = await this.prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { id: true, empresaId: true, papel: true, ativo: true, nome: true, profissional: { select: { id: true } } },
      });
      if (!u) return null;
      return { id: u.id, empresaId: u.empresaId, papel: u.papel, ativo: u.ativo, nome: u.nome, profissionalId: u.profissional?.id ?? null };
    });
  }

  empresa(empresaId) {
    return this.cache.wrap(`ctx:empresa:${empresaId}`, TTL_SEC, async () => {
      const e = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: {
          id: true,
          status: true,
          fusoHorario: true,
          modulos: { where: { ativo: true, modulo: { ativo: true } }, select: { moduloCodigo: true } },
        },
      });
      if (!e) return null;
      return { id: e.id, status: e.status, fusoHorario: e.fusoHorario, modulos: e.modulos.map((m) => m.moduloCodigo) };
    });
  }

  invalidarUsuario(usuarioId) {
    return this.cache.del(`ctx:usuario:${usuarioId}`);
  }

  invalidarEmpresa(empresaId) {
    return this.cache.del(`ctx:empresa:${empresaId}`);
  }
}
