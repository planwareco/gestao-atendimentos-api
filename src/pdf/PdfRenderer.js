/**
 * Renderização HTML -> PDF com Puppeteer (roda SOMENTE no worker).
 * Um único navegador é reaproveitado entre os jobs; cada PDF usa uma aba nova.
 * Requisições de rede da página são bloqueadas, exceto imagens HTTPS (logo).
 */
import { orcamentoHtml } from './templates/orcamento.js';

export class PdfRenderer {
  constructor({ executablePath, logger }) {
    this.executablePath = executablePath;
    this.logger = logger;
    this.browserPromise = null;
  }

  async #browser() {
    if (!this.browserPromise) {
      const { default: puppeteer } = await import('puppeteer');
      this.browserPromise = puppeteer
        .launch({
          headless: true,
          executablePath: this.executablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
        })
        .catch((err) => {
          this.browserPromise = null;
          throw err;
        });
    }
    const browser = await this.browserPromise;
    if (!browser.connected) {
      this.browserPromise = null;
      return this.#browser();
    }
    return browser;
  }

  async render(html) {
    const browser = await this.#browser();
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || (req.resourceType() === 'image' && url.startsWith('https://'))) req.continue();
        else req.abort();
      });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => {});
    }
  }

  orcamento(dados) {
    return this.render(orcamentoHtml(dados));
  }

  async close() {
    if (this.browserPromise) {
      const browser = await this.browserPromise.catch(() => null);
      await browser?.close().catch(() => {});
      this.browserPromise = null;
    }
  }
}
