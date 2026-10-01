/**
 * Erro de negócio padronizado (herança do Sotov).
 * Lance dentro dos Services; o middleware global de erros formata a resposta.
 *
 *   throw new ApiError(404, 'Cliente não encontrado.', 'CLIENTE_NAO_ENCONTRADO');
 */
export class ApiError extends Error {
  /**
   * @param {number} status   Status HTTP
   * @param {string} message  Mensagem legível (pt-BR)
   * @param {string} [code]   Código estável para o front tratar
   * @param {Array<{field:string,message:string}>} [errors] Detalhes por campo
   */
  constructor(status, message, code = 'ERRO', errors = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }

  static badRequest(message, code = 'REQUISICAO_INVALIDA', errors) {
    return new ApiError(400, message, code, errors);
  }
  static unauthorized(message = 'Não autenticado.', code = 'NAO_AUTENTICADO') {
    return new ApiError(401, message, code);
  }
  static forbidden(message = 'Acesso negado.', code = 'ACESSO_NEGADO') {
    return new ApiError(403, message, code);
  }
  static notFound(message = 'Registro não encontrado.', code = 'NAO_ENCONTRADO') {
    return new ApiError(404, message, code);
  }
  static conflict(message, code = 'CONFLITO') {
    return new ApiError(409, message, code);
  }
  static unprocessable(message, code = 'REGRA_DE_NEGOCIO', errors) {
    return new ApiError(422, message, code, errors);
  }
}

export default ApiError;
