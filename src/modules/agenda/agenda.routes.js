import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { dateOnly, id } from '../../utils/validation.js';

const hhmm = () => Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/);

export function agendaRoutes({ services, guards }) {
  const { agenda } = services;
  return defineRoutes({
    prefix: '/v1/agenda',
    tag: 'Agenda',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'agenda:ler',
        summary: 'Atendimentos no período (visões dia/semana/mês) — máx. 62 dias',
        validate: {
          query: Joi.object({
            inicio: Joi.date().iso().required(),
            fim: Joi.date().iso().greater(Joi.ref('inicio')).required(),
            profissionalId: id(),
            incluirCancelados: Joi.boolean().default(false),
          }),
        },
        handler: (req) => agenda.listar(req.ctx, req.query),
      },
      {
        method: 'get',
        path: '/horarios-livres',
        permission: 'agenda:ler',
        summary: 'Sugere horários livres em um dia (expediente do profissional − atendimentos marcados)',
        validate: {
          query: Joi.object({
            data: dateOnly().required(),
            profissionalId: id(),
            servicoIds: Joi.alternatives(id(), Joi.array().items(id()).max(30)).custom((v) => [v].flat()),
            duracaoMinutos: Joi.number().integer().min(5).max(1440),
            passoMinutos: Joi.number().integer().valid(5, 10, 15, 20, 30, 60).default(15),
            expedienteInicio: hhmm().default('08:00').description('Usado quando não há profissional com horário configurado'),
            expedienteFim: hhmm().default('18:00'),
          }),
        },
        handler: (req) => agenda.horariosLivres(req.ctx, req.query),
      },
    ],
  });
}
