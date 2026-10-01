# Gestão de Atendimentos — API

Backend **SaaS multi-tenant** para prestadores de serviço: salões, barbearias, estética, pet shops, fisioterapia, consultorias e afins.
O mesmo sistema atende qualquer segmento. O núcleo é sempre **Cliente → Serviço → Atendimento → Financeiro**, e cada segmento acrescenta só os campos que precisa.

Construído sobre a arquitetura do **[Sotov](https://www.npmjs.com/package/sotov)** (Factory + Injeção de Dependência, camadas Repository/Service/Controller), usando **Prisma + PostgreSQL** no lugar do Sequelize.

```
Agenda → Atendimento → Cliente → Histórico → Retorno → Financeiro
Orçamento → Aprovação → Agendamento → Atendimento
```

---

## Sumário

1. [O que o sistema faz](#1-o-que-o-sistema-faz)
2. [Stack](#2-stack)
3. [Rodando localmente](#3-rodando-localmente)
4. [Arquitetura](#4-arquitetura)
5. [Modelo SaaS: cadastro, pagamento e ativação](#5-modelo-saas-cadastro-pagamento-e-ativação)
6. [Integração com o front (PaymentWidget)](#6-integração-com-o-front-paymentwidget)
7. [Multi-tenant, permissões e segurança](#7-multi-tenant-permissões-e-segurança)
8. [Regras de negócio](#8-regras-de-negócio)
9. [Área do super admin](#9-área-do-super-admin)
10. [Convenções da API](#10-convenções-da-api)
11. [Endpoints](#11-endpoints)
12. [Filas e rotinas agendadas](#12-filas-e-rotinas-agendadas)
13. [Testes](#13-testes)
14. [Deploy (Neon + Render)](#14-deploy-neon--render)
15. [Variáveis de ambiente](#15-variáveis-de-ambiente)
16. [Boas práticas aplicadas](#16-boas-práticas-aplicadas)
17. [Roadmap](#17-roadmap)

---

## 1. O que o sistema faz

| Módulo                  | O que entrega                                                                                                                                                                                                                                       | Plano       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **Núcleo**              | Clientes (com resumo comercial), serviços, atendimentos com vários serviços, agenda com conflito e horários livres, histórico, dashboard, aniversariantes, clientes para reativação, configurações (cores/logo), campos personalizados por segmento | obrigatório |
| **Orçamentos**          | Orçamento com itens, numeração sequencial, status, **PDF com a identidade visual da empresa**, conversão em atendimento                                                                                                                             | opcional    |
| **Financeiro**          | Despesas com categorias configuráveis, resultado do período (receita − despesas − comissões), receita por forma de pagamento                                                                                                                        | opcional    |
| **Multi-profissional**  | Equipe com usuários e papéis, agenda e expediente por profissional, comissões                                                                                                                                                                       | opcional    |
| **Admin da plataforma** | Gestão das empresas (ativar, somente leitura, desativar), módulos/permissões, preços, auditoria                                                                                                                                                     | só você     |

**Plano único "Start":** o cliente escolhe os módulos no cadastro. O preço é `preço base + soma dos módulos`, e os módulos escolhidos viram as permissões da empresa.

**Cobrança:** este backend cuida só do **pagamento da adesão** (via [payment-system-mp](https://payments.emanuelecode.tech)). A mensalidade é cobrada por outro sistema. Quando ela atrasa, você coloca a empresa em **somente leitura** ou **desativa** pelo admin.

---

## 2. Stack

| Camada    | Escolha                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------- |
| Runtime   | Node.js 20.10+ (testado no 22), JavaScript ESM                                                        |
| HTTP      | Express 4 + arquitetura Sotov (`AbstractRepository`, `AbstractService`, `GatewayController`, DI)      |
| Banco     | PostgreSQL (Neon) + **Prisma 6** em modo _Rust-free_ (`engineType = "client"` + `@prisma/adapter-pg`) |
| Validação | Joi (gera também o OpenAPI)                                                                           |
| Auth      | JWT curto + refresh token opaco rotativo (cookie httpOnly), Argon2id, TOTP para o admin               |
| Filas     | BullMQ + Redis (worker separado)                                                                      |
| PDF       | Puppeteer (HTML → PDF) no worker                                                                      |
| E-mail    | Brevo (API HTTP)                                                                                      |
| Logs      | Pino (JSON estruturado) com request id                                                                |
| Testes    | Jest + Supertest contra Postgres real                                                                 |
| Deploy    | Render (API + worker + Key Value) + Neon                                                              |

> **Por que Prisma 6 e não 7?** O Prisma 7 gera o client em TypeScript (`prisma-client`). Como o projeto é JavaScript, o Prisma 6.19 com `engineType = "client"` dá o mesmo benefício: sem binário Rust em runtime, deploy menor e pool de conexões explícito. A migração futura para o 7 é simples, porque o projeto já usa driver adapter.

---

## 3. Rodando localmente

### Pré-requisitos

- Node.js 20.10+
- PostgreSQL 14+ (local ou Neon)
- Redis: **opcional em dev**. Sem `REDIS_URL`, as filas rodam no próprio processo e cache/rate-limit ficam em memória.

### Passo a passo

```bash
# 1. dependências (o postinstall roda `prisma generate`)
npm install

# 2. ambiente
cp .env.example .env
# gere os segredos:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_ACCESS_SECRET, JWT_ADMIN_SECRET, CHECKOUT_TOKEN_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"         # ENCRYPTION_KEY

# 3. banco
npm run db:deploy        # aplica as migrations
npm run db:seed          # plano Start + módulos (idempotente)

# 4. seu usuário de super admin
npm run admin:create -- --email voce@dominio.com --nome "Jefferson"

# 5. subir
npm run dev              # API em http://localhost:3000 — docs em /docs
npm run dev:worker       # worker de filas (só se tiver REDIS_URL)
```

- Documentação interativa: **http://localhost:3000/docs**
- OpenAPI (JSON): **http://localhost:3000/docs/openapi.json** (importa direto no Insomnia/Postman)

### Scripts

| Script                                        | Faz                                                 |
| --------------------------------------------- | --------------------------------------------------- |
| `npm run dev` / `dev:worker`                  | API / worker com reload                             |
| `npm start` / `start:worker`                  | produção                                            |
| `npm run db:migrate`                          | cria migration nova em dev (`prisma migrate dev`)   |
| `npm run db:deploy`                           | aplica migrations (produção/CI)                     |
| `npm run db:seed`                             | catálogo comercial                                  |
| `npm run admin:create`                        | cria/reativa super admin (senha pedida no terminal) |
| `npm test` / `test:unit` / `test:integration` | testes                                              |
| `npm run lint` / `format`                     | ESLint / Prettier                                   |

---

## 4. Arquitetura

### Camadas (padrão Sotov)

```
Rota (defineRoutes)  →  Guard (auth + tenant + RBAC)  →  Validação (Joi)  →  GatewayController
                                                                                  │
                                                                                  ▼
                                                    Service (regra de negócio, transações)
                                                                                  │
                                                                                  ▼
                                                    Repository (Prisma, sempre filtrado por empresa)
```

- **Controller não tem regra de negócio.** O `GatewayController` só adapta o caso de uso ao HTTP e padroniza a resposta.
- **Service** concentra a regra, as transações e as validações de domínio. Lança `ApiError`.
- **Repository** é o único lugar que monta queries. O `AbstractRepository` **exige `empresaId`** em toda operação e o injeta no `where`/`data`.
- **Injeção de dependência:** `src/container.js` é o _composition root_. Todo service recebe suas dependências por construtor. A API, o worker e os testes montam o mesmo grafo de objetos. Nos testes, o gateway de pagamento, o e-mail e o PDF são trocados por dublês sem nenhum mock global.

### Diferenças em relação ao Sotov original

| Sotov                                       | Este projeto                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `new AbstractRepository(Model)` (Sequelize) | `new AbstractRepository(prisma, 'cliente', { defaultSelect })`                                  |
| Repositório genérico                        | Repositório **multi-tenant**: `findById(empresaId, id)`, `paginate(empresaId, …)`, `withTx(tx)` |
| Rotas manuais + Swagger via JSDoc           | `defineRoutes()` declarativo: a mesma definição monta a rota **e** o OpenAPI                    |
| Um service por caso de uso                  | Um service por módulo, com métodos por caso de uso (menos arquivos, mesma separação)            |
| `node-cache`                                | Cache-aside com Redis (fallback em memória), single-flight e invalidação por versão             |
| Winston                                     | Pino (JSON) com request id e redação de dados sensíveis                                         |

### Estrutura de pastas

```
prisma/
  schema.prisma            # modelo de dados (comentado)
  migrations/              # SQL versionado (inclui CHECK constraints)
  seed.js                  # plano Start + módulos
scripts/create-admin.js
src/
  server.js                # entrada da API + graceful shutdown
  worker.js                # entrada do worker (BullMQ) + rotinas agendadas
  app.js                   # Express: middlewares na ordem certa + rotas
  container.js             # DI: cria e injeta tudo
  config/                  # env (validado com Joi), prisma, redis
  core/                    # ApiError, AbstractRepository, AbstractService, GatewayController, defineRoutes
  middlewares/             # guards (auth/tenant/RBAC), validate, idempotency, rateLimit, errorHandler
  security/                # permissões, tokens JWT, refresh tokens, argon2, AES-GCM
  integrations/            # PaymentGatewayClient (payment-system-mp), EmailClient (Brevo)
  queue/                   # filas, processadores, templates de e-mail
  pdf/                     # PdfRenderer (Puppeteer) + template do orçamento
  docs/openapi.js          # gera o OpenAPI a partir das rotas
  utils/                   # cache, datas/fuso, dinheiro, resiliência, logger, validação
  modules/
    <modulo>/
      <Modulo>Service.js   # regra de negócio (+ Repository no mesmo arquivo quando é pequeno)
      <modulo>.routes.js   # contrato HTTP (schemas Joi + permissões)
tests/
  unit/                    # regras puras (sem banco)
  integration/             # API + Postgres real
  helpers/                 # app de teste, dublês, preparação do banco
```

### Como adicionar um módulo novo

1. **Model:** adicione no `schema.prisma` (com `empresaId` + índice começando por ele) e rode `npm run db:migrate -- --name nome`.
2. **Repository:** `class XRepository extends AbstractRepository { constructor(prisma) { super(prisma, 'x', { defaultSelect }) } }`.
3. **Service:** `class XService extends AbstractService`. Receba `ctx` (empresa, usuário, permissões) em todo método.
4. **Rotas:** `defineRoutes({ prefix: '/v1/x', tag, guard, routes: [{ method, path, permission, validate, handler }] })`.
5. **Permissão:** declare em `src/security/permissions.js` (a qual módulo pertence e quais papéis têm).
6. **Registro:** instancie no `container.js` e monte a rota no `app.js`.
7. **Testes:** regra pura em `tests/unit`, fluxo em `tests/integration`.

---

## 5. Modelo SaaS: cadastro, pagamento e ativação

```
  Cliente escolhe módulos ──► POST /v1/public/cadastro
                               │  cria Empresa (PENDENTE) + proprietário + módulos (preço congelado)
                               │  devolve sessão + checkoutToken
                               ▼
  Front abre o PaymentWidget com apiBaseUrl = /v1/checkout/{checkoutToken}
                               │
                               ▼
  POST /v1/checkout/{t}/payments ──► payment-system-mp ──► Mercado Pago
     (valor calculado NO SERVIDOR)
                               │
          ┌────────────────────┴────────────────────┐
          ▼                                         ▼
  Widget faz polling                       Job a cada 5 min
  GET /payments/{id}?syncWithMp=true       (reconcilia pendentes 72h)
          └────────────────────┬────────────────────┘
                               ▼
                 status APPROVED → Empresa ATIVO (idempotente)
                 + auditoria + e-mail de boas-vindas
```

**Pontos importantes**

- Enquanto a empresa está `PENDENTE`, toda rota responde **402 `ASSINATURA_PENDENTE`**, exceto `/auth/me`, `/auth/logout` e `/auth/checkout-link`. O front usa isso para mandar o usuário ao checkout.
- O **valor nunca vem do front.** `amount`, `description` e `externalReference` enviados pelo widget são descartados. O servidor usa `empresa.valorMensalCentavos`.
- O `externalReference` enviado ao payment-system-mp é `adesao:{empresaId}:{sufixo}`.
- **Por que polling + job?** O payment-system-mp recebe o webhook do Mercado Pago mas não notifica os SaaS clientes. O polling do widget dá a confirmação instantânea, e o job cobre quem fechou a aba.
- A ativação usa `UPDATE … WHERE status <> 'APPROVED'` e `WHERE status = 'PENDENTE'` dentro de uma transação. Polling e job simultâneos nunca ativam duas vezes.
- O link de checkout é um JWT de **72h**. Expirou? O proprietário faz login e chama `POST /v1/auth/checkout-link`.
- Pagou por fora (Pix direto, por exemplo)? No admin, `PATCH /v1/admin/empresas/{id}/status` com `ATIVO` ativa manualmente, e a ação fica auditada.

### Configurando o payment-system-mp

1. No painel do payment-system-mp, cadastre este SaaS como **Client**.
2. Gere um **Token de API** com os escopos `payments:write` e `payments:read` e coloque em `PAYMENTS_API_TOKEN`.
3. Coloque a public key do Mercado Pago em `PAYMENTS_PUBLIC_KEY`.
4. `PAYMENTS_API_URL=https://payments.emanuelecode.tech`.

---

## 6. Integração com o front (PaymentWidget)

O contrato que o [`payment-widget-react`](https://github.com/jefferson-da-silva-santos/payment-widget-react) espera já está implementado em `/v1/checkout/{token}`:

```
GET  {apiBaseUrl}/config                 -> { publicKey }
POST {apiBaseUrl}/payments               -> cria pagamento (aceita Idempotency-Key)
GET  {apiBaseUrl}/payments/:id           -> consulta (?syncWithMp=true)
POST {apiBaseUrl}/payments/:id/cancel
POST {apiBaseUrl}/payments/:id/refund    -> 403 (estorno só pelo admin)
GET  {apiBaseUrl}/payments/:id/receipt   -> PDF do comprovante (repasse do payment-system-mp)
```

> O comprovante é repassado para `GET /payments/:id/receipt` do payment-system-mp. Essa rota não aparece na documentação atual do serviço; se ela não existir lá, o endpoint devolve 404 até ser criada.

O token vai **na URL**, então o widget não precisa de header de autenticação.

```jsx
import { PaymentWidget } from '@payment-system-mp/react-widget';

function Checkout({ checkoutToken }) {
  const [resumo, setResumo] = useState(null);
  const apiBaseUrl = `${import.meta.env.VITE_API_URL}/v1/checkout/${checkoutToken}`;

  useEffect(() => {
    fetch(`${apiBaseUrl}/resumo`)
      .then((r) => r.json())
      .then((r) => setResumo(r.data));
  }, [apiBaseUrl]);

  if (!resumo) return null;
  if (resumo.pago) return <Navigate to="/" />;

  return (
    <PaymentWidget
      apiBaseUrl={apiBaseUrl}
      publicKey={resumo.publicKey}
      amount={resumo.valor} // só exibição — o servidor define o valor real
      description={resumo.descricao}
      methods={resumo.metodos} // ['PIX', 'CREDIT_CARD', 'BOLETO']
      theme="light"
      onPaymentApproved={() => window.location.assign('/')}
    />
  );
}
```

### Sessão no front (web)

```js
// login: o refresh token vem em cookie httpOnly — use credentials: 'include'
const r = await fetch(`${API}/v1/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, senha }),
});
const { data } = await r.json(); // { accessToken, usuario, empresa, permissoes }

// chamadas autenticadas: Authorization: Bearer <accessToken>
// ao receber 401 TOKEN_EXPIRADO: POST /v1/auth/refresh (credentials: 'include') e repita a chamada
```

- `GET /v1/auth/me` devolve `empresa.aparencia` (cores e logo para as variáveis CSS), `empresa.camposPersonalizados` (rótulos e campos do segmento), `empresa.modulos` e `permissoes`. É tudo que o front precisa para montar o menu e o tema.
- **App mobile (Expo):** envie o header `X-Client: mobile` no login/refresh e o refresh token volta no corpo, em vez de cookie.

---

## 7. Multi-tenant, permissões e segurança

### Isolamento entre empresas

- **Coluna `empresa_id`** em todas as tabelas de domínio, com índices compostos começando por ela.
- O `empresaId` vem **sempre do token**, nunca do corpo da requisição.
- O `AbstractRepository` lança erro de programação se alguém chamar sem `empresaId`.
- Recurso de outra empresa responde **404**, sem revelar que existe. Isso é coberto por testes.

### Status da empresa

| Status            | Login  | Leitura | Escrita                          | Quem define                      |
| ----------------- | ------ | ------- | -------------------------------- | -------------------------------- |
| `PENDENTE`        | ✅     | ❌ 402  | ❌ 402                           | cadastro                         |
| `ATIVO`           | ✅     | ✅      | ✅                               | pagamento aprovado / admin       |
| `SOMENTE_LEITURA` | ✅     | ✅      | ❌ 403 `EMPRESA_SOMENTE_LEITURA` | admin                            |
| `DESATIVADO`      | ❌ 403 | ❌      | ❌                               | admin (encerra todas as sessões) |

Os dados **nunca são apagados**. Reativar devolve tudo como estava.

### Permissão efetiva = papel ∩ módulos contratados

| Permissão                                      | Módulo             | Proprietário | Recepcionista |   Profissional    |
| ---------------------------------------------- | ------------------ | :----------: | :-----------: | :---------------: |
| `dashboard:ver`                                | Núcleo             |      ✅      |               |                   |
| `clientes:ler` / `clientes:escrever`           | Núcleo             |   ✅ / ✅    |    ✅ / ✅    |       ✅ /        |
| `servicos:ler` / `servicos:escrever`           | Núcleo             |   ✅ / ✅    |     ✅ /      |       ✅ /        |
| `atendimentos:ler` / `atendimentos:escrever`   | Núcleo             |   ✅ / ✅    |    ✅ / ✅    |      ✅ / ✅      |
| `atendimentos:todos` (ver os de todos)         | Núcleo             |      ✅      |      ✅       | ❌ só os próprios |
| `agenda:ler`                                   | Núcleo             |      ✅      |      ✅       | ✅ (só a própria) |
| `configuracoes:gerenciar`                      | Núcleo             |      ✅      |               |                   |
| `orcamentos:ler` / `orcamentos:escrever`       | Orçamentos         |   ✅ / ✅    |    ✅ / ✅    |                   |
| `despesas:*`, `financeiro:ver`                 | Financeiro         |      ✅      |               |                   |
| `profissionais:ler` / `profissionais:escrever` | Multi-profissional |   ✅ / ✅    |     ✅ /      |                   |
| `comissoes:ver`, `usuarios:gerenciar`          | Multi-profissional |      ✅      |               |                   |

- Sem o módulo: **403 `MODULO_NAO_CONTRATADO`**. Com o módulo, mas sem o papel: **403 `PERMISSAO_NEGADA`**. O front pode mostrar "contrate o módulo" no primeiro caso.
- O admin liga e desliga módulos e o efeito é imediato (o cache de contexto é invalidado).

### Autenticação

- **Usuários:** access token JWT de 15 min + refresh token opaco de 30 dias em cookie `httpOnly`, `Secure` e `SameSite=None` (produção).
  - A cada refresh, o token antigo é revogado e um novo é emitido (**rotação**).
  - **Reuso de um refresh já usado derruba a sessão inteira** (detecção de roubo de token).
  - No banco fica só o SHA-256 do refresh token.
- **Senhas:** Argon2id. O login com e-mail inexistente gasta o mesmo tempo (anti-enumeração) e sempre responde a mesma mensagem.
- **Super admin:** segredo JWT separado, refresh separado e **2FA TOTP obrigatório**. O segredo TOTP é guardado cifrado com AES-256-GCM.
- **Três audiências de JWT** (`usuario`, `admin`, `checkout`) com segredos distintos: um token nunca serve em outro contexto.

### Proteções HTTP

Helmet, CORS com lista explícita, limite de corpo de 200 KB, compressão e `trust proxy` correto para o Render. Rate limit:

| Limite                  | Valor              |
| ----------------------- | ------------------ |
| Global por IP           | 1000 req / 15 min  |
| Por usuário autenticado | 300 req / min      |
| Login por IP            | 30 falhas / 15 min |
| Login por IP + e-mail   | 5 falhas / 15 min  |
| Cadastro por IP         | 10 / hora          |
| Checkout por IP         | 30 / 15 min        |

Com Redis, os limites são compartilhados entre instâncias.

---

## 8. Regras de negócio

### Faturamento: só `REALIZADO` conta

Atendimentos `AGENDADO`, `CONFIRMADO` e `CANCELADO` **nunca** entram em receita, ticket médio, comissão ou "total gasto" do cliente.
A regra fica num único lugar (`IndicadoresRepository` + `regras.js`). Dashboard, financeiro e histórico não reimplementam nada.

### Status do atendimento

```
AGENDADO ──► CONFIRMADO ──► REALIZADO (final)
   │  ▲           │
   │  └───────────┤
   └──────────────┴──────► CANCELADO (final)
```

- Só `AGENDADO`/`CONFIRMADO` podem ser editados ou remarcados.
- Ao marcar `REALIZADO`, a forma de pagamento é registrada e as **comissões são calculadas e congeladas** por item.
- Mudanças de status usam trava otimista. Se duas pessoas alteram ao mesmo tempo, a segunda recebe 409.
- É possível lançar um atendimento já `REALIZADO` (cliente sem agendamento).

### Agenda

- A agenda **não tem tabela própria**: é uma visão dos atendimentos.
- O `fim` é calculado pela soma das durações dos serviços (ou informado).
- **Conflito de horário → 409 `AGENDA_CONFLITO`**, por profissional (ou da empresa toda, se ela não usa profissionais). Cancelados liberam o horário. `encaixe: true` permite sobrepor de propósito.
- **Concorrência:** criar e remarcar usam `pg_advisory_xact_lock` por empresa + profissional. Seis pedidos simultâneos para o mesmo horário resultam em exatamente um aceito (há teste para isso).
- `GET /v1/agenda/horarios-livres` cruza o expediente do profissional (`horarioTrabalho`) com os atendimentos marcados.
- Tudo é guardado em UTC, e os cálculos de dia, mês e expediente usam o **fuso da empresa** (`America/Sao_Paulo` por padrão).

### Dinheiro

- Sempre em **centavos (inteiros)**: `valorCentavos: 8000` = R$ 80,00. Nada de float.
- Comissão em _basis points_: `comissaoBps: 4000` = 40%. O desconto do atendimento é rateado entre os itens antes de calcular a comissão.
- Desconto maior que o subtotal → 422.

### Orçamentos

- Numeração **sequencial por empresa**, sem buracos nem repetição, mesmo com criação simultânea (incremento atômico na linha da empresa).
- Itens podem vir de um serviço (puxa nome e preço) ou ser avulsos (descrição + valor).
- Status: `RASCUNHO → ENVIADO → APROVADO | RECUSADO`. `ENVIADO` com validade vencida vira `EXPIRADO` (job diário).
- **Converter em atendimento:** só `APROVADO`, uma única vez (constraint `UNIQUE`). Itens avulsos precisam ser vinculados a um serviço antes.
- **PDF:** `GET /v1/orcamentos/{id}/pdf` → `202` (gerando na fila, `Retry-After: 2`) → `200` com o PDF. O arquivo fica guardado e só é refeito quando o orçamento ou a identidade visual mudam (versão por hash).

### Clientes

- Campo livre **`informacaoAdicional`** (até 500 caracteres), exibido logo após o nome e incluído na busca.
- Resumo comercial: total gasto, ticket médio, frequência média, dias desde o último atendimento, situação de retorno (`EM_DIA`, `PROVAVEL_RETORNO`, `ATRASADO`) e próximo agendamento.
- `GET /v1/clientes/inativos?dias=60` (reativação) e `GET /v1/clientes/aniversariantes?dias=7`.
- Cliente com histórico **não é excluído** (409): inative com `status: INATIVO`. Soft delete só onde há motivo real.

### Segmentos e campos personalizados

Cada segmento traz rótulos e campos próprios, guardados em JSONB (`empresa.camposPersonalizados`) e validados dinamicamente:

| Segmento     | Exemplo                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| Pet shop     | cliente = **Tutor**; atendimento tem `petNome`_, `especie`_, `raca`, `porte` |
| Fisioterapia | cliente = **Paciente**; `convenio`, `queixaPrincipal`; sessão com `evolucao` |
| Estética     | `tipoPele`, `alergias`                                                       |
| Consultoria  | atendimento = **Reunião**; `pauta`                                           |

O proprietário pode editar os campos em `PUT /v1/configuracoes`. Tipos aceitos: `texto`, `numero`, `data`, `selecao` e `booleano`. Chaves não definidas são descartadas.

---

## 9. Área do super admin

```bash
npm run admin:create -- --email voce@dominio.com --nome "Jefferson"
```

1. `POST /v1/admin/auth/login` → no primeiro acesso devolve `mfaConfiguracaoObrigatoria: true` e só libera as rotas de 2FA.
2. `POST /v1/admin/auth/2fa/configurar` → `otpauthUrl` (gere o QR Code no front) + segredo.
3. `POST /v1/admin/auth/2fa/ativar` `{ "codigo": "123456" }`.
4. Dali em diante o login é em duas etapas: `/login` → `{ mfaToken }` → `/2fa/verificar` `{ mfaToken, codigo }`.

**O que o admin faz**

- `GET /v1/admin/metricas`: empresas por status, receita mensal contratada e cadastros dos últimos 30 dias.
- `GET /v1/admin/empresas?status=&busca=` e `GET /v1/admin/empresas/{id}` (módulos, usuários, pagamentos).
- `PATCH /v1/admin/empresas/{id}/status` `{ "status": "SOMENTE_LEITURA", "motivo": "Mensalidade de outubro em aberto" }`.
- `PUT /v1/admin/empresas/{id}/modulos` `{ "modulos": ["ORCAMENTOS"], "recalcularValor": true }`.
- `PATCH /v1/admin/empresas/{id}/usuarios/{usuarioId}` `{ "ativo": false }`.
- `PUT /v1/admin/catalogo/plano` e `PATCH /v1/admin/catalogo/modulos/{codigo}`: preços valem **só para novos cadastros**, porque quem já contratou tem o preço congelado.
- `GET /v1/admin/auditoria`: login de admin, falhas de 2FA, mudança de status e módulos, ativações, criação de usuários...

---

## 10. Convenções da API

**Envelope** (o mesmo do payment-system-mp):

```json
{ "success": true, "message": null, "data": {}, "meta": null, "timestamp": "2026-10-01T12:00:00.000Z" }
```

```json
{
  "success": false,
  "message": "Dados inválidos.",
  "code": "VALIDACAO",
  "errors": [{ "field": "body.email", "message": "email must be a valid email" }],
  "requestId": "a1b2…",
  "timestamp": "…"
}
```

| Tema             | Convenção                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Versão           | Prefixo `/v1`                                                                                                        |
| Dinheiro         | `*Centavos` inteiros                                                                                                 |
| Datas            | Instantes em ISO-8601 UTC (`2026-10-05T13:00:00Z`); datas puras `AAAA-MM-DD`                                         |
| Paginação        | `?page=1&perPage=20` (máx. 100) → `meta: { total, page, perPage, totalPages }`                                       |
| Campos opcionais | Ausente = não altera; `null` = limpa                                                                                 |
| Request ID       | Envie `X-Request-Id` ou receba um; ele volta no header e no corpo do erro                                            |
| Idempotência     | `Idempotency-Key` em `POST /checkout/*/payments`; repetição devolve a mesma resposta com `Idempotent-Replayed: true` |

**Códigos de erro mais usados**

| HTTP    | `code`                                                                            | Quando                                               |
| ------- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 401     | `TOKEN_AUSENTE`, `TOKEN_EXPIRADO`, `SESSAO_INVALIDA`, `CREDENCIAIS_INVALIDAS`     | autenticação                                         |
| 401     | `REFRESH_INVALIDO`, `REFRESH_REUTILIZADO`                                         | refresh                                              |
| 402     | `ASSINATURA_PENDENTE`                                                             | adesão não paga                                      |
| 403     | `EMPRESA_SOMENTE_LEITURA`, `EMPRESA_DESATIVADA`                                   | status da empresa                                    |
| 403     | `MODULO_NAO_CONTRATADO`, `PERMISSAO_NEGADA`                                       | autorização                                          |
| 403     | `MFA_CONFIGURACAO_OBRIGATORIA`                                                    | admin sem 2FA                                        |
| 404     | `*_NAO_ENCONTRADO`, `ROTA_NAO_ENCONTRADA`                                         | —                                                    |
| 409     | `AGENDA_CONFLITO`, `CONFLITO_CONCORRENCIA`, `REGISTRO_DUPLICADO`, `EMAIL_EM_USO`  | conflitos                                            |
| 409     | `ASSINATURA_JA_ATIVA`, `ORCAMENTO_JA_CONVERTIDO`, `CLIENTE_COM_HISTORICO`         | estado                                               |
| 422     | `VALIDACAO`, `TRANSICAO_INVALIDA`, `DESCONTO_INVALIDO`, `CAMPOS_EXTRAS_INVALIDOS` | regra de negócio                                     |
| 429     | `RATE_LIMITED`                                                                    | excesso de requisições                               |
| 502–504 | `PAGAMENTOS_*`                                                                    | payment-system-mp indisponível (com circuit breaker) |

---

## 11. Endpoints

> Lista completa, com schemas de entrada, em **`/docs`**. Ela é gerada das próprias rotas e nunca fica desatualizada.

#### Público (cadastro)

| Método | Rota                     | Descrição                                                                         | Acesso  |
| ------ | ------------------------ | --------------------------------------------------------------------------------- | ------- |
| GET    | `/v1/public/plano`       | Plano Start: preço base e módulos opcionais com preço                             | pública |
| GET    | `/v1/public/segmentos`   | Segmentos de negócio disponíveis                                                  | pública |
| POST   | `/v1/public/plano/preco` | Simula o preço mensal para os módulos escolhidos                                  | pública |
| POST   | `/v1/public/cadastro`    | Cria a empresa (PENDENTE) + proprietário e devolve a sessão e o link de pagamento | pública |

#### Checkout (PaymentWidget)

| Método | Rota                                         | Descrição                                                      | Acesso        |
| ------ | -------------------------------------------- | -------------------------------------------------------------- | ------------- |
| GET    | `/v1/checkout/{token}/resumo`                | Valor calculado no servidor, módulos e public key              | token do link |
| GET    | `/v1/checkout/{token}/config`                | `{ publicKey }`                                                | token do link |
| POST   | `/v1/checkout/{token}/payments`              | Cria o pagamento da adesão (Idempotency-Key)                   | token do link |
| GET    | `/v1/checkout/{token}/payments/{id}`         | Consulta (`?syncWithMp=true`); ativa a empresa quando APPROVED | token do link |
| POST   | `/v1/checkout/{token}/payments/{id}/cancel`  | Cancela pagamento pendente                                     | token do link |
| POST   | `/v1/checkout/{token}/payments/{id}/refund`  | 403: estorno só pelo admin                                     | token do link |
| GET    | `/v1/checkout/{token}/payments/{id}/receipt` | Comprovante PDF (aprovados)                                    | token do link |

#### Auth

| Método | Rota                     | Descrição                                             | Acesso                      |
| ------ | ------------------------ | ----------------------------------------------------- | --------------------------- |
| POST   | `/v1/auth/login`         | Login; refresh token em cookie httpOnly               | pública                     |
| POST   | `/v1/auth/refresh`       | Renova o access token (rotação)                       | cookie                      |
| POST   | `/v1/auth/logout`        | Encerra a sessão                                      | cookie                      |
| GET    | `/v1/auth/me`            | Usuário, empresa (tema, campos), módulos e permissões | logado (inclusive PENDENTE) |
| PUT    | `/v1/auth/senha`         | Altera a própria senha (encerra as outras sessões)    | logado                      |
| POST   | `/v1/auth/checkout-link` | Novo link de pagamento (empresa PENDENTE)             | proprietário                |

#### Clientes · Serviços · Profissionais · Usuários

| Método             | Rota                                  | Descrição                                                     | Permissão                            |
| ------------------ | ------------------------------------- | ------------------------------------------------------------- | ------------------------------------ |
| GET / POST         | `/v1/clientes`                        | Lista (busca, status) / cadastra                              | `clientes:ler` / `clientes:escrever` |
| GET / PUT / DELETE | `/v1/clientes/{id}`                   | Detalha / atualiza / exclui (sem histórico)                   | `clientes:*`                         |
| GET                | `/v1/clientes/{id}/resumo`            | Total gasto, ticket, frequência, retorno, próximo atendimento | `clientes:ler`                       |
| GET                | `/v1/clientes/{id}/historico`         | Histórico de atendimentos                                     | `clientes:ler`                       |
| GET                | `/v1/clientes/aniversariantes?dias=7` | Aniversariantes                                               | `clientes:ler`                       |
| GET                | `/v1/clientes/inativos?dias=60`       | Clientes para reativação                                      | `clientes:ler`                       |
| GET / POST         | `/v1/servicos`                        | Lista / cadastra (valor em centavos, duração em minutos)      | `servicos:*`                         |
| GET                | `/v1/servicos/categorias`             | Categorias em uso                                             | `servicos:ler`                       |
| GET / PUT / DELETE | `/v1/servicos/{id}`                   | Detalha / atualiza / exclui (nunca usado)                     | `servicos:*`                         |
| GET / POST         | `/v1/profissionais`                   | Lista / cadastra (comissão, expediente, serviços)             | `profissionais:*`                    |
| GET / PUT / DELETE | `/v1/profissionais/{id}`              | Detalha / atualiza / exclui                                   | `profissionais:*`                    |
| GET / POST         | `/v1/usuarios`                        | Equipe: lista / cria (vincula a profissional)                 | `usuarios:gerenciar`                 |
| GET / PATCH        | `/v1/usuarios/{id}`                   | Detalha / papel, ativo, redefinir senha                       | `usuarios:gerenciar`                 |

#### Atendimentos · Agenda

| Método     | Rota                                           | Descrição                                                            | Permissão               |
| ---------- | ---------------------------------------------- | -------------------------------------------------------------------- | ----------------------- |
| GET / POST | `/v1/atendimentos`                             | Lista (período, status, cliente, profissional) / cria com N serviços | `atendimentos:*`        |
| GET / PUT  | `/v1/atendimentos/{id}`                        | Detalha / edita e remarca                                            | `atendimentos:*`        |
| PATCH      | `/v1/atendimentos/{id}/status`                 | Confirmar, realizar (forma de pagamento) ou cancelar (motivo)        | `atendimentos:escrever` |
| GET        | `/v1/agenda?inicio=&fim=&profissionalId=`      | Visões dia/semana/mês (máx. 62 dias)                                 | `agenda:ler`            |
| GET        | `/v1/agenda/horarios-livres?data=&servicoIds=` | Sugere horários livres                                               | `agenda:ler`            |

#### Orçamentos

| Método             | Rota                            | Descrição                                            | Permissão             |
| ------------------ | ------------------------------- | ---------------------------------------------------- | --------------------- |
| GET / POST         | `/v1/orcamentos`                | Lista / cria (número automático)                     | `orcamentos:*`        |
| GET / PUT / DELETE | `/v1/orcamentos/{id}`           | Detalha / edita (RASCUNHO/ENVIADO) / exclui rascunho | `orcamentos:*`        |
| PATCH              | `/v1/orcamentos/{id}/status`    | Enviar, aprovar, recusar                             | `orcamentos:escrever` |
| POST               | `/v1/orcamentos/{id}/converter` | Aprovado → atendimento na agenda                     | `orcamentos:escrever` |
| GET                | `/v1/orcamentos/{id}/pdf`       | 202 gerando / 200 PDF                                | `orcamentos:ler`      |

#### Despesas · Financeiro · Dashboard · Configurações

| Método             | Rota                                    | Descrição                                                     | Permissão                 |
| ------------------ | --------------------------------------- | ------------------------------------------------------------- | ------------------------- |
| GET / POST         | `/v1/despesas`                          | Lista (período, categoria; `meta.totalValorCentavos`) / lança | `despesas:*`              |
| GET / PUT / DELETE | `/v1/despesas/{id}`                     | Detalha / atualiza / exclui                                   | `despesas:*`              |
| GET / POST         | `/v1/despesas/categorias`               | Categorias (12 padrão criadas no cadastro)                    | `despesas:*`              |
| PUT / DELETE       | `/v1/despesas/categorias/{id}`          | Atualiza / exclui (sem despesas)                              | `despesas:escrever`       |
| GET                | `/v1/financeiro/resultado?inicio=&fim=` | Bruto − despesas − comissões = resultado                      | `financeiro:ver`          |
| GET                | `/v1/financeiro/comissoes?inicio=&fim=` | Comissões por profissional                                    | `comissoes:ver`           |
| GET                | `/v1/dashboard?ano=&mes=`               | Indicadores do mês + gráficos do ano                          | `dashboard:ver`           |
| GET / PUT          | `/v1/configuracoes`                     | Dados, aparência, segmento, campos personalizados             | `configuracoes:gerenciar` |

#### Admin

| Método            | Rota                                                                    | Descrição                              |
| ----------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| POST              | `/v1/admin/auth/login` · `/2fa/verificar` · `/refresh` · `/logout`      | Sessão do admin                        |
| GET / POST        | `/v1/admin/auth/me` · `/2fa/configurar` · `/2fa/ativar`                 | Perfil e 2FA                           |
| GET               | `/v1/admin/metricas`                                                    | Visão geral                            |
| GET               | `/v1/admin/empresas` · `/v1/admin/empresas/{id}`                        | Empresas                               |
| PATCH             | `/v1/admin/empresas/{id}/status`                                        | ATIVO / SOMENTE_LEITURA / DESATIVADO   |
| PUT               | `/v1/admin/empresas/{id}/modulos`                                       | Módulos (permissões)                   |
| PATCH             | `/v1/admin/empresas/{id}/usuarios/{usuarioId}`                          | Ativar/desativar usuário, trocar papel |
| GET / PUT / PATCH | `/v1/admin/catalogo` · `/catalogo/plano` · `/catalogo/modulos/{codigo}` | Preços                                 |
| GET               | `/v1/admin/auditoria`                                                   | Log de auditoria                       |

#### Health

| Rota                                  | Uso                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `GET /health/live`                    | Liveness (processo de pé)                                                |
| `GET /health/ready` (alias `/health`) | Readiness: banco, Redis, modo da fila e estatísticas de cache (hit/miss) |

---

## 12. Filas e rotinas agendadas

| Fila         | Job                                                        | Quando                         |
| ------------ | ---------------------------------------------------------- | ------------------------------ |
| `emails`     | `enviar-email` (cadastro recebido, boas-vindas)            | sob demanda                    |
| `documentos` | `gerar-pdf-orcamento`                                      | sob demanda (dedup por versão) |
| `manutencao` | `reconciliar-pagamentos`                                   | a cada 5 min                   |
| `manutencao` | `expirar-orcamentos`                                       | todo dia 03:10 (São Paulo)     |
| `manutencao` | `limpar-expirados` (idempotência e refresh tokens antigos) | todo dia 04:30                 |

- 5 tentativas com **backoff exponencial**. Jobs que esgotam as tentativas ficam no conjunto `failed` por 14 dias (funciona como DLQ, para inspeção e reprocessamento).
- O worker é um processo separado (`npm run start:worker`). O Puppeteer roda **só** no worker, nunca na API.
- Sem Redis (dev/test), os jobs rodam inline e de forma assíncrona no processo da API.

---

## 13. Testes

```bash
# banco de teste SEPARADO (precisa ter "test" no nome — é zerado a cada execução)
createdb atend_test
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/atend_test npm test
```

**79 testes** (41 unitários + 38 de integração contra Postgres real), em cerca de 10 s:

- **Unitários:** cálculos de valores e comissões, máquina de estados, horários livres, permissões × módulos, status da empresa, fuso horário, circuit breaker/retry, cache single-flight, criptografia e campos por segmento.
- **Integração (fluxos críticos):**
  - onboarding completo; valor do pagamento definido pelo servidor; idempotência; ativação idempotente; reconciliação
  - **isolamento entre empresas** (ler/alterar/excluir dado de outra empresa → 404)
  - RBAC e ABAC do profissional; módulos não contratados; desativação de usuário
  - **concorrência:** 6 agendamentos simultâneos no mesmo horário → 1 aceito; 5 orçamentos simultâneos → números 1 a 5
  - faturamento só com REALIZADO (dashboard, financeiro e resumo do cliente)
  - refresh rotativo + detecção de reuso; **rate limit** de login; 2FA do admin; somente leitura/desativar
- Integrações externas (payment-system-mp, Brevo, Puppeteer) são substituídas por **dublês injetados via DI**.

---

## 14. Deploy (Neon + Render)

### Banco (Neon)

1. Crie o projeto no Neon.
2. `DATABASE_URL` = string **pooled** (host com `-pooler`) para a aplicação.
3. `DIRECT_URL` = string **direta** para as migrations.

### Render (Blueprint)

O `render.yaml` sobe:

- **Web Service** (API) — Docker, `healthCheckPath: /health/ready`, `preDeployCommand: npx prisma migrate deploy`
- **Background Worker** — mesma imagem, `node src/worker.js`, com Chromium para os PDFs
- **Key Value** (Redis) com `maxmemory-policy noeviction` (exigência do BullMQ)

Passos:

1. Render → **New → Blueprint** → aponte para o repositório.
2. Preencha as variáveis marcadas como `sync: false` (Neon, URLs, payment-system-mp, Brevo, `ENCRYPTION_KEY`).
3. Depois do primeiro deploy, rode **uma vez** no Shell do serviço: `npm run db:seed` e `npm run admin:create -- --email … --nome …`.

> **Custos:** Background Worker e `preDeployCommand` exigem plano pago no Render. Para economizar no começo, use Redis gratuito do Upstash (`rediss://…` em `REDIS_URL`) e rode as migrations no build ou manualmente.

### Docker

```bash
docker build --target api -t gestao-api .
docker build --target worker -t gestao-worker .
```

### Migrations em produção

- Sempre `prisma migrate deploy` (nunca `migrate dev` nem alteração manual no banco).
- **Mudanças destrutivas em duas etapas** (expand/contract): primeiro adicione a coluna nova e faça o deploy do código que escreve nas duas; depois migre os dados; por último remova a antiga em outra release.
- Antes de migrations grandes, crie um _branch_ do Neon para testar e ter um ponto de restauração.

### Rotação de segredos

- `JWT_ACCESS_SECRET`/`JWT_ADMIN_SECRET`: trocar invalida os access tokens (máx. 15 min). Os refresh tokens continuam válidos porque ficam no banco.
- `CHECKOUT_TOKEN_SECRET`: invalida links de pagamento abertos (o usuário gera outro pelo login).
- `ENCRYPTION_KEY`: exige que os admins **reconfigurem o 2FA**.

---

## 15. Variáveis de ambiente

Todas são validadas no boot. Se faltar algo obrigatório, a aplicação nem sobe. Veja `.env.example` comentado.

| Variável                                         | Obrig. | Padrão                  | Descrição                                                             |
| ------------------------------------------------ | :----: | ----------------------- | --------------------------------------------------------------------- |
| `NODE_ENV`                                       |        | `development`           | `development` / `test` / `production`                                 |
| `PORT`                                           |        | `3000`                  | Porta HTTP                                                            |
| `APP_URL`                                        |        | `http://localhost:5173` | URL do front (links de e-mail e checkout)                             |
| `API_URL`                                        |        | `http://localhost:3000` | URL pública da API (monta o `apiBaseUrl` do widget)                   |
| `DATABASE_URL`                                   |   ✅   |                         | Postgres (pooled no Neon)                                             |
| `DIRECT_URL`                                     |   ✅   |                         | Postgres direto (migrations)                                          |
| `DATABASE_POOL_MAX`                              |        | `10`                    | Máximo de conexões do pool por instância                              |
| `DATABASE_STATEMENT_TIMEOUT_MS`                  |        | `15000`                 | Timeout de query                                                      |
| `REDIS_URL`                                      |  prod  |                         | Redis (filas, cache, rate limit)                                      |
| `CORS_ORIGINS`                                   |        | `http://localhost:5173` | Origens permitidas, separadas por vírgula                             |
| `JWT_ACCESS_SECRET`                              |   ✅   |                         | ≥ 32 caracteres                                                       |
| `JWT_ADMIN_SECRET`                               |   ✅   |                         | ≥ 32 caracteres, diferente do anterior                                |
| `CHECKOUT_TOKEN_SECRET`                          |   ✅   |                         | ≥ 32 caracteres                                                       |
| `ENCRYPTION_KEY`                                 |   ✅   |                         | 64 hex (AES-256)                                                      |
| `JWT_ACCESS_TTL` / `REFRESH_TOKEN_TTL_DAYS`      |        | `15m` / `30`            | Sessão dos usuários                                                   |
| `JWT_ADMIN_TTL` / `ADMIN_REFRESH_TOKEN_TTL_DAYS` |        | `15m` / `7`             | Sessão do admin                                                       |
| `ADMIN_REQUIRE_2FA`                              |        | `true`                  | Exige 2FA do admin                                                    |
| `CHECKOUT_TOKEN_TTL`                             |        | `72h`                   | Validade do link de pagamento                                         |
| `COOKIE_DOMAIN`                                  |        |                         | Domínio do cookie (vazio se front e API estão em domínios diferentes) |
| `PAYMENTS_API_URL`                               |   ✅   |                         | `https://payments.emanuelecode.tech`                                  |
| `PAYMENTS_API_TOKEN`                             |   ✅   |                         | Token de API do payment-system-mp                                     |
| `PAYMENTS_PUBLIC_KEY`                            |   ✅   |                         | Public key do Mercado Pago                                            |
| `PAYMENTS_TIMEOUT_MS`                            |        | `10000`                 | Timeout das chamadas                                                  |
| `BREVO_API_KEY`                                  |        |                         | Sem ela, e-mails só vão para o log                                    |
| `EMAIL_FROM` / `EMAIL_FROM_NAME`                 |        |                         | Remetente                                                             |
| `PUPPETEER_EXECUTABLE_PATH`                      |        |                         | Chrome/Chromium do worker (a imagem Docker já define)                 |
| `TRUST_PROXY`                                    |        | `1`                     | Proxies na frente (Render = 1)                                        |
| `LOG_LEVEL`                                      |        | `info`                  | Nível do log                                                          |
| `TEST_DATABASE_URL`                              | testes |                         | Banco zerado pelos testes                                             |

---

## 16. Boas práticas aplicadas

✅ aplicado · 🟡 parcial / com ressalva · ⏳ planejado

**API e contratos**

- ✅ Paginação com limite máximo (100) garantido no servidor
- ✅ Rate limiting por IP, por usuário e por rota sensível (Redis compartilhado)
- ✅ Validação e sanitização com Joi (`stripUnknown`, `trim`, conversão de tipos)
- ✅ Tratamento centralizado de erros + envelope padronizado + status HTTP corretos (402, 409, 422…)
- ✅ Versionamento (`/v1`), OpenAPI gerado das próprias rotas, DTOs de entrada (Joi) e de saída (`select` explícito)
- ✅ Compressão HTTP, CORS explícito, Helmet
- 🟡 Paginação por cursor: offset + filtros obrigatórios de período nas listas grandes (agenda, dashboard). Cursor fica para quando o volume pedir.

**Segurança**

- ✅ Nunca confiar no cliente: `empresaId` vem do token; o valor do pagamento é calculado no servidor; campos desconhecidos são descartados
- ✅ JWT com expiração, refresh token rotativo com detecção de reuso, Argon2id
- ✅ RBAC (papéis) + ABAC (profissional só vê o que é dele) + controle por módulo contratado
- ✅ Sem dados sensíveis nas respostas (`senhaHash` nunca selecionado) nem nos logs (redação automática)
- ✅ Segredos só em variáveis de ambiente, validados no boot; 2FA do admin; segredos em repouso cifrados (AES-256-GCM)
- ✅ SQL injection: Prisma + `$queryRaw` com _tagged templates_ (sempre parametrizado)
- 🟡 Rotação de segredos: documentada (seção 14); sem rotação automática

**Banco de dados**

- ✅ Migrations versionadas; CHECK constraints, FKs, UNIQUE e índices (inclusive compostos e em FKs)
- ✅ Sem `SELECT *` (`defaultSelect` por repositório); agregações em SQL; sem N+1 (serviços buscados de uma vez)
- ✅ Transações onde há atomicidade; advisory lock na agenda; trava otimista em mudanças de status; incremento atômico na numeração
- ✅ Isolamento: READ COMMITTED (padrão do Postgres) + locks explícitos onde há corrida. É mais barato que SERIALIZABLE para este caso.
- ✅ Pool de conexões configurável + `statement_timeout`; log de queries lentas (> 500 ms) para análise com `EXPLAIN`
- ✅ Soft delete só com motivo real: cliente, serviço e profissional com histórico são **inativados**, não apagados

**Cache**

- ✅ Redis compartilhado, cache-aside, TTL em toda chave, namespaces (`ga:`), invalidação por versão, proteção contra stampede (single-flight), nada sensível em cache, hit/miss exposto no `/health`

**Assíncrono e resiliência**

- ✅ Filas para e-mail, PDF e reconciliação; nada pesado no request
- ✅ Timeout, retry com backoff exponencial (só em leituras), **circuit breaker** no payment-system-mp
- ✅ Idempotency-Key no pagamento; ativação idempotente; DLQ (jobs falhos retidos); retry limitado nos consumidores
- ✅ Graceful shutdown (API e worker); degradação graciosa (falha de cache não derruba a API)

**Observabilidade**

- ✅ Logs estruturados (JSON), correlation/request ID, health/liveness/readiness, auditoria de operações sensíveis
- ⏳ Sentry (erros), métricas de latência e throughput (Prometheus/OpenTelemetry)

**Código e processo**

- ✅ Separação Controller/Service/Repository, DI, responsabilidade única, configuração centralizada por ambiente
- ✅ ESLint + Prettier, CI no GitHub Actions (lint, formato, testes, migrations do zero)
- ✅ Testes unitários, de integração, de fluxo crítico, de autorização, de rate limit e de concorrência
- 🟡 TypeScript: **decisão** pelo JavaScript (como o Sotov). Os contratos ficam nos schemas Joi e no OpenAPI.

---

## 17. Roadmap

Fica de fora do MVP, mas o modelo já comporta:

- **Página pública de agendamento** (`/agendar/{empresa}`): os horários livres já existem
- **Link público do orçamento** com botão "Aprovar"
- Lembretes de atendimento e mensagens de aniversário/reativação via **WhatsApp**
- Pacotes de serviços, serviço recorrente, estoque de insumos vinculado ao serviço (rentabilidade)
- Upload de logo (hoje é URL HTTPS)
- Paginação por cursor, métricas Prometheus, Sentry
- Migração para Prisma 7 / TypeScript

---

Feito com 💪 e precisão de mira, na base do **Sotov**, por **Jefferson Santos**.
