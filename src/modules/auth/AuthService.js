/**
 * Autenticação dos usuários dos tenants.
 * Access token JWT curto (15 min) + refresh token opaco rotativo (cookie httpOnly).
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../../security/password.js';
import { signCheckout, signUsuarioAccess } from '../../security/tokens.js';
import { permissoesEfetivas } from '../../security/permissions.js';

const CREDENCIAIS_INVALIDAS = () => ApiError.unauthorized('E-mail ou senha inválidos.', 'CREDENCIAIS_INVALIDAS');

export class AuthService extends AbstractService {
  /**
   * @param {{ prisma, refreshTokens: import('../../security/RefreshTokenManager.js').RefreshTokenManager,
   *           contexto, auditoria, config }} deps
   */
  constructor(deps) {
    super(deps);
  }

  async login({ email, senha }, meta) {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, empresaId: true, senhaHash: true, ativo: true, papel: true, empresa: { select: { status: true } } },
    });
    if (!usuario) {
      await burnPasswordCheck(senha);
      throw CREDENCIAIS_INVALIDAS();
    }
    if (!(await verifyPassword(usuario.senhaHash, senha))) throw CREDENCIAIS_INVALIDAS();
    if (!usuario.ativo) throw ApiError.forbidden('Usuário desativado. Fale com o responsável pela sua empresa.', 'USUARIO_INATIVO');
    if (usuario.empresa.status === 'DESATIVADO') {
      throw ApiError.forbidden('O acesso desta empresa está desativado. Entre em contato com o suporte.', 'EMPRESA_DESATIVADA');
    }

    await this.prisma.usuario.update({ where: { id: usuario.id }, data: { ultimoLoginEm: new Date() }, select: { id: true } });
    const refresh = await this.refreshTokens.emitir(usuario.id, meta);
    return { ...(await this.#sessao(usuario.id)), refresh };
  }

  async refresh(token, meta) {
    const rotated = await this.refreshTokens.rotacionar(token, meta);
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: rotated.subjectId },
      select: { ativo: true, empresa: { select: { status: true } } },
    });
    if (!usuario?.ativo || usuario.empresa.status === 'DESATIVADO') {
      await this.refreshTokens.revogarTodos(rotated.subjectId);
      throw ApiError.unauthorized('Sessão encerrada.', 'SESSAO_INVALIDA');
    }
    return { ...(await this.#sessao(rotated.subjectId)), refresh: { token: rotated.token, expiraEm: rotated.expiraEm } };
  }

  logout(token) {
    return this.refreshTokens.revogar(token);
  }

  /** Abre sessão para um usuário recém-criado (ex.: logo após o cadastro). */
  async iniciarSessao(usuarioId, meta) {
    const refresh = await this.refreshTokens.emitir(usuarioId, meta);
    return { ...(await this.#sessao(usuarioId)), refresh };
  }

  async #sessao(usuarioId) {
    const perfil = await this.perfil(usuarioId);
    const accessToken = signUsuarioAccess({ usuarioId, empresaId: perfil.empresa.id, papel: perfil.usuario.papel });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.config.auth.accessTtl, ...perfil };
  }

  /** Dados que o front precisa para montar a sessão (menu, tema, permissões). */
  async perfil(usuarioId) {
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        nome: true,
        email: true,
        papel: true,
        profissional: { select: { id: true } },
        empresa: {
          select: {
            id: true,
            nome: true,
            nomeFantasia: true,
            segmento: true,
            status: true,
            aparencia: true,
            camposPersonalizados: true,
            fusoHorario: true,
            valorMensalCentavos: true,
            modulos: { where: { ativo: true }, select: { moduloCodigo: true } },
          },
        },
      },
    });
    this.notFoundIfNull(u, 'Usuário não encontrado.');
    const modulos = u.empresa.modulos.map((m) => m.moduloCodigo);
    const { modulos: _ignored, ...empresa } = u.empresa;
    return {
      usuario: { id: u.id, nome: u.nome, email: u.email, papel: u.papel, profissionalId: u.profissional?.id ?? null },
      empresa: { ...empresa, modulos },
      permissoes: [...permissoesEfetivas(u.papel, modulos)].sort(),
    };
  }

  async alterarSenha(ctx, { senhaAtual, novaSenha }) {
    const u = await this.prisma.usuario.findUnique({ where: { id: ctx.usuarioId }, select: { senhaHash: true } });
    if (!(await verifyPassword(u.senhaHash, senhaAtual))) {
      throw ApiError.unprocessable('Senha atual incorreta.', 'SENHA_ATUAL_INCORRETA');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: ctx.usuarioId }, data: { senhaHash: await hashPassword(novaSenha) }, select: { id: true } });
      await this.refreshTokens.revogarTodos(ctx.usuarioId, tx);
    });
    await this.auditoria.registrar({
      acao: 'USUARIO_SENHA_ALTERADA',
      entidade: 'Usuario',
      entidadeId: ctx.usuarioId,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      ip: ctx.ip,
    });
    return { message: 'Senha alterada. Faça login novamente nos outros dispositivos.' };
  }

  /** Novo link de pagamento da adesão (empresa ainda PENDENTE). */
  async linkCheckout(ctx) {
    if (ctx.statusEmpresa !== 'PENDENTE') throw ApiError.conflict('A assinatura desta empresa já está ativa.', 'ASSINATURA_JA_ATIVA');
    if (ctx.papel !== 'PROPRIETARIO') throw ApiError.forbidden('Somente o proprietário pode concluir o pagamento.', 'PERMISSAO_NEGADA');
    const token = signCheckout({ empresaId: ctx.empresaId });
    return { checkoutToken: token, checkoutApiBaseUrl: `${this.config.apiUrl}/v1/checkout/${token}`, checkoutUrl: `${this.config.appUrl}/checkout/${token}` };
  }
}
