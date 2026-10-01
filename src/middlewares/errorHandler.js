/**
 * Tratamento CENTRALIZADO de erros. Deve ser o último middleware.
 * - ApiError -> status/código definidos no service
 * - Erros conhecidos do Prisma -> 404/409 com mensagem amigável
 * - Qualquer outro -> 500 genérico (detalhes só no log, nunca na resposta)
 */
import { Prisma } from '@prisma/client';
import { ApiError } from '../core/ApiError.js';
import { sendError } from '../core/http.js';

function fromPrisma(err) {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case 'P2002': {
      const target = err.meta?.target ?? err.meta?.driverAdapterError?.cause?.constraint?.fields;
      const fields = Array.isArray(target) ? target.filter((f) => f !== 'empresaId' && f !== 'empresa_id') : [];
      return new ApiError(
        409,
        'Já existe um registro com esses dados.',
        'REGISTRO_DUPLICADO',
        fields.map((f) => ({ field: f, message: 'Valor já utilizado.' })),
      );
    }
    case 'P2025':
      return ApiError.notFound();
    case 'P2003':
      return ApiError.conflict('Operação viola um relacionamento existente.', 'REGISTRO_RELACIONADO');
    case 'P2034':
      return ApiError.conflict('Conflito de concorrência. Tente novamente.', 'CONFLITO_CONCORRENCIA');
    default:
      return null;
  }
}

export function errorHandler(err, req, res, _next) {
  let apiErr = err instanceof ApiError ? err : fromPrisma(err);

  if (!apiErr && err?.type === 'entity.parse.failed') apiErr = ApiError.badRequest('JSON malformado.', 'JSON_INVALIDO');
  if (!apiErr && err?.type === 'entity.too.large') apiErr = new ApiError(413, 'Corpo da requisição muito grande.', 'PAYLOAD_GRANDE');

  if (!apiErr) {
    req.log?.error({ err }, 'Erro não tratado');
    apiErr = new ApiError(500, 'Erro interno. Tente novamente mais tarde.', 'ERRO_INTERNO');
  } else if (apiErr.status >= 500) {
    req.log?.error({ err, code: apiErr.code }, apiErr.message);
  } else {
    req.log?.info({ code: apiErr.code, status: apiErr.status }, apiErr.message);
  }

  return sendError(res, {
    status: apiErr.status,
    message: apiErr.message,
    code: apiErr.code,
    errors: apiErr.errors,
    requestId: req.id,
  });
}

export function notFoundHandler(req, res) {
  return sendError(res, { status: 404, message: `Rota não encontrada: ${req.method} ${req.path}`, code: 'ROTA_NAO_ENCONTRADA', requestId: req.id });
}
