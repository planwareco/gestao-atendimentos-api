/**
 * AbstractService (Sotov): base para a camada de regra de negócio.
 * - Recebe as dependências por injeção (repositórios, outros services, cache...).
 * - `validateInputs` valida com Joi e lança ApiError 422 padronizado.
 * - `notFoundIfNull` evita repetir o mesmo if em todo service.
 */
import { ApiError } from './ApiError.js';
import { joiToErrors } from '../utils/validation.js';

export class AbstractService {
  constructor(deps = {}) {
    Object.assign(this, deps);
  }

  validateInputs(data, schema) {
    const { value, error } = schema.validate(data, { abortEarly: false, stripUnknown: true, convert: true });
    if (error) {
      throw new ApiError(422, 'Dados inválidos.', 'VALIDACAO', joiToErrors(error));
    }
    return value;
  }

  notFoundIfNull(record, message = 'Registro não encontrado.', code = 'NAO_ENCONTRADO') {
    if (!record) throw ApiError.notFound(message, code);
    return record;
  }

  /** Executa `fn` numa transação Prisma. */
  transaction(fn, options) {
    return this.prisma.$transaction(fn, options);
  }
}

export default AbstractService;
