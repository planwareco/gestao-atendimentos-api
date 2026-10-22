/**
 * Entrada para a Vercel (Express zero-config).
 * A Vercel procura, nesta ordem: app.js, index.js, server.js, src/app.js, src/index.js, src/server.js
 * e exige que o arquivo encontrado tenha `export default app` (ou chame app.listen).
 * Este arquivo na raiz vence o src/app.js (que só exporta a fábrica createApp).
 * Localmente / no Render continua valendo `node src/server.js`.
 */
import { createContainer } from './src/container.js';
import { createApp } from './src/app.js';

const container = createContainer();
const app = createApp(container);

export default app;
