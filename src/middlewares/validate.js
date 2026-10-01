/**
 * Validação + sanitização de entrada (params, query, body) com Joi.
 * O valor validado SUBSTITUI o original: campos desconhecidos são descartados,
 * strings aparadas e tipos convertidos. O service recebe sempre um DTO limpo.
 */
import { ApiError } from '../core/ApiError.js';
import { joiToErrors, VALIDATION_OPTIONS } from '../utils/validation.js';

export function validate(schemas = {}) {
  const parts = ['params', 'query', 'body'].filter((p) => schemas[p]);
  return (req, _res, next) => {
    const errors = [];
    for (const part of parts) {
      const { value, error } = schemas[part].validate(req[part] ?? {}, VALIDATION_OPTIONS);
      if (error) errors.push(...joiToErrors(error).map((e) => ({ ...e, field: `${part}.${e.field}` })));
      else req[part] = value;
    }
    if (errors.length) return next(new ApiError(422, 'Dados inválidos.', 'VALIDACAO', errors));
    return next();
  };
}
