/**
 * Idempotency-Key (padrão Stripe) para operações sensíveis como criar pagamento.
 *
 * - Mesma chave + mesmo corpo  -> devolve a MESMA resposta (não cobra duas vezes)
 * - Mesma chave + corpo diferente -> 422
 * - Requisição original ainda em andamento -> 409
 * - Respostas 5xx não são gravadas (o cliente pode tentar de novo)
 *
 * A reserva da chave usa UNIQUE no banco, então é segura entre instâncias.
 */
import { Prisma } from '@prisma/client';
import { ApiError } from '../core/ApiError.js';
import { hashObject } from '../security/crypto.js';

export function idempotency({ prisma, scope, ttlHours = 24, required = false }) {
  return async (req, res, next) => {
    const chave = req.headers['idempotency-key'];
    if (!chave) {
      if (required) return next(ApiError.badRequest('Header Idempotency-Key é obrigatório.', 'IDEMPOTENCY_KEY_AUSENTE'));
      return next();
    }
    if (typeof chave !== 'string' || chave.length > 120 || !/^[\w.:-]+$/.test(chave)) {
      return next(ApiError.badRequest('Idempotency-Key inválida.', 'IDEMPOTENCY_KEY_INVALIDA'));
    }

    const escopo = scope(req);
    const hashRequisicao = hashObject({ m: req.method, p: req.baseUrl + req.path, b: req.body ?? null });

    try {
      const registro = await prisma.chaveIdempotencia.create({
        data: { escopo, chave, hashRequisicao, expiraEm: new Date(Date.now() + ttlHours * 3600_000) },
        select: { id: true },
      });

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const status = res.statusCode;
        const persist =
          status >= 500
            ? prisma.chaveIdempotencia.delete({ where: { id: registro.id } })
            : prisma.chaveIdempotencia.update({ where: { id: registro.id }, data: { statusCode: status, resposta: body } });
        persist.catch((err) => req.log?.error({ err: err.message }, 'Falha ao persistir idempotência'));
        return originalJson(body);
      };
      return next();
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) return next(err);
    }

    const existente = await prisma.chaveIdempotencia.findUnique({
      where: { escopo_chave: { escopo, chave } },
      select: { hashRequisicao: true, statusCode: true, resposta: true },
    });
    if (!existente) return next(ApiError.conflict('Tente novamente.', 'IDEMPOTENCIA_CONFLITO'));
    if (existente.hashRequisicao !== hashRequisicao) {
      return next(ApiError.unprocessable('Esta Idempotency-Key já foi usada com outro conteúdo.', 'IDEMPOTENCY_KEY_REUTILIZADA'));
    }
    if (existente.statusCode == null) {
      return next(ApiError.conflict('Uma requisição com esta Idempotency-Key ainda está em processamento.', 'REQUISICAO_EM_ANDAMENTO'));
    }
    res.setHeader('Idempotent-Replayed', 'true');
    return res.status(existente.statusCode).json(existente.resposta);
  };
}
