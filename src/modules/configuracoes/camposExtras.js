/**
 * Campos personalizados por segmento (guardados em JSONB).
 * A empresa define os campos; aqui geramos um schema Joi a partir dessa definição
 * para validar `camposExtras` de clientes e atendimentos.
 */
import Joi from 'joi';
import { ApiError } from '../../core/ApiError.js';
import { joiToErrors } from '../../utils/validation.js';

export const TIPOS_CAMPO = ['texto', 'numero', 'data', 'selecao', 'booleano'];

export const definicaoCampoSchema = Joi.object({
  chave: Joi.string()
    .trim()
    .pattern(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/)
    .required(),
  rotulo: Joi.string().trim().max(60).required(),
  tipo: Joi.string()
    .valid(...TIPOS_CAMPO)
    .required(),
  obrigatorio: Joi.boolean().default(false),
  opcoes: Joi.when('tipo', {
    is: 'selecao',
    then: Joi.array().items(Joi.string().trim().max(60)).min(1).max(50).unique().required(),
    otherwise: Joi.forbidden(),
  }),
});

export const camposPersonalizadosSchema = Joi.object({
  rotulos: Joi.object({
    cliente: Joi.string().trim().max(30),
    servico: Joi.string().trim().max(30),
    atendimento: Joi.string().trim().max(30),
  }),
  cliente: Joi.array().items(definicaoCampoSchema).max(30).unique('chave'),
  atendimento: Joi.array().items(definicaoCampoSchema).max(30).unique('chave'),
});

function schemaDoCampo(c) {
  let s;
  switch (c.tipo) {
    case 'numero':
      s = Joi.number();
      break;
    case 'data':
      s = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);
      break;
    case 'selecao':
      s = Joi.string().valid(...(c.opcoes ?? []));
      break;
    case 'booleano':
      s = Joi.boolean();
      break;
    default:
      s = Joi.string().trim().max(1000);
  }
  return c.obrigatorio ? s.required() : s.allow(null, '');
}

/**
 * Valida os campos extras de uma entidade conforme a definição da empresa.
 * Chaves não definidas são descartadas.
 * @param {'cliente'|'atendimento'} entidade
 */
export function validarCamposExtras(definicoes, entidade, valores = {}) {
  const defs = definicoes?.[entidade] ?? [];
  const schema = Joi.object(Object.fromEntries(defs.map((c) => [c.chave, schemaDoCampo(c).label(c.rotulo)])));
  const { value, error } = schema.validate(valores ?? {}, { abortEarly: false, stripUnknown: true, convert: true });
  if (error) {
    throw new ApiError(
      422,
      'Campos personalizados inválidos.',
      'CAMPOS_EXTRAS_INVALIDOS',
      joiToErrors(error).map((e) => ({ ...e, field: `camposExtras.${e.field}` })),
    );
  }
  return value;
}
