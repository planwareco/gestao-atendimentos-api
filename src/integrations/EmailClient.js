/**
 * Envio de e-mail transacional via Brevo (API HTTP).
 * Sempre chamado a partir da FILA (nunca no request principal).
 * Sem BREVO_API_KEY, apenas registra no log (útil em dev).
 */
export class EmailClient {
  constructor({ apiKey, from, fromName, logger, fetchImpl = globalThis.fetch }) {
    this.apiKey = apiKey;
    this.from = from;
    this.fromName = fromName;
    this.logger = logger;
    this.fetch = fetchImpl;
  }

  async send({ to, toName, subject, html }) {
    if (!this.apiKey) {
      this.logger?.info({ to, subject }, '[email] BREVO_API_KEY ausente — e-mail não enviado (modo log)');
      return { simulated: true };
    }
    const res = await this.fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: this.from, name: this.fromName },
        to: [{ email: to, name: toName }],
        subject,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Lança para a fila aplicar retry com backoff
      throw new Error(`Brevo respondeu ${res.status}: ${body.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }
}
