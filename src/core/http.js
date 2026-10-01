/**
 * Envelope único de resposta — o mesmo formato do payment-system-mp,
 * para o front tratar todas as APIs do ecossistema da mesma forma.
 *
 * Sucesso: { success: true,  message, data, meta, timestamp }
 * Erro:    { success: false, message, code, errors, requestId, timestamp }
 */
export function sendSuccess(res, { status = 200, data = null, message = null, meta = null } = {}) {
  if (status === 204) return res.status(204).end();
  return res.status(status).json({
    success: true,
    message,
    data,
    meta,
    timestamp: new Date().toISOString(),
  });
}

export function sendError(res, { status = 500, message, code = 'ERRO', errors, requestId }) {
  return res.status(status).json({
    success: false,
    message,
    code,
    errors: errors ?? undefined,
    requestId,
    timestamp: new Date().toISOString(),
  });
}

/** Resultado paginado padronizado retornado pelos services. */
export function paginated(items, { total, page, perPage }) {
  return {
    __paginated: true,
    data: items,
    meta: { total, page, perPage, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  };
}
