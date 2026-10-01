/**
 * OpenAPI 3 gerado a partir das PRÓPRIAS definições de rota.
 * Cada rota declarada com `defineRoutes` registra aqui seu contrato
 * (schemas Joi de params/query/body). Documentação e validação nunca divergem.
 */
import j2s from 'joi-to-swagger';

const operations = [];

export function registerOperation(op) {
  operations.push(op);
}

export function clearOperations() {
  operations.length = 0;
}

const toOpenApiPath = (p) => p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

function paramsFrom(schema, location) {
  if (!schema) return [];
  const { swagger } = j2s(schema);
  return Object.entries(swagger.properties ?? {}).map(([name, s]) => ({
    name,
    in: location,
    required: location === 'path' || (swagger.required ?? []).includes(name),
    schema: s,
    description: s.description,
  }));
}

const envelope = (dataSchema = {}) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', nullable: true },
    data: dataSchema,
    meta: { type: 'object', nullable: true },
    timestamp: { type: 'string', format: 'date-time' },
  },
});

const errorResponse = (description) => ({ description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } });

export function buildOpenApi({ title, version, serverUrl }) {
  const paths = {};
  for (const op of operations) {
    const path = toOpenApiPath(op.path);
    paths[path] ??= {};
    const operation = {
      tags: [op.tag],
      summary: op.summary,
      description: op.description,
      security: op.security ? [{ [op.security]: [] }] : [],
      parameters: [...paramsFrom(op.validate?.params, 'path'), ...paramsFrom(op.validate?.query, 'query')],
      responses: {
        [op.status ?? 200]: op.binary
          ? { description: 'Arquivo', content: { [op.binary]: { schema: { type: 'string', format: 'binary' } } } }
          : { description: 'Sucesso', content: { 'application/json': { schema: envelope() } } },
        ...(op.validate ? { 422: errorResponse('Dados inválidos') } : {}),
        ...(op.security ? { 401: errorResponse('Não autenticado'), 403: errorResponse('Sem permissão / empresa bloqueada') } : {}),
      },
    };
    if (op.permission) operation.description = `${op.description ?? ''}\n\n**Permissão:** \`${op.permission}\``.trim();
    if (op.validate?.body) {
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: j2s(op.validate.body).swagger } },
      };
    }
    paths[path][op.method] = operation;
  }

  return {
    openapi: '3.0.3',
    info: {
      title,
      version,
      description:
        'API multi-tenant de gestão de atendimentos. Valores monetários em **centavos** (inteiros). ' +
        'Datas/horas em ISO-8601 (UTC). Respostas sempre no envelope `{ success, message, data, meta, timestamp }`.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        usuario: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token do usuário do tenant (POST /v1/auth/login)' },
        admin: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Access token do super admin (POST /v1/admin/auth/login)' },
      },
      schemas: {
        Erro: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            code: { type: 'string', example: 'VALIDACAO' },
            errors: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
            requestId: { type: 'string' },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths,
  };
}
