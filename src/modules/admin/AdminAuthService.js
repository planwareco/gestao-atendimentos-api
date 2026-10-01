/**
 * Autenticação do super admin da plataforma (separada dos tenants).
 * E-mail + senha + 2FA (TOTP: Google Authenticator, Authy, 1Password...).
 */
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { burnPasswordCheck, verifyPassword } from '../../security/password.js';
import { signAdminAccess, signAdminMfa, verifyAdminMfa } from '../../security/tokens.js';
import { decrypt, encrypt } from '../../security/crypto.js';

const INVALIDO = () => ApiError.unauthorized('E-mail ou senha inválidos.', 'CREDENCIAIS_INVALIDAS');

export class AdminAuthService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  carregarAdminAtivo(adminId) {
    return this.cache.wrap(`ctx:admin:${adminId}`, 30, async () =>
      this.prisma.admin.findFirst({ where: { id: adminId, ativo: true }, select: { id: true, nome: true, email: true, totpAtivo: true } }),
    );
  }

  async login({ email, senha }, meta) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, senhaHash: true, ativo: true, totpAtivo: true },
    });
    if (!admin) {
      await burnPasswordCheck(senha);
      throw INVALIDO();
    }
    if (!(await verifyPassword(admin.senhaHash, senha))) {
      await this.auditoria.registrar({ acao: 'ADMIN_LOGIN_FALHOU', entidade: 'Admin', entidadeId: admin.id, adminId: admin.id, ip: meta.ip });
      throw INVALIDO();
    }
    if (!admin.ativo) throw ApiError.forbidden('Conta de administrador desativada.', 'ADMIN_INATIVO');

    if (admin.totpAtivo) {
      return { mfaObrigatorio: true, mfaToken: signAdminMfa({ adminId: admin.id }) };
    }
    return this.#sessao(admin.id, meta);
  }

  async verificar2fa({ mfaToken, codigo }, meta) {
    const { sub } = verifyAdminMfa(mfaToken);
    const admin = await this.prisma.admin.findFirst({ where: { id: sub, ativo: true }, select: { id: true, totpSegredoCifrado: true, totpAtivo: true } });
    if (!admin?.totpAtivo) throw ApiError.unauthorized('Faça login novamente.', 'MFA_TOKEN_INVALIDO');
    if (!(await this.#codigoValido(admin.totpSegredoCifrado, codigo))) {
      await this.auditoria.registrar({ acao: 'ADMIN_2FA_FALHOU', entidade: 'Admin', entidadeId: admin.id, adminId: admin.id, ip: meta.ip });
      throw ApiError.unauthorized('Código de verificação inválido.', 'CODIGO_2FA_INVALIDO');
    }
    return this.#sessao(admin.id, meta);
  }

  async #codigoValido(segredoCifrado, codigo) {
    const result = await verifyTotp({ secret: decrypt(segredoCifrado), token: codigo, epochTolerance: 30 });
    return Boolean(result?.valid);
  }

  async #sessao(adminId, meta) {
    const admin = await this.prisma.admin.update({
      where: { id: adminId },
      data: { ultimoLoginEm: new Date() },
      select: { id: true, nome: true, email: true, totpAtivo: true },
    });
    await this.auditoria.registrar({ acao: 'ADMIN_LOGIN', entidade: 'Admin', entidadeId: adminId, adminId, ip: meta.ip });
    const refresh = await this.refreshTokens.emitir(adminId, meta);
    return {
      accessToken: signAdminAccess({ adminId }),
      tokenType: 'Bearer',
      expiresIn: this.config.auth.adminTtl,
      admin,
      mfaConfiguracaoObrigatoria: this.config.auth.adminRequire2fa && !admin.totpAtivo,
      refresh,
    };
  }

  async refresh(token, meta) {
    const rotated = await this.refreshTokens.rotacionar(token, meta);
    const admin = await this.prisma.admin.findFirst({
      where: { id: rotated.subjectId, ativo: true },
      select: { id: true, nome: true, email: true, totpAtivo: true },
    });
    if (!admin) {
      await this.refreshTokens.revogarTodos(rotated.subjectId);
      throw ApiError.unauthorized('Sessão encerrada.', 'SESSAO_INVALIDA');
    }
    return {
      accessToken: signAdminAccess({ adminId: admin.id }),
      tokenType: 'Bearer',
      expiresIn: this.config.auth.adminTtl,
      admin,
      mfaConfiguracaoObrigatoria: this.config.auth.adminRequire2fa && !admin.totpAtivo,
      refresh: { token: rotated.token, expiraEm: rotated.expiraEm },
    };
  }

  logout(token) {
    return this.refreshTokens.revogar(token);
  }

  /** Gera um novo segredo TOTP (ainda inativo até confirmar com um código). */
  async configurar2fa(admin) {
    const segredo = generateSecret();
    await this.prisma.admin.update({ where: { id: admin.id }, data: { totpSegredoCifrado: encrypt(segredo), totpAtivo: false }, select: { id: true } });
    await this.cache.del(`ctx:admin:${admin.id}`);
    return {
      otpauthUrl: generateURI({ issuer: this.config.appName, label: admin.email, secret: segredo }),
      segredo,
      instrucoes: 'Escaneie o QR Code (gerado a partir do otpauthUrl) no app autenticador e confirme com um código em POST /v1/admin/auth/2fa/ativar.',
    };
  }

  async ativar2fa(admin, { codigo }) {
    const a = await this.prisma.admin.findUnique({ where: { id: admin.id }, select: { totpSegredoCifrado: true } });
    if (!a?.totpSegredoCifrado) throw ApiError.unprocessable('Configure o 2FA antes de ativar.', 'MFA_NAO_CONFIGURADO');
    if (!(await this.#codigoValido(a.totpSegredoCifrado, codigo))) throw ApiError.unprocessable('Código de verificação inválido.', 'CODIGO_2FA_INVALIDO');
    await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({ where: { id: admin.id }, data: { totpAtivo: true }, select: { id: true } });
      await this.auditoria.registrar({ acao: 'ADMIN_2FA_ATIVADO', entidade: 'Admin', entidadeId: admin.id, adminId: admin.id, ip: admin.ip }, tx);
    });
    await this.cache.del(`ctx:admin:${admin.id}`);
    return { totpAtivo: true };
  }
}
