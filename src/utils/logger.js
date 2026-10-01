/**
 * Logger estruturado (JSON) com pino.
 * Campos sensíveis são mascarados automaticamente — nunca logamos senha, token ou cartão.
 */
import pino from 'pino';
import { config } from '../config/env.js';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.senha',
  '*.senhaAtual',
  '*.novaSenha',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.cardToken',
  '*.codigo',
  '*.payerDocument',
  '*.totpSegredo',
  '*.senhaHash',
];

export const logger = pino({
  level: config.logLevel,
  base: { service: 'gestao-atendimentos-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export default logger;
