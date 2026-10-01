/**
 * Resiliência para chamadas externas:
 *  - retryWithBackoff: tentativas com backoff exponencial + jitter (só p/ falhas transitórias)
 *  - CircuitBreaker: após N falhas seguidas "abre" e falha rápido por um tempo,
 *    em vez de empilhar requisições num serviço que está fora do ar.
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function retryWithBackoff(fn, { retries = 2, baseMs = 300, maxMs = 3000, shouldRetry = () => true } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + Math.random() / 2);
      attempt += 1;
      await sleep(delay);
    }
  }
}

export class CircuitBreaker {
  constructor({ name, failureThreshold = 5, resetTimeoutMs = 30_000, onStateChange } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.onStateChange = onStateChange;
    this.state = 'CLOSED';
    this.failures = 0;
    this.openedAt = 0;
  }

  #setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }

  canRequest() {
    if (this.state === 'OPEN' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.#setState('HALF_OPEN');
    }
    return this.state !== 'OPEN';
  }

  success() {
    this.failures = 0;
    this.#setState('CLOSED');
  }

  failure() {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.openedAt = Date.now();
      this.#setState('OPEN');
    }
  }

  async exec(fn, onOpen) {
    if (!this.canRequest()) throw onOpen();
    try {
      const result = await fn();
      this.success();
      return result;
    } catch (err) {
      // Erros 4xx são do nosso lado/do usuário — não indicam serviço fora do ar
      if (!err.clientError) this.failure();
      throw err;
    }
  }
}
