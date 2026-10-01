/**
 * Emissão/validação de JWTs.
 * Três "audiências" com segredos distintos — um token nunca serve em outro contexto:
 *   - usuario  (access token dos usuários dos tenants)
 *   - admin    (access token do super admin) + admin-mfa (etapa intermediária do 2FA)
 *   - checkout (link de pagamento da adesão)
 */
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { ApiError } from '../core/ApiError.js';

const ISSUER = 'gestao-atendimentos-api';

function sign(payload, secret, { audience, expiresIn }) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', issuer: ISSUER, audience, expiresIn });
}

function verify(token, secret, audience, { code = 'TOKEN_INVALIDO', message = 'Token inválido ou expirado.' } = {}) {
  try {
    return jwt.verify(token, secret, { algorithms: ['HS256'], issuer: ISSUER, audience });
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new ApiError(401, 'Sessão expirada.', 'TOKEN_EXPIRADO');
    throw new ApiError(401, message, code);
  }
}

export const signUsuarioAccess = ({ usuarioId, empresaId, papel }) =>
  sign({ sub: usuarioId, emp: empresaId, papel }, config.auth.accessSecret, { audience: 'usuario', expiresIn: config.auth.accessTtl });

export const verifyUsuarioAccess = (token) => verify(token, config.auth.accessSecret, 'usuario');

export const signAdminAccess = ({ adminId }) => sign({ sub: adminId }, config.auth.adminSecret, { audience: 'admin', expiresIn: config.auth.adminTtl });

export const verifyAdminAccess = (token) => verify(token, config.auth.adminSecret, 'admin');

export const signAdminMfa = ({ adminId }) => sign({ sub: adminId }, config.auth.adminSecret, { audience: 'admin-mfa', expiresIn: '5m' });

export const verifyAdminMfa = (token) =>
  verify(token, config.auth.adminSecret, 'admin-mfa', { code: 'MFA_TOKEN_INVALIDO', message: 'Etapa de verificação expirada. Faça login novamente.' });

export const signCheckout = ({ empresaId }) =>
  sign({ sub: empresaId }, config.auth.checkoutSecret, { audience: 'checkout', expiresIn: config.auth.checkoutTtl });

export const verifyCheckout = (token) =>
  verify(token, config.auth.checkoutSecret, 'checkout', { code: 'CHECKOUT_INVALIDO', message: 'Link de pagamento inválido ou expirado.' });

export function extractBearer(req) {
  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}
