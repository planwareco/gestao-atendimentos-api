import Joi from 'joi';
import { defineRoutes } from '../../core/router.js';
import { id, idParam, pagination, senha, text } from '../../utils/validation.js';

const PAPEIS = ['PROPRIETARIO', 'RECEPCIONISTA', 'PROFISSIONAL'];

export function usuariosRoutes({ services, guards }) {
  const { usuarios } = services;
  return defineRoutes({
    prefix: '/v1/usuarios',
    tag: 'Usuários (equipe)',
    security: 'usuario',
    guard: (route) => guards.usuario(route),
    routes: [
      {
        method: 'get',
        path: '/',
        permission: 'usuarios:gerenciar',
        summary: 'Lista a equipe',
        validate: { query: Joi.object({ papel: Joi.string().valid(...PAPEIS), ativo: Joi.boolean(), ...pagination }) },
        handler: (req) => usuarios.listar(req.ctx, req.query),
      },
      {
        method: 'post',
        path: '/',
        status: 201,
        permission: 'usuarios:gerenciar',
        summary: 'Cria usuário (opcionalmente vinculado a um profissional)',
        validate: {
          body: Joi.object({
            nome: text(120).min(2).required(),
            email: Joi.string().trim().lowercase().email().max(160).required(),
            senha: senha().required(),
            papel: Joi.string()
              .valid(...PAPEIS)
              .required(),
            profissionalId: id(),
          }),
        },
        handler: (req) => usuarios.criar(req.ctx, req.body),
      },
      {
        method: 'get',
        path: '/:id',
        permission: 'usuarios:gerenciar',
        summary: 'Detalha usuário',
        validate: { params: idParam },
        handler: (req) => usuarios.obter(req.ctx, req.params.id),
      },
      {
        method: 'patch',
        path: '/:id',
        permission: 'usuarios:gerenciar',
        summary: 'Altera nome, papel, ativo ou redefine senha',
        validate: {
          params: idParam,
          body: Joi.object({ nome: text(120).min(2), papel: Joi.string().valid(...PAPEIS), ativo: Joi.boolean(), novaSenha: senha() }).min(1),
        },
        handler: (req) => usuarios.atualizar(req.ctx, req.params.id, req.body),
      },
    ],
  });
}
