/**
 * Templates de e-mail transacional (HTML simples, compatível com clientes de e-mail).
 */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const layout = (appName, titulo, corpo) => `<!doctype html><html><body style="margin:0;background:#f4f5f9;font-family:Arial,sans-serif;color:#1f2430">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;padding:32px">
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${esc(titulo)}</h1>${corpo}
<p style="color:#9ca3af;font-size:12px;margin-top:32px">${esc(appName)}</p></td></tr></table></td></tr></table></body></html>`;

const botao = (href, texto) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#6D5EF8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${esc(texto)}</a></p>`;

export const EMAIL_TEMPLATES = {
  'cadastro-recebido': (v, appName) => ({
    subject: `Conclua seu cadastro — ${appName}`,
    html: layout(
      appName,
      `Olá, ${v.nome}!`,
      `<p>Recebemos o cadastro de <strong>${esc(v.empresa)}</strong>.</p>
       <p>Para liberar o acesso, conclua o pagamento da adesão de <strong>${esc(v.valor)}</strong>.</p>
       ${botao(v.checkoutUrl, 'Concluir pagamento')}
       <p style="font-size:13px;color:#6b7280">O link vale por 72 horas. Depois disso, faça login para gerar um novo.</p>`,
    ),
  }),
  'boas-vindas': (v, appName) => ({
    subject: `Pagamento confirmado — bem-vindo(a) ao ${appName}!`,
    html: layout(
      appName,
      `Tudo pronto, ${v.nome}!`,
      `<p>O pagamento de <strong>${esc(v.empresa)}</strong> foi confirmado e o sistema já está liberado.</p>
       ${botao(v.loginUrl, 'Acessar o sistema')}`,
    ),
  }),
};
