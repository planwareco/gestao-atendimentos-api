/**
 * Configuração centralizada.
 * Todas as variáveis de ambiente são lidas e validadas AQUI, uma única vez, no boot.
 * Se faltar algo obrigatório a aplicação nem sobe (fail fast).
 */
import 'dotenv/config';
import Joi from 'joi';

const isTest = process.env.NODE_ENV === 'test';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  APP_NAME: Joi.string().default('Gestão de Atendimentos'),
  APP_URL: Joi.string().uri().default('http://localhost:5173'), // URL do front (links em e-mails)
  API_URL: Joi.string().uri().default('http://localhost:3000'),
  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent').default('info'),
  TRUST_PROXY: Joi.alternatives(Joi.number(), Joi.boolean()).default(1),

  // Banco
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: Joi.number().integer().min(1000).default(15000),

  // Redis (opcional em dev/test: sem ele, cache/rate-limit ficam em memória e as filas rodam inline)
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .allow('')
    .default(''),

  // CORS: lista separada por vírgula
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),

  // Auth dos usuários dos tenants
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(90).default(30),

  // Auth do super admin (segredo separado)
  JWT_ADMIN_SECRET: Joi.string().min(32).required(),
  JWT_ADMIN_TTL: Joi.string().default('15m'),
  ADMIN_REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).max(30).default(7),
  ADMIN_REQUIRE_2FA: Joi.boolean().default(true),

  // Link de checkout (pagamento da adesão)
  CHECKOUT_TOKEN_SECRET: Joi.string().min(32).required(),
  CHECKOUT_TOKEN_TTL: Joi.string().default('72h'),

  // Chave AES-256 (64 hex) para cifrar segredos em repouso (ex.: TOTP do admin)
  ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  COOKIE_DOMAIN: Joi.string().allow('').default(''),

  // payment-system-mp
  PAYMENTS_API_URL: Joi.string().uri().required(),
  PAYMENTS_API_TOKEN: Joi.string().required(),
  PAYMENTS_PUBLIC_KEY: Joi.string().required(),
  PAYMENTS_TIMEOUT_MS: Joi.number().integer().min(1000).default(10000),

  // E-mail (Brevo). Sem chave, os e-mails só são registrados no log.
  BREVO_API_KEY: Joi.string().allow('').default(''),
  EMAIL_FROM: Joi.string().email().default('nao-responda@example.com'),
  EMAIL_FROM_NAME: Joi.string().default('Gestão de Atendimentos'),

  // PDF
  PUPPETEER_EXECUTABLE_PATH: Joi.string().allow('').default(''),
}).unknown(true);

// Em testes usamos valores fixos para não exigir .env
const testDefaults = isTest
  ? {
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
      JWT_ADMIN_SECRET: 'test-admin-secret-0123456789abcdef01234567890',
      CHECKOUT_TOKEN_SECRET: 'test-checkout-secret-0123456789abcdef012345',
      ENCRYPTION_KEY: '0'.repeat(64),
      PAYMENTS_API_URL: 'http://payments.test',
      PAYMENTS_API_TOKEN: 'pay_test_x',
      PAYMENTS_PUBLIC_KEY: 'TEST-public-key',
      LOG_LEVEL: 'silent',
      REDIS_URL: '',
      ADMIN_REQUIRE_2FA: 'false',
    }
  : {};

// Em teste estes valores SEMPRE vencem o .env: banco separado, sem Redis, log silencioso
function pickTestOverrides() {
  return {
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/atend_test',
    REDIS_URL: '',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    ADMIN_REQUIRE_2FA: 'false',
    PAYMENTS_API_URL: 'http://payments.test',
  };
}

const { value, error } = schema.validate(
  { ...testDefaults, ...process.env, ...(isTest ? pickTestOverrides() : {}) },
  {
    abortEarly: false,
    convert: true,
  },
);

if (error) {
  // Logger ainda não existe aqui; console é aceitável para erro fatal de boot
  console.error('❌ Variáveis de ambiente inválidas:\n' + error.details.map((d) => ` - ${d.message}`).join('\n'));
  process.exit(1);
}

export const config = Object.freeze({
  env: value.NODE_ENV,
  isProd: value.NODE_ENV === 'production',
  isTest: value.NODE_ENV === 'test',
  port: value.PORT,
  appName: value.APP_NAME,
  appUrl: value.APP_URL.replace(/\/$/, ''),
  apiUrl: value.API_URL.replace(/\/$/, ''),
  logLevel: value.LOG_LEVEL,
  trustProxy: value.TRUST_PROXY,
  db: {
    url: value.DATABASE_URL,
    poolMax: value.DATABASE_POOL_MAX,
    statementTimeoutMs: value.DATABASE_STATEMENT_TIMEOUT_MS,
  },
  redisUrl: value.REDIS_URL || null,
  corsOrigins: value.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  auth: {
    accessSecret: value.JWT_ACCESS_SECRET,
    accessTtl: value.JWT_ACCESS_TTL,
    refreshTtlDays: value.REFRESH_TOKEN_TTL_DAYS,
    adminSecret: value.JWT_ADMIN_SECRET,
    adminTtl: value.JWT_ADMIN_TTL,
    adminRefreshTtlDays: value.ADMIN_REFRESH_TOKEN_TTL_DAYS,
    adminRequire2fa: value.ADMIN_REQUIRE_2FA,
    checkoutSecret: value.CHECKOUT_TOKEN_SECRET,
    checkoutTtl: value.CHECKOUT_TOKEN_TTL,
    cookieDomain: value.COOKIE_DOMAIN || undefined,
  },
  encryptionKey: value.ENCRYPTION_KEY,
  payments: {
    baseUrl: value.PAYMENTS_API_URL.replace(/\/$/, ''),
    apiToken: value.PAYMENTS_API_TOKEN,
    publicKey: value.PAYMENTS_PUBLIC_KEY,
    timeoutMs: value.PAYMENTS_TIMEOUT_MS,
  },
  email: {
    brevoApiKey: value.BREVO_API_KEY || null,
    from: value.EMAIL_FROM,
    fromName: value.EMAIL_FROM_NAME,
  },
  pdf: {
    executablePath: value.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});
