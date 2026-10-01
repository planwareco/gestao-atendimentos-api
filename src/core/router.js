/**
 * defineRoutes — declara as rotas de um módulo de forma declarativa.
 *
 * Cada rota informa: método, caminho, permissão, schemas Joi e o handler.
 * O helper monta a cadeia do Express na ordem certa
 *   [guard (auth/tenant/permissão)] -> [middlewares extras] -> [validação] -> [GatewayController]
 * e registra o contrato no OpenAPI automaticamente.
 *
 * @example
 * defineRoutes({
 *   prefix: '/v1/clientes', tag: 'Clientes', security: 'usuario',
 *   guard: (route) => guards.usuario(route),
 *   routes: [{ method: 'get', path: '/:id', summary: 'Detalhar', permission: 'clientes:ler',
 *              validate: { params: idParam }, handler: (req) => service.obter(req.ctx, req.params.id) }],
 * })
 */
import { Router } from 'express';
import { GatewayController } from './GatewayController.js';
import { validate } from '../middlewares/validate.js';
import { registerOperation } from '../docs/openapi.js';

export function defineRoutes({ prefix, tag, security = null, guard = null, routes }) {
  const router = Router({ mergeParams: true });

  for (const route of routes) {
    const routeSecurity = route.security === undefined ? security : route.security;
    const chain = [];
    if (guard && route.public !== true) chain.push(...[guard(route)].flat());
    if (route.middlewares) chain.push(...route.middlewares);
    if (route.validate) chain.push(validate(route.validate));
    chain.push(GatewayController.handle(route.handler, { status: route.status, message: route.message }));

    router[route.method](route.path, ...chain);

    registerOperation({
      method: route.method,
      path: `${prefix}${route.path === '/' ? '' : route.path}`,
      tag,
      summary: route.summary,
      description: route.description,
      security: route.public ? null : routeSecurity,
      permission: route.permission,
      validate: route.validate,
      status: route.status,
      binary: route.binary,
    });
  }

  return { prefix, router };
}
