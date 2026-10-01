# Ajustes no frontend — versão 1.1

O que mudou na API e como aplicar cada pedido no front. (O "Controle de cartão" foi desfeito.)
Complementa o `GUIA-FRONTEND.md`.

| #   | Pedido                                                 | API                                  | Front                              |
| --- | ------------------------------------------------------ | ------------------------------------ | ---------------------------------- |
| 1   | Trocar o nome "Atendo"                                 | `aparencia.nomeSistema` (novo)       | Topo do menu lê o nome configurado |
| 2   | "Informação adicional" no cliente                      | `cliente.informacaoAdicional` (novo) | Campo e coluna logo após o nome    |
| 3   | Nova ordem do menu                                     | —                                    | Reordenar a lista do menu          |
| 4   | Bloco "Clínica de Beleza / Proprietário" mais discreto | —                                    | Vira uma linha pequena             |

> **Antes:** rode `npm run db:deploy` na API (migrations `20261001150000_cartoes_info_cliente` e `20261001170000_remover_controle_cartao` — a segunda desfaz a parte de cartões e mantém a "Informação adicional").

---

## 1. Nome e logo no topo do menu

A API agora guarda o nome exibido no topo em `empresa.aparencia.nomeSistema` (máx. 40 caracteres).
A logo já existia em `aparencia.logoUrl`. As duas coisas vêm no `GET /v1/auth/me`.

**Regra de exibição (do mais específico para o padrão):**

```ts
// src/lib/marca.ts
const MARCA_PADRAO = import.meta.env.VITE_APP_NAME ?? 'Atendo';

export function nomeDoTopo(empresa: EmpresaSessao) {
  return empresa.aparencia.nomeSistema?.trim() || empresa.nomeFantasia || empresa.nome || MARCA_PADRAO;
}
```

```tsx
// Sidebar — topo
<div className={s.marca}>
  {empresa.aparencia.logoUrl ? (
    <img src={empresa.aparencia.logoUrl} alt="" className={s.logo} />
  ) : (
    <span className={s.logoLetra}>{nomeDoTopo(empresa)[0]}</span>
  )}
  <span className={s.nomeMarca}>{nomeDoTopo(empresa)}</span>
</div>
```

**Configurações → Aparência:** adicione o campo "Nome exibido no menu" com contador (40) e pré-visualização ao vivo.

```http
PUT /v1/configuracoes
{ "aparencia": { "nomeSistema": "Studio Ana", "logoUrl": "https://..." } }
```

Envie `null` para voltar ao nome da empresa. O "Atendo" da tela de login (antes de existir sessão) vem de `VITE_APP_NAME` no `.env` do front.

---

## 2. Cliente: "Informação adicional"

Campo novo `informacaoAdicional` (texto livre, até 500 caracteres; `null` limpa). Ele também entra na busca da lista.

**Formulário** — logo abaixo do nome:

```tsx
<Input label="Nome" {...register('nome', { required: true })} />
<Textarea
  label="Informação adicional"
  placeholder="Ex.: prefere horário da manhã, alérgica a amônia..."
  maxLength={500}
  rows={2}
  {...register('informacaoAdicional')}
/>
<Input label="Telefone" ... />
```

**Lista** — coluna logo depois de **Nome**, cortada com reticências e o texto completo no `title`:

| NOME | INFORMAÇÃO ADICIONAL | CONTATO | NASCIMENTO | SITUAÇÃO |
| ---- | -------------------- | ------- | ---------- | -------- |

```tsx
<td className={s.infoAdicional} title={c.informacaoAdicional ?? ''}>
  {c.informacaoAdicional || <span className={s.vazio}>—</span>}
</td>
```

```css
.infoAdicional {
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--muted-color);
}
```

No celular, mostre a informação adicional como uma segunda linha embaixo do nome, em vez de coluna.

Atualize o tipo: `informacaoAdicional: string | null` em `Cliente`.

---

## 3. Ordem do menu lateral

Deixe a ordem num array só e filtre pelas permissões (o filtro não muda a ordem):

```ts
// src/layouts/menu.ts
export const MENU = [
  {
    grupo: 'Operação',
    itens: [
      { to: '/app', label: 'Visão geral', icon: 'bx-grid-alt', perm: 'dashboard:ver' },
      { to: '/app/servicos', label: 'Serviços', icon: 'bx-purchase-tag', perm: 'servicos:ler' },
      { to: '/app/clientes', label: 'Clientes', icon: 'bx-user', perm: 'clientes:ler', rotulo: 'cliente' },
      { to: '/app/atendimentos', label: 'Atendimentos', icon: 'bx-list-check', perm: 'atendimentos:ler' },
      { to: '/app/agenda', label: 'Agenda', icon: 'bx-calendar', perm: 'agenda:ler' },
      { to: '/app/historico', label: 'Histórico', icon: 'bx-history', perm: 'clientes:ler' },
      { to: '/app/orcamentos', label: 'Orçamentos', icon: 'bx-file', perm: 'orcamentos:ler' },
    ],
  },
  {
    grupo: 'Gestão',
    itens: [
      { to: '/app/despesas', label: 'Despesas', icon: 'bx-wallet', perm: 'despesas:ler' },
      { to: '/app/financeiro', label: 'Financeiro', icon: 'bx-line-chart', perm: 'financeiro:ver' },
      { to: '/app/profissionais', label: 'Profissionais', icon: 'bx-id-card', perm: 'profissionais:ler' },
      { to: '/app/equipe', label: 'Equipe', icon: 'bx-group', perm: 'usuarios:gerenciar' },
      { to: '/app/configuracoes', label: 'Configurações', icon: 'bx-cog', perm: 'configuracoes:gerenciar' },
    ],
  },
];
```

> Os rótulos do segmento continuam valendo: "Clientes" vira "Tutores" no pet shop e "Pacientes" na fisioterapia (`camposPersonalizados.rotulos.cliente`).

---

## 4. Bloco da empresa/papel mais discreto

Com a logo e o nome no topo, o cartão "Clínica de Beleza · Proprietário" fica redundante. Troque o cartão por **uma linha pequena** logo abaixo da marca, sem fundo nem borda:

```tsx
<div className={s.marca}>…</div>
<p className={s.contexto}>
  {empresa.nome} · {PAPEL_LABEL[usuario.papel]}
</p>
```

```css
.contexto {
  margin: 2px 0 16px 44px; /* alinhado com o texto da marca, à direita da logo */
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- Se `nomeSistema` for igual ao nome da empresa, mostre só o papel ("Proprietário").
- Com o menu recolhido, esconda essa linha.
- O papel também pode ficar só no rodapé do usuário ("Usuário Demo · Proprietário") e o topo fica limpo.

---

## Tipos atualizados

```ts
export interface Aparencia {
  nomeSistema: string | null;
  corPrimaria: string;
  corSecundaria: string;
  tema: 'claro' | 'escuro';
  logoUrl: string | null;
  faviconUrl: string | null;
}
export interface Cliente {
  /* ... */ nome: string;
  informacaoAdicional: string | null; /* ... */
}
```

## Checklist

- [ ] `npm run db:deploy` na API
- [ ] Topo do menu com logo + `nomeSistema` (com fallback) e campo em Configurações → Aparência
- [ ] Linha discreta "Empresa · Papel" no lugar do cartão
- [ ] Menu na ordem nova + grupo "Gestão"
- [ ] Cliente: campo e coluna "Informação adicional" após o nome
