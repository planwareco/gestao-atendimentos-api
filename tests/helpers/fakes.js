import crypto from 'node:crypto';

/**
 * Dublês das integrações externas — injetados via container (DI),
 * sem precisar de mocks globais nem de rede.
 */
export class FakePaymentGateway {
  constructor() {
    this.publicKey = 'TEST-public-key';
    this.payments = new Map();
    this.calls = [];
    this.seq = 0;
  }

  async createPayment(payload) {
    this.calls.push({ op: 'create', payload });
    this.seq += 1;
    const id = `fake-${crypto.randomUUID()}`;
    const p = {
      id,
      method: payload.method,
      status: payload.method === 'CREDIT_CARD' ? 'APPROVED' : 'PENDING',
      amount: payload.amount.toFixed(2),
      externalReference: payload.externalReference,
      mpPaymentId: String(9000 + this.seq),
      ...(payload.method === 'PIX' && { pix: { qrCode: '000201fake', qrCodeBase64: 'iVBORfake' } }),
    };
    this.payments.set(id, p);
    return { ...p };
  }

  async getPayment(id) {
    this.calls.push({ op: 'get', id });
    const p = this.payments.get(id);
    if (!p) throw Object.assign(new Error('not found'), { status: 404 });
    return { ...p };
  }

  async cancelPayment(id) {
    const p = this.payments.get(id);
    p.status = 'CANCELLED';
    return { ...p };
  }

  async getReceipt() {
    return { buffer: Buffer.from('%PDF-fake'), contentType: 'application/pdf' };
  }

  aprovar(id) {
    this.payments.get(id).status = 'APPROVED';
  }
}

export class FakeEmailClient {
  constructor() {
    this.enviados = [];
  }
  async send(msg) {
    this.enviados.push(msg);
    return { simulated: true };
  }
}

export class FakePdfRenderer {
  constructor() {
    this.renderizados = 0;
  }
  async orcamento(dados) {
    this.renderizados += 1;
    return Buffer.from(`%PDF-1.4 fake orcamento ${dados.orcamento.numero}`);
  }
  async close() {}
}
