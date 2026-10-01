/**
 * Helpers de validação (Joi) compartilhados pelos schemas dos módulos.
 * Strings são aparadas (trim) e campos desconhecidos são descartados (stripUnknown):
 * nunca confiamos no que o cliente envia.
 */
import Joi from 'joi';

export const id = () => Joi.string().guid({ version: ['uuidv4', 'uuidv7'] });
export const idParam = Joi.object({ id: id().required() });

export const text = (max = 150) => Joi.string().trim().max(max);
/** Texto opcional: ausente = não altera; `null` = limpa o campo. */
export const optionalText = (max = 150) => Joi.string().trim().max(max).allow(null).empty('');

export const centavos = () => Joi.number().integer().min(0).max(100_000_000);
export const phone = () =>
  Joi.string()
    .trim()
    .replace(/\D/g, '')
    .pattern(/^\d{10,13}$/)
    .messages({ 'string.pattern.base': 'Telefone deve ter de 10 a 13 dígitos.' });

export const documento = () =>
  Joi.string()
    .trim()
    .replace(/\D/g, '')
    .pattern(/^(\d{11}|\d{14})$/)
    .messages({ 'string.pattern.base': 'Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos).' });

export const cep = () => Joi.string().trim().replace(/\D/g, '').length(8);
export const uf = () => Joi.string().trim().uppercase().length(2);
export const hexColor = () =>
  Joi.string()
    .trim()
    .pattern(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
export const dateOnly = () =>
  Joi.string()
    .trim()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .messages({ 'string.pattern.base': 'Use o formato AAAA-MM-DD.' });
export const isoDateTime = () => Joi.date().iso();

export const pagination = {
  page: Joi.number().integer().min(1).default(1),
  perPage: Joi.number().integer().min(1).max(100).default(20),
};

export const senha = () =>
  Joi.string()
    .min(8)
    .max(72)
    .pattern(/[A-Za-z]/)
    .pattern(/\d/)
    .messages({ 'string.pattern.base': 'A senha deve conter letras e números.' });

export function joiToErrors(error) {
  return error.details.map((d) => ({ field: d.path.join('.'), message: d.message.replace(/"/g, '') }));
}

export const VALIDATION_OPTIONS = { abortEarly: false, stripUnknown: true, convert: true };
