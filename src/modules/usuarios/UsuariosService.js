/**
 * Equipe da empresa (módulo Multi-profissional): proprietário cria recepcionistas
 * e profissionais, define papéis e desativa acessos.
 */
import { AbstractRepository } from '../../core/AbstractRepository.js';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { paginated } from '../../core/http.js';
import { hashPassword } from '../../security/password.js';

// senhaHash NUNCA é selecionado aqui
export const USUARIO_SELECT = {
  id: true,
  nome: true,
  email: true,
  papel: true,
  ativo: true,
  ultimoLoginEm: true,
  criadoEm: true,
  profissional: { select: { id: true, nome: true } },
};

export class UsuariosRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'usuario', { defaultSelect: USUARIO_SELECT, defaultOrderBy: { nome: 'asc' } });
  }
}

export class UsuariosService extends AbstractService {
  constructor(deps) {
    super(deps);
    this.repo = deps.usuariosRepository;
  }

  async listar(ctx, { papel, ativo, page, perPage }) {
    const where = { ...(papel && { papel }), ...(ativo !== undefined && { ativo }) };
    const r = await this.repo.paginate(ctx.empresaId, { where, page, perPage, orderBy: { nome: 'asc' } });
    return paginated(r.items, r);
  }

  async obter(ctx, id) {
    return this.notFoundIfNull(await this.repo.findById(ctx.empresaId, id), 'Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');
  }

  async criar(ctx, { nome, email, senha, papel, profissionalId }) {
    const emUso = await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (emUso) throw ApiError.conflict('Este e-mail já está em uso.', 'EMAIL_EM_USO');
    if (profissionalId) {
      const p = await this.prisma.profissional.findFirst({ where: { id: profissionalId, empresaId: ctx.empresaId }, select: { usuarioId: true } });
      if (!p) throw ApiError.unprocessable('Profissional não encontrado.', 'PROFISSIONAL_INVALIDO');
      if (p.usuarioId) throw ApiError.conflict('Profissional já possui usuário.', 'PROFISSIONAL_JA_VINCULADO');
    }
    const senhaHash = await hashPassword(senha);
    const criado = await this.prisma.$transaction(async (tx) => {
      const u = await this.repo.withTx(tx).create(ctx.empresaId, { nome, email, senhaHash, papel });
      if (profissionalId) await tx.profissional.update({ where: { id: profissionalId }, data: { usuarioId: u.id }, select: { id: true } });
      await this.auditoria.registrar(
        { acao: 'USUARIO_CRIADO', entidade: 'Usuario', entidadeId: u.id, empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, dados: { papel }, ip: ctx.ip },
        tx,
      );
      return u;
    });
    return profissionalId ? this.obter(ctx, criado.id) : criado;
  }

  async #garantirOutroProprietario(ctx, id) {
    const outros = await this.prisma.usuario.count({ where: { empresaId: ctx.empresaId, papel: 'PROPRIETARIO', ativo: true, id: { not: id } } });
    if (!outros) throw ApiError.conflict('A empresa precisa de pelo menos um proprietário ativo.', 'ULTIMO_PROPRIETARIO');
  }

  async atualizar(ctx, id, { nome, papel, ativo, novaSenha }) {
    const atual = await this.obter(ctx, id);
    if (id === ctx.usuarioId && (ativo === false || (papel && papel !== atual.papel))) {
      throw ApiError.unprocessable('Você não pode desativar nem trocar o papel do próprio usuário.', 'ALTERACAO_PROPRIA_PROIBIDA');
    }
    if (atual.papel === 'PROPRIETARIO' && ((papel && papel !== 'PROPRIETARIO') || ativo === false)) await this.#garantirOutroProprietario(ctx, id);

    const atualizado = await this.prisma.$transaction(async (tx) => {
      const u = await this.repo.withTx(tx).update(ctx.empresaId, id, { nome, papel, ativo, ...(novaSenha && { senhaHash: await hashPassword(novaSenha) }) });
      if (ativo === false || novaSenha) await tx.refreshToken.updateMany({ where: { usuarioId: id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      if (papel || ativo !== undefined || novaSenha) {
        await this.auditoria.registrar(
          {
            acao: 'USUARIO_ALTERADO',
            entidade: 'Usuario',
            entidadeId: id,
            empresaId: ctx.empresaId,
            usuarioId: ctx.usuarioId,
            dados: { papel, ativo, senhaRedefinida: Boolean(novaSenha) },
            ip: ctx.ip,
          },
          tx,
        );
      }
      return u;
    });
    await this.contexto.invalidarUsuario(id);
    return atualizado;
  }
}
