/**
 * Refresh tokens opacos, rotativos e revogáveis.
 *
 * - O valor em texto puro só existe no cookie do cliente; no banco fica o SHA-256.
 * - A cada uso, o token é revogado e um novo é emitido na mesma "família".
 * - Reuso de token já revogado = possível vazamento -> derruba a família inteira.
 *
 * Reaproveitado para usuários (refreshToken) e admins (adminRefreshToken).
 */
import crypto from 'node:crypto';
import { ApiError } from '../core/ApiError.js';
import { randomToken, sha256 } from './crypto.js';

export class RefreshTokenManager {
  constructor({ prisma, delegate, subjectField, ttlDays, logger }) {
    this.prisma = prisma;
    this.delegate = delegate;
    this.subjectField = subjectField;
    this.ttlDays = ttlDays;
    this.logger = logger;
  }

  #model(tx) {
    return (tx ?? this.prisma)[this.delegate];
  }

  async emitir(subjectId, { familia = crypto.randomUUID(), ip, userAgent } = {}, tx) {
    const token = randomToken();
    const expiraEm = new Date(Date.now() + this.ttlDays * 86_400_000);
    await this.#model(tx).create({
      data: {
        [this.subjectField]: subjectId,
        tokenHash: sha256(token),
        familia,
        expiraEm,
        ip: ip?.slice(0, 64),
        userAgent: userAgent?.slice(0, 300),
      },
      select: { id: true },
    });
    return { token, expiraEm };
  }

  async rotacionar(token, { ip, userAgent } = {}) {
    if (!token) throw ApiError.unauthorized('Sessão expirada. Faça login novamente.', 'REFRESH_INVALIDO');
    const atual = await this.#model().findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, familia: true, expiraEm: true, revogadoEm: true, [this.subjectField]: true },
    });
    if (!atual) throw ApiError.unauthorized('Sessão expirada. Faça login novamente.', 'REFRESH_INVALIDO');

    if (atual.revogadoEm) {
      // Reuso de token revogado: alguém pode ter roubado o token — encerra a sessão inteira.
      await this.#model().updateMany({ where: { familia: atual.familia, revogadoEm: null }, data: { revogadoEm: new Date() } });
      this.logger?.warn({ familia: atual.familia }, 'Reuso de refresh token detectado — família revogada');
      throw ApiError.unauthorized('Sessão encerrada por segurança. Faça login novamente.', 'REFRESH_REUTILIZADO');
    }
    if (atual.expiraEm < new Date()) throw ApiError.unauthorized('Sessão expirada. Faça login novamente.', 'REFRESH_EXPIRADO');

    return this.prisma.$transaction(async (tx) => {
      // updateMany com condição = trava otimista contra duas rotações simultâneas
      const { count } = await this.#model(tx).updateMany({ where: { id: atual.id, revogadoEm: null }, data: { revogadoEm: new Date() } });
      if (count === 0) throw ApiError.unauthorized('Sessão expirada. Faça login novamente.', 'REFRESH_INVALIDO');
      const novo = await this.emitir(atual[this.subjectField], { familia: atual.familia, ip, userAgent }, tx);
      return { subjectId: atual[this.subjectField], ...novo };
    });
  }

  async revogar(token) {
    if (!token) return;
    await this.#model().updateMany({ where: { tokenHash: sha256(token), revogadoEm: null }, data: { revogadoEm: new Date() } });
  }

  async revogarTodos(subjectId, tx) {
    await this.#model(tx).updateMany({ where: { [this.subjectField]: subjectId, revogadoEm: null }, data: { revogadoEm: new Date() } });
  }

  async limparExpirados(antesDe = new Date(Date.now() - 7 * 86_400_000)) {
    const { count } = await this.#model().deleteMany({ where: { expiraEm: { lt: antesDe } } });
    return count;
  }
}

/** Cookie httpOnly do refresh token. */
export function setRefreshCookie(res, { name, token, expiraEm, path, isProd, domain }) {
  res.cookie(name, token, {
    httpOnly: true,
    secure: isProd,
    // front (Vercel) e API (Render) em domínios diferentes exigem SameSite=None em produção
    sameSite: isProd ? 'none' : 'lax',
    path,
    domain,
    expires: expiraEm,
  });
}

export function clearRefreshCookie(res, { name, path, isProd, domain }) {
  res.clearCookie(name, { httpOnly: true, secure: isProd, sameSite: isProd ? 'none' : 'lax', path, domain });
}
