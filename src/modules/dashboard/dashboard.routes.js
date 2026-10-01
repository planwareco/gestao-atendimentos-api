import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { dateOnly, id } from '../../utils/validation.js';

const periodoQuery = Joi.object({ inicio: dateOnly().required(), fim: dateOnly().required(), profissionalId: id() });

export function dashboardRoutes({ services, guards }) {
  const { dashboard } = services;
  const guard = (route) => guards.usuario(route);
  return [
    defineRoutes({
      prefix: '/v1/dashboard',
      tag: 'Dashboard',
      security: 'usuario',
      guard,
      routes: [
        {
          method: 'get',
          path: '/',
          permission: 'dashboard:ver',
          summary: 'Indicadores do mês + gráficos do ano (só atendimentos REALIZADOS contam como receita)',
          validate: {
            query: Joi.object({
              ano: Joi.number().integer().min(2000).max(2100),
              mes: Joi.number().integer().min(1).max(12).description('Opcional: restringe os gráficos ao mês'),
            }),
          },
          handler: (req) => dashboard.dashboard(req.ctx, req.query),
        },
      ],
    }),
    defineRoutes({
      prefix: '/v1/financeiro',
      tag: 'Financeiro',
      security: 'usuario',
      guard,
      routes: [
        {
          method: 'get',
          path: '/resultado',
          permission: 'financeiro:ver',
          summary: 'Faturamento bruto − despesas − comissões = resultado do período',
          validate: { query: periodoQuery },
          handler: (req) => dashboard.resultado(req.ctx, req.query),
        },
        {
          method: 'get',
          path: '/comissoes',
          permission: 'comissoes:ver',
          summary: 'Comissões por profissional no período',
          validate: { query: periodoQuery },
          handler: (req) => dashboard.comissoes(req.ctx, req.query),
        },
      ],
    }),
  ];
}
