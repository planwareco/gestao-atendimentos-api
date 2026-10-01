# Guia de desenvolvimento do frontend — Gestão de Atendimentos

> **Atualização 1.1:** nome no topo do menu, "Informação adicional" do cliente, nova ordem do menu e bloco da empresa discreto — veja `FRONTEND-AJUSTES.md`.

Guia para construir o front em React que consome a `gestao-atendimentos-api`.
Ele cobre a stack, a estrutura do projeto, sessão e refresh token, permissões, tema por empresa, cada tela com os endpoints dela, o checkout com o PaymentWidget e o painel admin.

> **Fonte da verdade dos contratos:** `GET {API}/docs` (Swagger) e `GET {API}/docs/openapi.json`. Este guia explica _como usar_. Se algum campo divergir, vale o OpenAPI.

---

## Sumário

1. [Stack recomendada](#1-stack-recomendada)
2. [Criando o projeto](#2-criando-o-projeto)
3. [Estrutura de pastas](#3-estrutura-de-pastas)
4. [Regras de ouro da API](#4-regras-de-ouro-da-api)
5. [Cliente HTTP e refresh token](#5-cliente-http-e-refresh-token)
6. [Sessão, status da empresa e rotas protegidas](#6-sessão-status-da-empresa-e-rotas-protegidas)
7. [Permissões e módulos no menu](#7-permissões-e-módulos-no-menu)
8. [Tema por empresa (cores e logo)](#8-tema-por-empresa-cores-e-logo)
9. [Campos personalizados por segmento](#9-campos-personalizados-por-segmento)
10. [Dinheiro, datas e fuso horário](#10-dinheiro-datas-e-fuso-horário)
11. [Tratamento de erros](#11-tratamento-de-erros)
12. [Telas: fluxo público](#12-telas-fluxo-público)
13. [Telas: área da empresa](#13-telas-área-da-empresa)
14. [Painel do super admin](#14-painel-do-super-admin)
15. [Tipos TypeScript](#15-tipos-typescript)
16. [Ordem de construção](#16-ordem-de-construção)
17. [Deploy e checklist final](#17-deploy-e-checklist-final)

---

## 1. Stack recomendada

| Necessidade       | Escolha                                                                 | Por quê                                                                     |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Base              | **React + Vite + TypeScript**                                           | Tipos dos contratos da API evitam bugs com centavos, status e datas         |
| Rotas             | **React Router**                                                        | Rotas aninhadas para os layouts (público, app, admin)                       |
| Dados do servidor | **TanStack Query**                                                      | Cache, refetch, invalidação após mutação e polling (PDF, pagamento) prontos |
| HTTP              | **Axios**                                                               | Interceptors para o refresh automático                                      |
| Formulários       | **React Hook Form + Zod**                                               | Validação no front espelhando os schemas Joi da API                         |
| Estilo            | **CSS Modules + variáveis CSS**                                         | O tema de cada empresa vira variáveis CSS (ver seção 8)                     |
| Agenda            | **FullCalendar** (`@fullcalendar/react`, visões `timeGrid` e `dayGrid`) | Dia, semana e mês com arrastar para remarcar                                |
| Gráficos          | **Recharts**                                                            | Entradas × saídas, despesas por categoria, receita por serviço              |
| Toasts            | **Notyf**                                                               | Leve; você já usa                                                           |
| Ícones            | **Boxicons** ou **Lucide**                                              | —                                                                           |
| Checkout          | **`@payment-system-mp/react-widget`**                                   | Já fala o contrato da API (seção 12.3)                                      |

> O PaymentWidget usa MUI internamente, com `ThemeProvider` próprio. Ele não interfere no resto do app, mas as dependências do MUI precisam estar instaladas.
> A visão de agenda **por profissional em colunas** (resource view) é paga no FullCalendar. Na versão gratuita, use um filtro de profissional + cor por profissional.

---

## 2. Criando o projeto

```bash
npm create vite@latest gestao-atendimentos-web -- --template react-ts
cd gestao-atendimentos-web

npm i react-router-dom @tanstack/react-query axios react-hook-form zod @hookform/resolvers \
      recharts notyf @fullcalendar/react @fullcalendar/core @fullcalendar/daygrid \
      @fullcalendar/timegrid @fullcalendar/interaction qrcode.react

# checkout (pacote do GitHub, não do npm público)
npm i github:jefferson-da-silva-santos/payment-widget-react @mui/material @mui/icons-material @emotion/react @emotion/styled
```

`.env` do front:

```bash
VITE_API_URL=http://localhost:3000
```

No `.env` da **API**, garanta `CORS_ORIGINS=http://localhost:5173` e `APP_URL=http://localhost:5173`.

---

## 3. Estrutura de pastas

```
src/
  main.tsx                      # QueryClientProvider + RouterProvider
  routes.tsx                    # árvore de rotas (público / app / admin)
  api/
    http.ts                     # axios da empresa + refresh automático
    adminHttp.ts                # axios do admin (sessão separada)
    types.ts                    # tipos dos contratos (seção 15)
    endpoints/                  # uma função por endpoint, agrupadas por módulo
      auth.ts  clientes.ts  servicos.ts  atendimentos.ts  agenda.ts
      orcamentos.ts  despesas.ts  dashboard.ts  usuarios.ts  profissionais.ts
      configuracoes.ts  publico.ts  checkout.ts  admin.ts
  auth/
    SessionProvider.tsx         # usuário, empresa, permissões, login/logout
    usePermissao.ts             # pode('clientes:escrever')
    guards.tsx                  # <RequireAuth>, <RequirePermissao>, <StatusGate>
  theme/
    applyTheme.ts               # aparencia da empresa -> variáveis CSS
  lib/
    money.ts                    # centavos <-> BRL, máscara de input
    dates.ts                    # formatação no fuso da empresa
    errors.ts                   # código de erro -> mensagem/ação
    rotulos.ts                  # rótulos do segmento ("Tutor", "Paciente"...)
  components/
    ui/                         # Button, Input, MoneyInput, Select, Modal, Table, Pagination, EmptyState
    CamposExtras.tsx            # formulário dinâmico por segmento
    StatusBadge.tsx
  layouts/
    PublicLayout.tsx  AppLayout.tsx (sidebar + topbar)  AdminLayout.tsx
  pages/
    publico/   Planos.tsx  Cadastro.tsx  Checkout.tsx  Login.tsx
    app/       Dashboard.tsx  Agenda.tsx  Atendimentos/*  Clientes/*  Servicos/*  Historico.tsx
               Orcamentos/*  Despesas/*  Financeiro.tsx  Profissionais/*  Equipe/*  Configuracoes.tsx
               Pendente.tsx  SomenteLeitura (banner)  Desativada.tsx
    admin/     Login.tsx  Configurar2fa.tsx  Empresas.tsx  EmpresaDetalhe.tsx  Catalogo.tsx  Auditoria.tsx
```

Regra prática: **as páginas não chamam axios direto.** Elas usam hooks do TanStack Query que chamam `api/endpoints/*`.

---

## 4. Regras de ouro da API

| Regra              | Na prática                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Envelope           | Toda resposta JSON é `{ success, message, data, meta, timestamp }`. Use `res.data.data`.                        |
| Erros              | `{ success: false, message, code, errors[], requestId }`. Decida pelo **`code`**, não pelo texto.               |
| Dinheiro           | Sempre **centavos inteiros** (`valorCentavos: 8000` = R$ 80,00). Nunca envie float.                             |
| Datas              | Instantes em ISO UTC (`2026-10-05T13:00:00.000Z`). Datas puras em `AAAA-MM-DD` (nascimento, despesa, validade). |
| Paginação          | `?page=1&perPage=20` (máx. 100) → `meta: { total, page, perPage, totalPages }`                                  |
| Campos opcionais   | No PUT, campo **ausente não altera**; **`null` limpa**. Não mande `""` para limpar.                             |
| Erros de validação | `errors[].field` vem prefixado: `body.email`, `query.inicio`, `camposExtras.petNome`.                           |
| Request ID         | Mostre o `requestId` na tela de erro genérico ("informe este código ao suporte").                               |

---

## 5. Cliente HTTP e refresh token

### Como a sessão funciona

- `POST /v1/auth/login` devolve o **access token** (15 min) no corpo e grava o **refresh token** num cookie `httpOnly` (`ga_rt`, path `/v1/auth`).
- Guarde o access token **em memória**, nunca no `localStorage`. Ao recarregar a página, chame `POST /v1/auth/refresh` para recuperar a sessão pelo cookie.
- Toda chamada que envolve o cookie precisa de **`withCredentials: true`**.
- Access token expirado → a API responde **401 `TOKEN_EXPIRADO`** → faça refresh e repita a requisição.

### ⚠️ Cuidado com várias abas

O refresh é **rotativo e detecta reuso**. Se duas abas fizerem refresh ao mesmo tempo com o mesmo cookie, a segunda usa um token já revogado e a API **derruba a sessão inteira** (`REFRESH_REUTILIZADO`).
Por isso o refresh precisa ser **serializado entre abas** com a Web Locks API e **deduplicado dentro da aba** (uma única Promise). O código abaixo já faz as duas coisas.

```ts
// src/api/http.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

const API = import.meta.env.VITE_API_URL;
let accessToken: string | null = null;
let refreshing: Promise<string | null> | null = null;
let onSessionLost: () => void = () => {};

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const onLogout = (fn: () => void) => {
  onSessionLost = fn;
};

export const http = axios.create({ baseURL: `${API}/v1`, withCredentials: true });

http.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

/** Refresh único por aba e serializado entre abas (Web Locks). */
export function refreshSession(): Promise<string | null> {
  refreshing ??= (async () => {
    const run = async () => {
      try {
        const r = await axios.post(`${API}/v1/auth/refresh`, {}, { withCredentials: true });
        setAccessToken(r.data.data.accessToken);
        return r.data.data; // sessão completa: usuario, empresa, permissoes
      } catch {
        setAccessToken(null);
        return null;
      }
    };
    return 'locks' in navigator ? navigator.locks.request('ga-refresh', run) : run();
  })().finally(() => {
    refreshing = null;
  });
  return refreshing.then((s) => (s ? s.accessToken : null));
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError<any>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const code = error.response?.data?.code;

    if (error.response?.status === 401 && code === 'TOKEN_EXPIRADO' && !original._retry) {
      original._retry = true;
      const token = await refreshSession();
      if (token) return http(original);
    }
    if (error.response?.status === 401 && ['SESSAO_INVALIDA', 'REFRESH_INVALIDO', 'REFRESH_REUTILIZADO'].includes(code)) {
      onSessionLost();
    }
    return Promise.reject(error);
  },
);

/** Desembrulha o envelope. */
export const unwrap = <T>(p: Promise<{ data: { data: T; meta?: any } }>) => p.then((r) => r.data.data);
export const unwrapPage = <T>(p: Promise<{ data: { data: T[]; meta: Paginacao } }>) => p.then((r) => ({ items: r.data.data, meta: r.data.meta }));

export type Paginacao = { total: number; page: number; perPage: number; totalPages: number };
```

> **Por que o refresh não acontece só no 401?** Também é possível agendar um refresh silencioso ~1 min antes de expirar (`expiresIn: "15m"`). Começar pelo 401 é mais simples e já basta.

### Endpoints como funções

```ts
// src/api/endpoints/clientes.ts
import { http, unwrap, unwrapPage } from '../http';
import type { Cliente, ClienteResumo } from '../types';

export const clientesApi = {
  listar: (p: { busca?: string; status?: string; page?: number; perPage?: number }) => unwrapPage<Cliente>(http.get('/clientes', { params: p })),
  obter: (id: string) => unwrap<Cliente>(http.get(`/clientes/${id}`)),
  criar: (body: Partial<Cliente>) => unwrap<Cliente>(http.post('/clientes', body)),
  atualizar: (id: string, body: Partial<Cliente>) => unwrap<Cliente>(http.put(`/clientes/${id}`, body)),
  remover: (id: string) => http.delete(`/clientes/${id}`),
  resumo: (id: string) => unwrap<ClienteResumo>(http.get(`/clientes/${id}/resumo`)),
};
```

```ts
// uso numa página
const { data, isLoading } = useQuery({
  queryKey: ['clientes', filtros],
  queryFn: () => clientesApi.listar(filtros),
  placeholderData: keepPreviousData, // paginação sem "piscar"
});
```

**Chaves do TanStack Query** — padronize para invalidar com precisão:

| Mutação                            | Invalidar                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| criar/editar/status de atendimento | `['atendimentos']`, `['agenda']`, `['dashboard']`, `['clientes', id, 'resumo']` |
| criar/editar despesa               | `['despesas']`, `['dashboard']`, `['financeiro']`                               |
| editar orçamento                   | `['orcamentos']`, `['orcamentos', id, 'pdf']`                                   |
| salvar configurações               | `['me']` (recarrega tema e campos)                                              |

---

## 6. Sessão, status da empresa e rotas protegidas

### SessionProvider

```tsx
// src/auth/SessionProvider.tsx (essencial)
type Sessao = { usuario: Usuario; empresa: EmpresaSessao; permissoes: string[] };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    onLogout(() => setSessao(null));
    // restaura a sessão pelo cookie ao abrir/recarregar
    refreshSession().then(async (token) => {
      if (token) setSessao(await unwrap<Sessao>(http.get('/auth/me')));
      setCarregando(false);
    });
  }, []);

  useEffect(() => {
    if (sessao) applyTheme(sessao.empresa.aparencia);
  }, [sessao]);

  const login = async (email: string, senha: string) => {
    const s = await unwrap<Sessao & { accessToken: string }>(http.post('/auth/login', { email, senha }));
    setAccessToken(s.accessToken);
    setSessao(s);
  };
  const logout = async () => {
    await http.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setSessao(null);
  };
  const recarregar = async () => setSessao(await unwrap<Sessao>(http.get('/auth/me')));

  // ...context provider
}
```

### Status da empresa → o que mostrar

| `empresa.status`  | Comportamento no front                                                                                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDENTE`        | Redirecione **tudo** para `/pendente`, com o botão "Concluir pagamento" que chama `POST /v1/auth/checkout-link` e navega para `/checkout/{checkoutToken}`. A API responde **402** em qualquer outra rota.         |
| `ATIVO`           | Normal.                                                                                                                                                                                                           |
| `SOMENTE_LEITURA` | Banner fixo no topo ("Sua conta está em modo somente leitura. Regularize a assinatura."). **Esconda/desabilite** botões de criar, editar e excluir. A API responde 403 `EMPRESA_SOMENTE_LEITURA` se algo escapar. |
| `DESATIVADO`      | O login responde 403 `EMPRESA_DESATIVADA`. Mostre a tela "Acesso desativado — fale com o suporte".                                                                                                                |

```tsx
// src/auth/guards.tsx
export function StatusGate({ children }: { children: ReactNode }) {
  const { sessao } = useSession();
  if (sessao?.empresa.status === 'PENDENTE') return <Navigate to="/pendente" replace />;
  return <>{children}</>;
}

export const useSomenteLeitura = () => useSession().sessao?.empresa.status === 'SOMENTE_LEITURA';
```

### Árvore de rotas

```tsx
// src/routes.tsx
<Routes>
  <Route element={<PublicLayout />}>
    <Route path="/" element={<Planos />} />
    <Route path="/cadastro" element={<Cadastro />} />
    <Route path="/checkout/:token" element={<Checkout />} /> {/* não exige login */}
    <Route path="/login" element={<Login />} />
  </Route>
  <Route element={<RequireAuth />}>
    <Route path="/pendente" element={<Pendente />} />
    <Route
      element={
        <StatusGate>
          <AppLayout />
        </StatusGate>
      }
    >
      <Route
        path="/app"
        element={
          <RequirePermissao p="dashboard:ver" fallback="/app/agenda">
            <Dashboard />
          </RequirePermissao>
        }
      />
      <Route path="/app/agenda" element={<Agenda />} />
      <Route path="/app/atendimentos/*" element={<Atendimentos />} />
      <Route path="/app/clientes/*" element={<Clientes />} />
      <Route path="/app/servicos/*" element={<Servicos />} />
      <Route
        path="/app/orcamentos/*"
        element={
          <RequirePermissao p="orcamentos:ler">
            <Orcamentos />
          </RequirePermissao>
        }
      />
      <Route
        path="/app/despesas/*"
        element={
          <RequirePermissao p="despesas:ler">
            <Despesas />
          </RequirePermissao>
        }
      />
      <Route
        path="/app/financeiro"
        element={
          <RequirePermissao p="financeiro:ver">
            <Financeiro />
          </RequirePermissao>
        }
      />
      <Route
        path="/app/profissionais/*"
        element={
          <RequirePermissao p="profissionais:ler">
            <Profissionais />
          </RequirePermissao>
        }
      />
      <Route
        path="/app/equipe/*"
        element={
          <RequirePermissao p="usuarios:gerenciar">
            <Equipe />
          </RequirePermissao>
        }
      />
      <Route
        path="/app/configuracoes"
        element={
          <RequirePermissao p="configuracoes:gerenciar">
            <Configuracoes />
          </RequirePermissao>
        }
      />
    </Route>
  </Route>
  <Route path="/admin/*" element={<AdminApp />} /> {/* sessão separada — seção 14 */}
</Routes>
```

> **Profissional não tem `dashboard:ver`.** Faça a página inicial dele ser a agenda (o `fallback` acima).

---

## 7. Permissões e módulos no menu

`/auth/me` devolve `permissoes` **já filtradas pelos módulos contratados**. O front só pergunta "posso?".

```ts
// src/auth/usePermissao.ts
export function usePermissao() {
  const { sessao } = useSession();
  const set = useMemo(() => new Set(sessao?.permissoes ?? []), [sessao]);
  const leitura = sessao?.empresa.status === 'SOMENTE_LEITURA';
  return {
    pode: (p: string) => set.has(p),
    podeEscrever: (p: string) => set.has(p) && !leitura, // use nos botões de ação
    temModulo: (m: string) => sessao?.empresa.modulos.includes(m) ?? false,
  };
}
```

**Menu lateral** (mostre o item quando a permissão existir):

| Item                          | Permissão                 | Módulo             |
| ----------------------------- | ------------------------- | ------------------ |
| Dashboard                     | `dashboard:ver`           | Núcleo             |
| Agenda                        | `agenda:ler`              | Núcleo             |
| Atendimentos                  | `atendimentos:ler`        | Núcleo             |
| Clientes (rótulo do segmento) | `clientes:ler`            | Núcleo             |
| Serviços                      | `servicos:ler`            | Núcleo             |
| Histórico                     | `clientes:ler`            | Núcleo             |
| Orçamentos                    | `orcamentos:ler`          | Orçamentos         |
| Despesas                      | `despesas:ler`            | Financeiro         |
| Financeiro                    | `financeiro:ver`          | Financeiro         |
| Profissionais                 | `profissionais:ler`       | Multi-profissional |
| Equipe                        | `usuarios:gerenciar`      | Multi-profissional |
| Configurações                 | `configuracoes:gerenciar` | Núcleo             |

**Upsell:** para o proprietário, mostre os módulos **não contratados** com um cadeado ("Disponível no módulo Financeiro — fale com o suporte"). Se a API devolver `MODULO_NAO_CONTRATADO`, use a mesma mensagem.

**Profissional (ABAC):** a API já filtra a agenda e os atendimentos dele. No front, **esconda o seletor de profissional** quando o usuário não tiver `atendimentos:todos`.

---

## 8. Tema por empresa (cores e logo)

`empresa.aparencia` = `{ corPrimaria, corSecundaria, tema: 'claro' | 'escuro', logoUrl, faviconUrl }`.

```ts
// src/theme/applyTheme.ts
export function applyTheme(a: Aparencia) {
  const root = document.documentElement;
  root.style.setProperty('--primary-color', a.corPrimaria ?? '#6D5EF8');
  root.style.setProperty('--secondary-color', a.corSecundaria ?? '#14B8A6');
  root.dataset.theme = a.tema === 'escuro' ? 'dark' : 'light';
  if (a.faviconUrl) (document.querySelector("link[rel='icon']") as HTMLLinkElement).href = a.faviconUrl;
}
```

```css
/* src/index.css */
:root {
  --primary-color: #6d5ef8;
  --secondary-color: #14b8a6;
  --background-color: #f6f7fb;
  --surface-color: #ffffff;
  --text-color: #1f2430;
  --muted-color: #6b7280;
  --primary-contrast: #ffffff;
}
:root[data-theme='dark'] {
  --background-color: #0f1117;
  --surface-color: #181b24;
  --text-color: #e6e8ef;
  --muted-color: #9aa1b2;
}
```

- Componentes usam **só variáveis** (`background: var(--primary-color)`). Nunca use cor fixa.
- Contraste: escolha o texto sobre a cor primária pela luminância (texto branco em cor escura, texto escuro em cor clara) e grave em `--primary-contrast`.
- Passe `accentColor={aparencia.corPrimaria}` também para o PaymentWidget e o `theme` correspondente.
- Na tela de Configurações, pré-visualize as cores **ao vivo** chamando `applyTheme` enquanto o usuário escolhe, antes de salvar.

---

## 9. Campos personalizados por segmento

`empresa.camposPersonalizados`:

```json
{
  "rotulos": { "cliente": "Tutor", "servico": "Serviço", "atendimento": "Atendimento" },
  "cliente": [],
  "atendimento": [
    { "chave": "petNome", "rotulo": "Nome do pet", "tipo": "texto", "obrigatorio": true },
    { "chave": "especie", "rotulo": "Espécie", "tipo": "selecao", "obrigatorio": true, "opcoes": ["Cachorro", "Gato", "Outro"] }
  ]
}
```

1. **Rótulos:** use `rotulos.cliente` no menu, nos títulos e nos botões ("Novo tutor", "Pacientes"). Centralize em `lib/rotulos.ts`.
2. **Formulário dinâmico:** renderize `camposPersonalizados.cliente` no form de cliente e `camposPersonalizados.atendimento` no form de atendimento, dentro de `camposExtras`.

```tsx
// src/components/CamposExtras.tsx
export function CamposExtras({ defs, register, errors }: Props) {
  return (
    <>
      {defs.map((c) => {
        const name = `camposExtras.${c.chave}` as const;
        const rules = { required: c.obrigatorio && `${c.rotulo} é obrigatório` };
        switch (c.tipo) {
          case 'selecao':
            return (
              <Select key={c.chave} label={c.rotulo} {...register(name, rules)}>
                <option value="">Selecione</option>
                {c.opcoes!.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            );
          case 'numero':
            return <Input key={c.chave} type="number" label={c.rotulo} {...register(name, { ...rules, valueAsNumber: true })} />;
          case 'data':
            return <Input key={c.chave} type="date" label={c.rotulo} {...register(name, rules)} />;
          case 'booleano':
            return <Checkbox key={c.chave} label={c.rotulo} {...register(name)} />;
          default:
            return <Input key={c.chave} label={c.rotulo} {...register(name, rules)} />;
        }
      })}
    </>
  );
}
```

3. Nas listagens e no card da agenda, mostre os campos-chave (ex.: o nome do pet no card do atendimento do pet shop).
4. Erros vêm como `camposExtras.petNome` → mapeie para o campo (seção 11).

---

## 10. Dinheiro, datas e fuso horário

### Dinheiro

```ts
// src/lib/money.ts
export const brl = (centavos: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100);

/** Input estilo "caixa registradora": digitar 1 2 3 4 => R$ 12,34 */
export function MoneyInput({ value, onChange }: { value: number; onChange: (c: number) => void }) {
  return (
    <input
      inputMode="numeric"
      value={brl(value)}
      onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
    />
  );
}
```

- **Comissão:** a API usa basis points (`comissaoBps: 4000`). No form, mostre "40%" e converta (`% × 100`).
- **Nunca calcule o total final no front** para enviar. O front pode **pré-visualizar** (soma dos itens − desconto + acréscimo), mas quem calcula é a API, e a resposta dela é o valor que vale.

### Datas

- **Instantes** (início do atendimento): envie `new Date(...).toISOString()`.
- **Datas puras** (nascimento, despesa, validade): envie `'2026-10-05'`, sem hora.
- **Exiba no fuso da empresa** (`empresa.fusoHorario`), não no fuso do navegador:

```ts
// src/lib/dates.ts
export const fmtHora = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDataHora = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
export const fmtData = (yyyyMmDd: string) => yyyyMmDd.split('-').reverse().join('/');
```

- No FullCalendar, defina `timeZone={empresa.fusoHorario}` (precisa do plugin de fuso, ou use `'local'` se a empresa e os usuários estão no mesmo fuso, o caso comum).

---

## 11. Tratamento de erros

```ts
// src/lib/errors.ts
export function tratarErro(err: any, setError?: UseFormSetError<any>) {
  const body = err?.response?.data;
  if (!body) return notyf.error('Sem conexão com o servidor.');

  // erros de campo -> direto no formulário
  if (setError && body.errors?.length) {
    body.errors.forEach((e: { field: string; message: string }) => setError(e.field.replace(/^(body|query|params)\./, ''), { message: e.message }));
  }

  const acoes: Record<string, () => void> = {
    ASSINATURA_PENDENTE: () => navigate('/pendente'),
    EMPRESA_SOMENTE_LEITURA: () => notyf.error(body.message),
    EMPRESA_DESATIVADA: () => navigate('/conta-desativada'),
    MODULO_NAO_CONTRATADO: () => notyf.error('Recurso disponível em outro módulo. Fale com o suporte.'),
    RATE_LIMITED: () => notyf.error('Muitas tentativas. Aguarde alguns minutos.'),
  };
  (acoes[body.code] ?? (() => notyf.error(body.message)))();
}
```

**Códigos que merecem UX específica**

| `code`                                                                        | UX                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `AGENDA_CONFLITO` (409)                                                       | Modal: "Horário ocupado por Maria. **[Ver horários livres]** **[Marcar como encaixe]**". O encaixe reenvia com `encaixe: true`. |
| `TRANSICAO_INVALIDA` (422)                                                    | Recarregue o atendimento: alguém mudou o status.                                                                                |
| `CONFLITO_CONCORRENCIA` (409)                                                 | "Alterado por outra pessoa." Recarregue os dados.                                                                               |
| `CLIENTE_COM_HISTORICO`, `SERVICO_EM_USO`, `PROFISSIONAL_COM_HISTORICO` (409) | Ofereça **"Inativar"** em vez de excluir.                                                                                       |
| `CAMPOS_EXTRAS_INVALIDOS` (422)                                               | Marque os campos dinâmicos (vêm em `errors`).                                                                                   |
| `DESCONTO_INVALIDO` (422)                                                     | Destaque o campo de desconto.                                                                                                   |
| `ORCAMENTO_ITEM_SEM_SERVICO` (422)                                            | "Vincule cada item a um serviço antes de agendar."                                                                              |
| `EMAIL_EM_USO` (409)                                                          | No cadastro: link para o login.                                                                                                 |
| `PAGAMENTOS_*` (502/503/504)                                                  | "Serviço de pagamento instável, tente em instantes."                                                                            |
| 500 `ERRO_INTERNO`                                                            | Mensagem genérica + `requestId` para o suporte.                                                                                 |

---

## 12. Telas: fluxo público

### 12.1 Planos — `/`

- `GET /v1/public/plano` → `{ plano: { precoBaseCentavos }, modulos: [{ codigo, nome, descricao, precoCentavos, obrigatorio }] }`
- Mostre os módulos como **cards com toggle**. O Núcleo (`obrigatorio`) fica sempre marcado e desabilitado.
- Atualize o total ao marcar ou desmarcar: some no front para resposta instantânea **e** confirme com `POST /v1/public/plano/preco { modulos }` (debounce de 300 ms). O valor oficial é o da API.
- `GET /v1/public/segmentos` → seletor "Qual é o seu negócio?" (pet shop, salão...). Ele define rótulos e campos.

### 12.2 Cadastro — `/cadastro`

`POST /v1/public/cadastro`

```json
{
  "empresa": { "nome": "Pet Shop Rex", "email": "contato@rex.com", "segmento": "PETSHOP", "telefone": "81999990000", "documento": "12345678000199" },
  "proprietario": { "nome": "Jefferson", "email": "jefferson@rex.com", "senha": "Senha1234" },
  "modulos": ["ORCAMENTOS", "FINANCEIRO"],
  "aceiteTermos": true
}
```

- Senha: 8 a 72 caracteres, **com letras e números** (valide no Zod igual).
- Use `withCredentials: true`: a resposta já grava o cookie de sessão.
- A resposta traz `sessao` (com `accessToken`) e `checkoutToken`. Faça `setAccessToken(sessao.accessToken)`, carregue a sessão e navegue para **`/checkout/{checkoutToken}`**.
- O usuário também recebe por e-mail o link do checkout (válido por 72h).

### 12.3 Checkout — `/checkout/:token`

Esta página **não exige login**: o token na URL identifica a empresa.

```tsx
import { PaymentWidget } from '@payment-system-mp/react-widget';

export default function Checkout() {
  const { token } = useParams();
  const apiBaseUrl = `${import.meta.env.VITE_API_URL}/v1/checkout/${token}`;
  const { data: resumo, error } = useQuery({
    queryKey: ['checkout', token],
    queryFn: () => axios.get(`${apiBaseUrl}/resumo`).then((r) => r.data.data),
    retry: false,
  });

  if (error) return <LinkExpirado />; // 401 CHECKOUT_INVALIDO -> "faça login para gerar outro link"
  if (!resumo) return <Spinner />;
  if (resumo.pago) return <Navigate to="/app" />;

  return (
    <div className={s.layout}>
      <aside>
        <h2>{resumo.empresa.nome}</h2>
        {resumo.modulos.map((m) => (
          <p key={m.codigo}>
            {m.nome} — {brl(m.precoCentavos)}
          </p>
        ))}
        <strong>Total: {brl(resumo.valorCentavos)}/mês</strong>
      </aside>
      <PaymentWidget
        apiBaseUrl={apiBaseUrl}
        publicKey={resumo.publicKey}
        amount={resumo.valor} // só exibição: o servidor ignora e usa o valor real
        description={resumo.descricao}
        methods={resumo.metodos}
        theme="light"
        persistDraft={false}
        onPaymentApproved={async () => {
          await recarregarSessao(); // empresa agora está ATIVO
          navigate('/app');
        }}
      />
    </div>
  );
}
```

- A confirmação do Pix/boleto vem pelo **polling do próprio widget** (`GET /payments/:id`), que ativa a empresa na API.
- Se o usuário fechar a aba, um job confirma em até 5 min. Ao fazer login de novo, o `/auth/me` já mostra `ATIVO`.
- Na tela `/pendente`: "Já pagou? **[Verificar agora]**" (chama `recarregarSessao()`) e "**[Gerar novo link]**" (`POST /v1/auth/checkout-link`).

### 12.4 Login — `/login`

- `POST /v1/auth/login { email, senha }` com `withCredentials`.
- 401 `CREDENCIAIS_INVALIDAS` → "E-mail ou senha inválidos" (a API não diz qual dos dois está errado, de propósito).
- 403 `USUARIO_INATIVO` / `EMPRESA_DESATIVADA` → mensagens específicas.
- 429 → "Muitas tentativas, aguarde 15 minutos".
- Depois do login: `PENDENTE` → `/pendente`; com `dashboard:ver` → `/app`; senão → `/app/agenda`.

---

## 13. Telas: área da empresa

### 13.1 Dashboard — `/app`

`GET /v1/dashboard?ano=2026&mes=10`

```ts
{
  periodo: { ano, mes, mesIndicadores, fusoHorario },
  indicadores: { entradasCentavos, despesasCentavos, comissoesCentavos, saldoCentavos,
                 atendimentosRealizados, atendimentosAgendados, atendimentosCancelados,
                 ticketMedioCentavos, totalClientes },
  graficos: {
    entradasSaidasPorMes: [{ mes, entradasCentavos, saidasCentavos, saldoCentavos, atendimentosRealizados, atendimentosCancelados }], // 12 meses
    despesasPorCategoria: [{ categoriaId, nome, cor, totalCentavos, quantidade }],
    receitaPorServico: [{ servicoId, nome, quantidade, receitaCentavos }],
    evolucaoFaturamento: [{ mes, acumuladoCentavos }],
  },
  financeiroDisponivel: boolean,
}
```

- **Filtros:** ano (select) e mês (opcional). Sem mês, os cards mostram o mês atual e os gráficos o ano.
- **Cards:** Entradas, Despesas, Saldo, Realizados, Agendados, Ticket médio, Clientes.
- **Gráficos (Recharts):** barras agrupadas entradas × saídas por mês; linha de faturamento acumulado; pizza/barras de despesas por categoria; barras horizontais de receita por serviço (mostre também a quantidade, porque "mais realizado" ≠ "mais rentável").
- Se `financeiroDisponivel` for `false`, esconda despesas/saldo e mostre o card de upsell.
- Lembrete na UI: "Receita considera apenas atendimentos **realizados**."
- Widgets extras na lateral: **aniversariantes** (`GET /v1/clientes/aniversariantes?dias=7`) e **clientes para reativar** (`GET /v1/clientes/inativos?dias=60`), com botão "Chamar no WhatsApp" (`https://wa.me/55{whatsapp}?text=...`).

### 13.2 Agenda — `/app/agenda`

- `GET /v1/agenda?inicio=ISO&fim=ISO&profissionalId=` (máx. 62 dias). Busque o **intervalo visível** do calendário (`datesSet` do FullCalendar → `queryKey: ['agenda', inicio, fim, prof]`).
- Mapeie para eventos:

```ts
const eventos = data.map((a) => ({
  id: a.id,
  start: a.inicio,
  end: a.fim,
  title: `${a.cliente.nome} · ${a.itens.map((i) => i.descricao).join(', ')}`,
  backgroundColor: a.profissional?.cor ?? 'var(--primary-color)',
  classNames: [`status-${a.status.toLowerCase()}`, a.encaixe ? 'encaixe' : ''],
  extendedProps: a,
}));
```

- **Clicar num horário vazio** abre o modal "Novo atendimento" com o início preenchido.
- **Clicar num evento** abre o detalhe com ações por status:

| Status                | Ações                                                |
| --------------------- | ---------------------------------------------------- |
| AGENDADO              | Confirmar · Realizado · Cancelar · Editar/remarcar   |
| CONFIRMADO            | Realizado · Voltar para agendado · Cancelar · Editar |
| REALIZADO / CANCELADO | Só visualizar                                        |

- **Arrastar para remarcar** (`eventDrop`) → `PUT /v1/atendimentos/{id} { inicio }`. A API recalcula o fim. Em `AGENDA_CONFLITO`, chame `info.revert()` e mostre o modal de conflito.
- **"Realizado"** abre um mini-modal pedindo a **forma de pagamento** → `PATCH /status { status: 'REALIZADO', formaPagamento }`.
- **"Cancelar"** pede o motivo → `PATCH /status { status: 'CANCELADO', motivo }`.
- Botão **"Horários livres"**: `GET /v1/agenda/horarios-livres?data=2026-10-05&servicoIds=a&servicoIds=b&profissionalId=` → `{ horarios: [{ inicio, fim }] }`. Mostre os horários como chips clicáveis que preenchem o form.
- Filtro de profissional só para quem tem `atendimentos:todos`.

### 13.3 Atendimentos — `/app/atendimentos`

- **Lista:** `GET /v1/atendimentos?inicio=&fim=&status=AGENDADO&status=CONFIRMADO&clienteId=&profissionalId=&page=`.
- **Form (criar/editar):**
  - Cliente: autocomplete com `GET /v1/clientes?busca=` (debounce de 300 ms) + atalho "Cadastrar novo".
  - Profissional: só se tiver o módulo Multi-profissional.
  - Data/hora de início. O fim é opcional: a API calcula pela duração dos serviços.
  - **Itens:** lista dinâmica de `{ servicoId, quantidade, valorUnitarioCentavos? }`. Ao escolher o serviço, preencha preço e duração do cadastro (editáveis).
  - Desconto/acréscimo (`MoneyInput`), observações, `camposExtras` do segmento.
  - Pré-visualização do subtotal, total e "termina às HH:mm".
  - Status inicial: AGENDADO (padrão), CONFIRMADO ou **REALIZADO** ("Lançar atendimento já feito", com forma de pagamento).
- `POST /v1/atendimentos` / `PUT /v1/atendimentos/{id}`. No PUT, **enviar `itens` substitui todos os itens**.
- Só AGENDADO/CONFIRMADO são editáveis: esconda "Editar" nos demais.

### 13.4 Clientes — `/app/clientes`

- **Lista:** `GET /v1/clientes?busca=&status=ATIVO&ordenar=nome|recentes&page=`. A busca aceita nome, e-mail, telefone ou documento.
- **Form:** máscaras de telefone, CPF/CNPJ e CEP **no front**, mas envie **só dígitos**. Data de nascimento em `AAAA-MM-DD`. Busca de CEP opcional (ViaCEP). Campos extras do segmento.
- **Página do cliente** (`/app/clientes/:id`):
  - `GET /v1/clientes/{id}/resumo` → cards: total gasto, atendimentos, ticket médio, frequência média, último/próximo atendimento e **situação de retorno** (badge: `EM_DIA` verde, `PROVAVEL_RETORNO` amarelo, `ATRASADO` vermelho).
  - `GET /v1/clientes/{id}/historico?page=` → timeline (cancelados aparecem riscados ou com badge).
  - Botões: "Novo atendimento" (pré-preenche o cliente), "Novo orçamento", "WhatsApp".
- **Excluir:** em 409 `CLIENTE_COM_HISTORICO`, ofereça "Inativar" (`PUT { status: 'INATIVO' }`).

### 13.5 Histórico — `/app/historico`

Seletor de cliente (autocomplete) + o mesmo `resumo` e `historico` da página do cliente. É um atalho de navegação, não um endpoint novo.

### 13.6 Serviços — `/app/servicos`

- `GET /v1/servicos?busca=&status=&categoria=`, `GET /v1/servicos/categorias` (para o filtro e o autocomplete de categoria).
- Form: nome, categoria, valor (`MoneyInput`), **duração em minutos** (select 15/30/45/60/90/120 + livre), descrição, status.
- 409 `SERVICO_EM_USO` ao excluir → oferecer inativar.

### 13.7 Orçamentos — `/app/orcamentos`

- **Lista:** `GET /v1/orcamentos?status=&clienteId=&numero=` → mostre `#00042`, cliente, total, validade e status.
- **Form:** cliente, data, validade, itens (**serviço** do catálogo _ou_ **item avulso** com descrição + valor), desconto, acréscimo, observações.
- **Ações por status:**

| Status              | Ações                                       |
| ------------------- | ------------------------------------------- |
| RASCUNHO            | Editar · Enviar · Aprovar · Excluir · PDF   |
| ENVIADO             | Editar · Aprovar · Recusar · PDF · WhatsApp |
| APROVADO            | **Agendar** (converter) · PDF               |
| RECUSADO / EXPIRADO | Visualizar · PDF (EXPIRADO → "Reenviar")    |

- **Converter:** modal com data/hora (+ profissional) → `POST /v1/orcamentos/{id}/converter { inicio, profissionalId }` → navegue para a agenda no dia. Em `ORCAMENTO_ITEM_SEM_SERVICO`, oriente a editar os itens avulsos.
- **PDF (assíncrono):** o endpoint responde **202** enquanto gera e **200** com o arquivo quando fica pronto.

```ts
async function baixarPdf(id: string) {
  for (let tentativa = 0; tentativa < 15; tentativa++) {
    const r = await http.get(`/orcamentos/${id}/pdf`, { responseType: 'blob', validateStatus: (s) => s === 200 || s === 202 });
    if (r.status === 200) {
      const url = URL.createObjectURL(r.data);
      window.open(url, '_blank');
      return;
    }
    await new Promise((res) => setTimeout(res, 2000)); // Retry-After: 2
  }
  notyf.error('O PDF está demorando. Tente novamente em instantes.');
}
```

- **WhatsApp:** depois de gerar o PDF, ofereça "Enviar pelo WhatsApp" com texto pronto (o arquivo é anexado manualmente pelo usuário).

### 13.8 Despesas — `/app/despesas`

- `GET /v1/despesas?inicio=2026-10-01&fim=2026-10-31&categoriaId=&status=&busca=` → mostre **`meta.totalValorCentavos`** no rodapé ("Total do período").
- `GET /v1/despesas/categorias` (12 padrão já criadas no cadastro) + CRUD de categorias numa aba (nome + cor).
- Form: descrição, categoria, valor, data (`AAAA-MM-DD`), forma de pagamento, status (PAGA/PENDENTE), observação.
- **Só despesas PAGA entram no financeiro e no dashboard.** Mostre isso na legenda.

### 13.9 Financeiro — `/app/financeiro`

- Filtro de período (atalhos: este mês, mês passado, trimestre, ano).
- `GET /v1/financeiro/resultado?inicio=&fim=` → "DRE simples":

```
Faturamento bruto      R$ 12.400,00
− Despesas             R$  3.150,00
− Comissões            R$  1.980,00
= Resultado            R$  7.270,00
```

- Mais: receita por forma de pagamento e despesas por categoria.
- Aba **Comissões** (`comissoes:ver`): `GET /v1/financeiro/comissoes?inicio=&fim=` → tabela por profissional (atendimentos, faturamento, %, comissão a pagar).

### 13.10 Profissionais — `/app/profissionais`

- CRUD com: nome, contato, **cor** (usada na agenda), **comissão (%)** → `comissaoBps`, **serviços que executa** (multi-select → `servicoIds`; no PUT substitui a lista), **expediente**:

```json
{
  "1": [
    { "inicio": "08:00", "fim": "12:00" },
    { "inicio": "13:00", "fim": "18:00" }
  ],
  "6": [{ "inicio": "08:00", "fim": "12:00" }]
}
```

Monte uma grade semanal (0 = domingo … 6 = sábado). Um dia sem chave usa o expediente padrão; `[]` = folga.

- `usuarioId` vincula o profissional a um login (veja Equipe).

### 13.11 Equipe — `/app/equipe`

- `GET /v1/usuarios`, `POST /v1/usuarios { nome, email, senha, papel, profissionalId? }`, `PATCH /v1/usuarios/{id} { nome?, papel?, ativo?, novaSenha? }`.
- Papéis com descrição na UI:
  - **Proprietário:** tudo.
  - **Recepcionista:** agenda, atendimentos e clientes de todos, orçamentos.
  - **Profissional:** só a própria agenda e os próprios atendimentos.
- Para criar um profissional com login: crie o **Profissional** primeiro e depois o **Usuário** com papel PROFISSIONAL e `profissionalId`.
- A API impede que você desative a si mesmo ou remova o último proprietário (`ALTERACAO_PROPRIA_PROIBIDA` / `ULTIMO_PROPRIETARIO`).

### 13.12 Configurações — `/app/configuracoes`

`GET /v1/configuracoes` · `PUT /v1/configuracoes` (envie só o que mudou)

Abas:

1. **Dados:** nome, nome fantasia, documento, contatos, endereço, fuso horário.
2. **Aparência:** cor primária e secundária (color picker com preview ao vivo), tema claro/escuro, **URL** da logo e do favicon (precisam ser `https://`; ainda não há upload na API).
3. **Segmento e campos:** trocar segmento; editor de campos personalizados (chave, rótulo, tipo, obrigatório, opções); botão "Restaurar padrão do segmento" (`aplicarPresetSegmento: true`).
4. **Minha conta:** trocar senha (`PUT /v1/auth/senha`; encerra as outras sessões).

Depois de salvar → `recarregarSessao()` para aplicar o tema e os rótulos.

---

## 14. Painel do super admin

Pode ficar no mesmo app em `/admin/*` (ou num app separado). A sessão é **totalmente separada**:

- Outro axios (`adminHttp`) com refresh em `POST /v1/admin/auth/refresh` (cookie `ga_art`, path `/v1/admin/auth`).
- Access token do admin em outra variável. **Nunca** misture os dois tokens.

### Login em duas etapas

```
POST /v1/admin/auth/login { email, senha }
  ├─ 2FA ainda não configurado → { accessToken, mfaConfiguracaoObrigatoria: true } → /admin/configurar-2fa
  └─ 2FA ativo → { mfaObrigatorio: true, mfaToken } → tela do código
        POST /v1/admin/auth/2fa/verificar { mfaToken, codigo } → { accessToken, admin }
```

**Configurar 2FA:** `POST /v1/admin/auth/2fa/configurar` → `{ otpauthUrl, segredo }`. Renderize o QR code com `qrcode.react` (`<QRCodeSVG value={otpauthUrl} />`), mostre o segredo para digitação manual e confirme com `POST /v1/admin/auth/2fa/ativar { codigo }`.
Enquanto o 2FA não estiver ativo, as outras rotas respondem 403 `MFA_CONFIGURACAO_OBRIGATORIA`.

### Telas

| Tela        | Endpoints                                                                             | Destaques                                                                           |
| ----------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Visão geral | `GET /v1/admin/metricas`                                                              | Empresas por status, receita mensal contratada, cadastros em 30 dias                |
| Empresas    | `GET /v1/admin/empresas?status=&busca=&page=`                                         | Badge de status, módulos, valor mensal, nº de usuários e clientes                   |
| Empresa     | `GET /v1/admin/empresas/{id}`                                                         | Dados, módulos, usuários, pagamentos de adesão                                      |
| ↳ Status    | `PATCH …/status { status, motivo }`                                                   | Botões **Ativar**, **Somente leitura**, **Desativar**, com **confirmação + motivo** |
| ↳ Módulos   | `PUT …/modulos { modulos, recalcularValor }`                                          | Checkboxes; mostre o novo valor mensal antes de confirmar                           |
| ↳ Usuários  | `PATCH …/usuarios/{usuarioId} { ativo?, papel? }`                                     | Ativar/desativar acesso                                                             |
| Catálogo    | `GET /v1/admin/catalogo`, `PUT …/catalogo/plano`, `PATCH …/catalogo/modulos/{codigo}` | Aviso: "preço vale só para novos cadastros"                                         |
| Auditoria   | `GET /v1/admin/auditoria?empresaId=&acao=&page=`                                      | Tabela com data, ação, entidade, admin/usuário e IP                                 |

> **Fluxo da mensalidade atrasada** (cobrada pelo outro sistema): Empresas → filtrar → **Somente leitura** com motivo "Mensalidade de outubro em aberto". Pagou → **Ativar**. Sem retorno → **Desativar**. Nada é apagado.

---

## 15. Tipos TypeScript

```ts
// src/api/types.ts
export type StatusEmpresa = 'PENDENTE' | 'ATIVO' | 'SOMENTE_LEITURA' | 'DESATIVADO';
export type Papel = 'PROPRIETARIO' | 'RECEPCIONISTA' | 'PROFISSIONAL';
export type StatusAtendimento = 'AGENDADO' | 'CONFIRMADO' | 'REALIZADO' | 'CANCELADO';
export type StatusOrcamento = 'RASCUNHO' | 'ENVIADO' | 'APROVADO' | 'RECUSADO' | 'EXPIRADO';
export type FormaPagamento = 'DINHEIRO' | 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'BOLETO' | 'TRANSFERENCIA' | 'OUTRO';
export type Modulo = 'NUCLEO' | 'ORCAMENTOS' | 'FINANCEIRO' | 'MULTI_PROFISSIONAL';

export interface Aparencia {
  corPrimaria: string;
  corSecundaria: string;
  tema: 'claro' | 'escuro';
  logoUrl: string | null;
  faviconUrl: string | null;
}

export interface DefinicaoCampo {
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'numero' | 'data' | 'selecao' | 'booleano';
  obrigatorio: boolean;
  opcoes?: string[];
}
export interface CamposPersonalizados {
  rotulos?: { cliente?: string; servico?: string; atendimento?: string };
  cliente?: DefinicaoCampo[];
  atendimento?: DefinicaoCampo[];
}

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  profissionalId: string | null;
}
export interface EmpresaSessao {
  id: string;
  nome: string;
  nomeFantasia: string | null;
  segmento: string;
  status: StatusEmpresa;
  aparencia: Aparencia;
  camposPersonalizados: CamposPersonalizados;
  fusoHorario: string;
  valorMensalCentavos: number;
  modulos: Modulo[];
}
export interface Sessao {
  usuario: Usuario;
  empresa: EmpresaSessao;
  permissoes: string[];
}

export interface Cliente {
  id: string;
  nome: string;
  telefone: string | null;
  whatsapp: string | null;
  email: string | null;
  documento: string | null;
  dataNascimento: string | null; // AAAA-MM-DD
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  status: 'ATIVO' | 'INATIVO';
  camposExtras: Record<string, unknown>;
  criadoEm: string;
  atualizadoEm: string;
}
export interface ClienteResumo {
  cliente: { id: string; nome: string; status: string };
  totalGastoCentavos: number;
  atendimentosRealizados: number;
  atendimentosCancelados: number;
  ticketMedioCentavos: number;
  ultimoAtendimento: string | null;
  diasDesdeUltimo: number | null;
  frequenciaMediaDias: number | null;
  situacaoRetorno: 'EM_DIA' | 'PROVAVEL_RETORNO' | 'ATRASADO' | null;
  proximoAtendimento: { id: string; inicio: string; status: StatusAtendimento } | null;
}

export interface Servico {
  id: string;
  nome: string;
  descricao: string | null;
  categoria: string | null;
  valorCentavos: number;
  duracaoMinutos: number;
  status: 'ATIVO' | 'INATIVO';
}

export type Expediente = Partial<Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', { inicio: string; fim: string }[]>>;
export interface Profissional {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cor: string | null;
  comissaoBps: number;
  horarioTrabalho: Expediente;
  status: 'ATIVO' | 'INATIVO';
  usuarioId: string | null;
  servicos: { id: string; nome: string }[];
}

export interface ItemAtendimento {
  id: string;
  servicoId: string;
  descricao: string;
  quantidade: number;
  valorUnitarioCentavos: number;
  totalCentavos: number;
  duracaoMinutos: number;
  comissaoCentavos: number;
}
export interface Atendimento {
  id: string;
  inicio: string;
  fim: string;
  status: StatusAtendimento;
  encaixe: boolean;
  observacoes: string | null;
  subtotalCentavos: number;
  descontoCentavos: number;
  acrescimoCentavos: number;
  totalCentavos: number;
  comissaoTotalCentavos: number;
  formaPagamento: FormaPagamento | null;
  camposExtras: Record<string, unknown>;
  confirmadoEm: string | null;
  realizadoEm: string | null;
  canceladoEm: string | null;
  motivoCancelamento: string | null;
  orcamentoId: string | null;
  cliente: { id: string; nome: string; telefone: string | null; whatsapp: string | null };
  profissional: { id: string; nome: string; cor: string | null } | null;
  itens: ItemAtendimento[];
}
export interface NovoAtendimento {
  clienteId: string;
  profissionalId?: string | null;
  inicio: string;
  fim?: string;
  itens: { servicoId: string; quantidade?: number; valorUnitarioCentavos?: number }[];
  descontoCentavos?: number;
  acrescimoCentavos?: number;
  observacoes?: string | null;
  encaixe?: boolean;
  status?: 'AGENDADO' | 'CONFIRMADO' | 'REALIZADO';
  formaPagamento?: FormaPagamento | null;
  camposExtras?: Record<string, unknown>;
}

export interface Orcamento {
  id: string;
  numero: number;
  data: string;
  validade: string | null;
  observacoes: string | null;
  subtotalCentavos: number;
  descontoCentavos: number;
  acrescimoCentavos: number;
  totalCentavos: number;
  status: StatusOrcamento;
  enviadoEm: string | null;
  aprovadoEm: string | null;
  recusadoEm: string | null;
  cliente: { id: string; nome: string; email: string | null; telefone: string | null; whatsapp: string | null; documento: string | null };
  itens: { id: string; servicoId: string | null; descricao: string; quantidade: number; valorUnitarioCentavos: number; totalCentavos: number }[];
  atendimento: { id: string; inicio: string; status: StatusAtendimento } | null;
}

export interface Despesa {
  id: string;
  descricao: string;
  valorCentavos: number;
  data: string;
  formaPagamento: FormaPagamento | null;
  observacao: string | null;
  status: 'PENDENTE' | 'PAGA';
  categoria: { id: string; nome: string; cor: string | null };
}

export interface ApiErro {
  success: false;
  message: string;
  code: string;
  errors?: { field: string; message: string }[];
  requestId?: string;
}
```

---

## 16. Ordem de construção

Cada etapa entrega algo usável e testável contra a API.

| #   | Etapa                                                                                 | Pronto quando                                                |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Projeto, `http.ts` com refresh, `SessionProvider`, layouts, tema                      | Login → `/auth/me` → menu filtrado e cores da empresa        |
| 2   | Planos, Cadastro, Checkout (PaymentWidget), Pendente                                  | Cadastro de ponta a ponta com Pix em sandbox ativa a empresa |
| 3   | Serviços e Clientes (lista, form, campos extras, resumo)                              | CRUD completo com máscaras e erros nos campos                |
| 4   | Atendimentos + Agenda (criar, remarcar arrastando, status, conflito, horários livres) | Fluxo do dia a dia de um salão funcionando                   |
| 5   | Dashboard                                                                             | Números batem com os atendimentos realizados                 |
| 6   | Orçamentos (+ PDF e conversão)                                                        | Orçamento → PDF → aprovar → agenda                           |
| 7   | Despesas + Financeiro                                                                 | Resultado do mês correto                                     |
| 8   | Profissionais + Equipe + comissões                                                    | Login de profissional vê só a própria agenda                 |
| 9   | Configurações (dados, aparência, campos)                                              | Trocar a cor muda o app inteiro                              |
| 10  | Painel admin (2FA, empresas, status, módulos, catálogo, auditoria)                    | Somente leitura e desativar funcionando                      |
| 11  | Polimento: estados vazios, skeletons, responsivo/mobile, acessibilidade               | Checklist da seção 17                                        |

**Para testar cada papel:** crie no seu ambiente uma empresa com todos os módulos, um usuário RECEPCIONISTA e um PROFISSIONAL vinculado, e navegue com os três.

---

## 17. Deploy e checklist final

### Deploy (Vercel ou Netlify)

- `VITE_API_URL=https://api.seudominio.com`
- SPA: configure o rewrite de todas as rotas para `index.html` (`vercel.json`: `{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }`).
- Na API: `CORS_ORIGINS=https://app.seudominio.com` e `APP_URL=https://app.seudominio.com`.
- **Cookies entre domínios:** em produção o cookie do refresh é `SameSite=None; Secure`, então **front e API precisam estar em HTTPS**. Se o navegador bloquear cookies de terceiros (Safari), coloque front e API no **mesmo domínio-raiz** (`app.seudominio.com` e `api.seudominio.com`) e defina `COOKIE_DOMAIN=.seudominio.com` na API.

### Checklist

- [ ] Access token só em memória; sessão restaurada via `/auth/refresh` ao abrir
- [ ] Refresh serializado entre abas (Web Locks) e deduplicado na aba
- [ ] Todo valor enviado em centavos inteiros; nenhum float
- [ ] Datas exibidas no `empresa.fusoHorario`
- [ ] Botões de escrita escondidos sem permissão **e** em `SOMENTE_LEITURA`
- [ ] Menu e rotas respeitam `permissoes`; upsell para módulos não contratados
- [ ] `PENDENTE` sempre leva ao checkout; `DESATIVADO` mostra a tela de suporte
- [ ] Erros de validação aparecem no campo certo (`errors[].field`)
- [ ] Modal de conflito de agenda com "horários livres" e "encaixe"
- [ ] PDF com polling 202 → 200
- [ ] Rótulos do segmento ("Tutor", "Paciente") em todo lugar
- [ ] Máscaras (telefone, CPF/CNPJ, CEP, dinheiro) e envio só de dígitos
- [ ] Estados de carregamento, vazio e erro em todas as listas
- [ ] Responsivo: a agenda vira lista no celular (`listDay` do FullCalendar)
- [ ] `requestId` exibido em erro 500
- [ ] Painel admin com sessão separada e 2FA
