/**
 * Cliente HTTP do payment-system-mp (https://payments.emanuelecode.tech).
 *
 * O token de API (pay_live_...) fica SÓ no servidor. O front (PaymentWidget)
 * fala com este backend, que repassa para o payment-system-mp.
 *
 * Resiliência:
 *  - timeout por requisição (AbortSignal.timeout)
 *  - retry com backoff APENAS em leituras (GET) e falhas transitórias
 *    (POST de pagamento nunca é repetido automaticamente: evita cobrança dupla)
 *  - circuit breaker: se o serviço cair, falha rápido com 503
 */
import { ApiError } from '../core/ApiError.js';
import { CircuitBreaker, retryWithBackoff } from '../utils/resilience.js';

export class PaymentGatewayError extends ApiError {
  constructor(status, message, code, { upstreamStatus, upstreamBody, clientError = false } = {}) {
    super(status, message, code);
    this.upstreamStatus = upstreamStatus;
    this.upstreamBody = upstreamBody;
    this.clientError = clientError;
  }
}

export class PaymentGatewayClient {
  constructor({ baseUrl, apiToken, publicKey, timeoutMs = 10_000, logger, fetchImpl = globalThis.fetch }) {
    this.baseUrl = baseUrl;
    this.apiToken = apiToken;
    this.publicKey = publicKey;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.breaker = new CircuitBreaker({
      name: 'payment-system-mp',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      onStateChange: (state) => logger?.warn({ state }, 'Circuit breaker payment-system-mp mudou de estado'),
    });
  }

  async #request(method, path, { body, query, raw = false } = {}) {
    const url = new URL(this.baseUrl + path);
    Object.entries(query ?? {}).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, String(v)));

    const doFetch = async () => {
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            Accept: raw ? '*/*' : 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        const timeout = err.name === 'TimeoutError' || err.name === 'AbortError';
        throw new PaymentGatewayError(
          timeout ? 504 : 502,
          timeout ? 'O serviço de pagamentos demorou para responder.' : 'Falha ao contatar o serviço de pagamentos.',
          timeout ? 'PAGAMENTOS_TIMEOUT' : 'PAGAMENTOS_INDISPONIVEL',
        );
      }

      if (raw && res.ok) {
        return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
      }

      const json = await res.json().catch(() => null);
      if (!res.ok || json?.success === false) {
        const clientError = res.status >= 400 && res.status < 500;
        throw new PaymentGatewayError(
          clientError ? (res.status === 404 ? 404 : 422) : 502,
          json?.message ?? 'O serviço de pagamentos recusou a operação.',
          json?.code ?? 'PAGAMENTOS_ERRO',
          { upstreamStatus: res.status, upstreamBody: json, clientError },
        );
      }
      return json?.data;
    };

    const isRead = method === 'GET';
    const started = Date.now();
    try {
      return await this.breaker.exec(
        () => (isRead ? retryWithBackoff(doFetch, { retries: 2, shouldRetry: (e) => !e.clientError }) : doFetch()),
        () => new PaymentGatewayError(503, 'Serviço de pagamentos temporariamente indisponível. Tente em instantes.', 'PAGAMENTOS_CIRCUITO_ABERTO'),
      );
    } finally {
      this.logger?.debug({ method, path, durationMs: Date.now() - started }, 'payment-system-mp');
    }
  }

  createPayment(payload) {
    return this.#request('POST', '/payments', { body: payload });
  }

  getPayment(id, { sync = false } = {}) {
    return this.#request('GET', `/payments/${encodeURIComponent(id)}`, { query: sync ? { syncWithMp: 'true' } : undefined });
  }

  cancelPayment(id) {
    return this.#request('POST', `/payments/${encodeURIComponent(id)}/cancel`);
  }

  getReceipt(id) {
    return this.#request('GET', `/payments/${encodeURIComponent(id)}/receipt`, { raw: true });
  }

  async health() {
    const res = await this.fetch(new URL('/health', this.baseUrl), { signal: AbortSignal.timeout(3000) });
    return res.ok;
  }
}
