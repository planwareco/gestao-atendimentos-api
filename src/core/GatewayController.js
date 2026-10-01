/**
 * GatewayController (herança do Sotov): adapta um caso de uso para o Express
 * e padroniza a resposta. Não contém regra de negócio — só transporte HTTP.
 *
 * Uso:
 *   handler: GatewayController.handle((req) => service.criar(req.ctx, req.body), { status: 201 })
 *
 * O handler pode retornar:
 *   - qualquer valor         -> vira `data`
 *   - paginated(items, meta) -> vira `data` + `meta`
 *   - { __raw: true }        -> o handler já respondeu (ex.: arquivo binário)
 */
import { sendSuccess } from './http.js';

export class GatewayController {
  constructor(fn, { status = 200, message = null } = {}) {
    this.fn = fn;
    this.status = status;
    this.message = message;
  }

  async handle(req, res, next) {
    try {
      const result = await this.fn(req, res);
      if (res.headersSent || result?.__raw) return undefined;
      if (result?.__paginated) {
        return sendSuccess(res, { status: this.status, data: result.data, meta: result.meta, message: this.message });
      }
      return sendSuccess(res, { status: this.status, data: result ?? null, message: this.message });
    } catch (err) {
      return next(err);
    }
  }

  static handle(fn, options) {
    const controller = new GatewayController(fn, options);
    return (req, res, next) => controller.handle(req, res, next);
  }
}

export default GatewayController;
