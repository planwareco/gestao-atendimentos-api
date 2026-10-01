/**
 * Template HTML do orçamento — usa logo e cores da empresa (identidade visual).
 * Todo texto vindo do banco passa por `esc` (evita injeção de HTML no PDF).
 */
import { formatBRL } from '../../utils/money.js';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const docFmt = (d) =>
  !d ? '' : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
const fone = (t) => (!t ? '' : t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'));
const cor = (c, fallback) => (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c ?? '') ? c : fallback);

export function orcamentoHtml({ orcamento: o, empresa: e }) {
  const primaria = cor(e.aparencia?.corPrimaria, '#6D5EF8');
  const logo = e.aparencia?.logoUrl?.startsWith('https://') ? `<img class="logo" src="${esc(e.aparencia.logoUrl)}" alt="">` : '';
  const end = e.endereco
    ? [e.endereco.logradouro, e.endereco.numero, e.endereco.bairro, e.endereco.cidade && `${e.endereco.cidade}/${e.endereco.estado ?? ''}`]
        .filter(Boolean)
        .join(', ')
    : '';
  const numero = String(o.numero).padStart(5, '0');

  const linhas = o.itens
    .map(
      (i) => `<tr>
        <td>${esc(i.descricao)}</td>
        <td class="c">${i.quantidade}</td>
        <td class="r">${formatBRL(i.valorUnitarioCentavos)}</td>
        <td class="r">${formatBRL(i.totalCentavos)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Orçamento #${numero}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1f2430; font-size: 11pt; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid ${primaria}; padding-bottom: 12px; }
  .logo { max-height: 56px; max-width: 180px; margin-bottom: 6px; display: block; }
  .empresa h1 { font-size: 15pt; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 9pt; line-height: 1.45; }
  .titulo { text-align: right; }
  .titulo h2 { margin: 0; font-size: 20pt; color: ${primaria}; letter-spacing: .5px; }
  .titulo .num { font-size: 12pt; font-weight: 600; }
  section.cliente { margin: 18px 0; padding: 12px 14px; background: #f6f7fb; border-radius: 6px; }
  section.cliente strong { display: block; font-size: 12pt; margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: .4px; color: #6b7280; border-bottom: 1px solid #d9dce5; padding: 8px 6px; }
  td { padding: 9px 6px; border-bottom: 1px solid #eef0f5; vertical-align: top; }
  .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .totais { margin-left: auto; width: 46%; margin-top: 14px; }
  .totais div { display: flex; justify-content: space-between; padding: 4px 6px; }
  .totais .total { border-top: 2px solid ${primaria}; margin-top: 4px; padding-top: 8px; font-size: 14pt; font-weight: 700; }
  .obs { margin-top: 22px; white-space: pre-wrap; }
  footer { margin-top: 28px; font-size: 8.5pt; color: #9ca3af; text-align: center; }
</style></head>
<body>
  <header>
    <div class="empresa">
      ${logo}
      <h1>${esc(e.nomeFantasia || e.nome)}</h1>
      <div class="muted">
        ${e.documento ? `${e.documento.length === 14 ? 'CNPJ' : 'CPF'} ${docFmt(e.documento)}<br>` : ''}
        ${[fone(e.whatsapp || e.telefone), esc(e.email)].filter(Boolean).join(' · ')}<br>
        ${esc(end)}
      </div>
    </div>
    <div class="titulo">
      <h2>ORÇAMENTO</h2>
      <div class="num">#${numero}</div>
      <div class="muted">Emissão: ${dataBR(o.data)}<br>Validade: ${dataBR(o.validade)}</div>
    </div>
  </header>

  <section class="cliente">
    <span class="muted">Cliente</span>
    <strong>${esc(o.cliente.nome)}</strong>
    <span class="muted">${[o.cliente.documento ? docFmt(o.cliente.documento) : '', fone(o.cliente.whatsapp || o.cliente.telefone), esc(o.cliente.email)].filter(Boolean).join(' · ')}</span>
  </section>

  <table>
    <thead><tr><th>Serviço</th><th class="c">Qtd.</th><th class="r">Valor unit.</th><th class="r">Total</th></tr></thead>
    <tbody>${linhas}</tbody>
  </table>

  <div class="totais">
    <div><span>Subtotal</span><span>${formatBRL(o.subtotalCentavos)}</span></div>
    ${o.descontoCentavos ? `<div><span>Desconto</span><span>− ${formatBRL(o.descontoCentavos)}</span></div>` : ''}
    ${o.acrescimoCentavos ? `<div><span>Acréscimo</span><span>+ ${formatBRL(o.acrescimoCentavos)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${formatBRL(o.totalCentavos)}</span></div>
  </div>

  ${o.observacoes ? `<div class="obs"><span class="muted">Observações</span><br>${esc(o.observacoes)}</div>` : ''}

  <footer>Orçamento gerado em ${new Date().toLocaleDateString('pt-BR')}</footer>
</body></html>`;
}
