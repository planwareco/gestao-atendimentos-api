-- CreateEnum
CREATE TYPE "StatusEmpresa" AS ENUM ('PENDENTE', 'ATIVO', 'SOMENTE_LEITURA', 'DESATIVADO');

-- CreateEnum
CREATE TYPE "Segmento" AS ENUM ('SALAO_BELEZA', 'BARBEARIA', 'ESTETICA', 'PETSHOP', 'FISIOTERAPIA', 'CONSULTORIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('PROPRIETARIO', 'RECEPCIONISTA', 'PROFISSIONAL');

-- CreateEnum
CREATE TYPE "StatusRegistro" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "StatusAtendimento" AS ENUM ('AGENDADO', 'CONFIRMADO', 'REALIZADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "StatusOrcamento" AS ENUM ('RASCUNHO', 'ENVIADO', 'APROVADO', 'RECUSADO', 'EXPIRADO');

-- CreateEnum
CREATE TYPE "StatusDespesa" AS ENUM ('PENDENTE', 'PAGA');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusPagamento" AS ENUM ('PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK');

-- CreateTable
CREATE TABLE "planos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "preco_base_centavos" INTEGER NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "planos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modulos" (
    "codigo" VARCHAR(40) NOT NULL,
    "nome" VARCHAR(80) NOT NULL,
    "descricao" VARCHAR(300),
    "preco_centavos" INTEGER NOT NULL,
    "obrigatorio" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "modulos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "nome_fantasia" VARCHAR(150),
    "documento" VARCHAR(14),
    "email" VARCHAR(160) NOT NULL,
    "telefone" VARCHAR(20),
    "whatsapp" VARCHAR(20),
    "segmento" "Segmento" NOT NULL DEFAULT 'OUTRO',
    "status" "StatusEmpresa" NOT NULL DEFAULT 'PENDENTE',
    "motivo_status" VARCHAR(300),
    "valor_mensal_centavos" INTEGER NOT NULL,
    "endereco" JSONB,
    "aparencia" JSONB NOT NULL DEFAULT '{}',
    "campos_personalizados" JSONB NOT NULL DEFAULT '{}',
    "fuso_horario" VARCHAR(60) NOT NULL DEFAULT 'America/Sao_Paulo',
    "proximo_numero_orcamento" INTEGER NOT NULL DEFAULT 1,
    "ativado_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_modulos" (
    "empresa_id" UUID NOT NULL,
    "modulo_codigo" VARCHAR(40) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "preco_centavos" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "empresa_modulos_pkey" PRIMARY KEY ("empresa_id","modulo_codigo")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "papel" "PapelUsuario" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "familia" UUID NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogado_em" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "totp_segredo_cifrado" TEXT,
    "totp_ativo" BOOLEAN NOT NULL DEFAULT false,
    "ultimo_login_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_refresh_tokens" (
    "id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "familia" UUID NOT NULL,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogado_em" TIMESTAMPTZ(3),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos_assinatura" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "gateway_payment_id" VARCHAR(64) NOT NULL,
    "mp_payment_id" VARCHAR(64),
    "metodo" VARCHAR(30) NOT NULL,
    "status" "StatusPagamento" NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "aprovado_em" TIMESTAMPTZ(3),
    "ultima_sincronizacao_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pagamentos_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chaves_idempotencia" (
    "id" UUID NOT NULL,
    "escopo" VARCHAR(120) NOT NULL,
    "chave" VARCHAR(120) NOT NULL,
    "hash_requisicao" VARCHAR(64) NOT NULL,
    "status_code" INTEGER,
    "resposta" JSONB,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chaves_idempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" VARCHAR(150) NOT NULL,
    "telefone" VARCHAR(20),
    "whatsapp" VARCHAR(20),
    "email" VARCHAR(160),
    "documento" VARCHAR(14),
    "data_nascimento" DATE,
    "cep" VARCHAR(8),
    "logradouro" VARCHAR(150),
    "numero" VARCHAR(20),
    "complemento" VARCHAR(100),
    "bairro" VARCHAR(100),
    "cidade" VARCHAR(100),
    "estado" CHAR(2),
    "observacoes" VARCHAR(2000),
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "campos_extras" JSONB NOT NULL DEFAULT '{}',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" VARCHAR(120) NOT NULL,
    "descricao" VARCHAR(500),
    "categoria" VARCHAR(80),
    "valor_centavos" INTEGER NOT NULL,
    "duracao_minutos" INTEGER NOT NULL,
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "servicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissionais" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "usuario_id" UUID,
    "nome" VARCHAR(120) NOT NULL,
    "email" VARCHAR(160),
    "telefone" VARCHAR(20),
    "cor" VARCHAR(9),
    "comissao_bps" INTEGER NOT NULL DEFAULT 0,
    "horario_trabalho" JSONB NOT NULL DEFAULT '{}',
    "status" "StatusRegistro" NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissional_servicos" (
    "profissional_id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,

    CONSTRAINT "profissional_servicos_pkey" PRIMARY KEY ("profissional_id","servico_id")
);

-- CreateTable
CREATE TABLE "atendimentos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "profissional_id" UUID,
    "orcamento_id" UUID,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fim" TIMESTAMPTZ(3) NOT NULL,
    "status" "StatusAtendimento" NOT NULL DEFAULT 'AGENDADO',
    "encaixe" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" VARCHAR(2000),
    "subtotal_centavos" INTEGER NOT NULL,
    "desconto_centavos" INTEGER NOT NULL DEFAULT 0,
    "acrescimo_centavos" INTEGER NOT NULL DEFAULT 0,
    "total_centavos" INTEGER NOT NULL,
    "comissao_total_centavos" INTEGER NOT NULL DEFAULT 0,
    "forma_pagamento" "FormaPagamento",
    "campos_extras" JSONB NOT NULL DEFAULT '{}',
    "confirmado_em" TIMESTAMPTZ(3),
    "realizado_em" TIMESTAMPTZ(3),
    "cancelado_em" TIMESTAMPTZ(3),
    "motivo_cancelamento" VARCHAR(300),
    "criado_por_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "atendimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atendimento_itens" (
    "id" UUID NOT NULL,
    "atendimento_id" UUID NOT NULL,
    "servico_id" UUID NOT NULL,
    "descricao" VARCHAR(150) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "valor_unitario_centavos" INTEGER NOT NULL,
    "total_centavos" INTEGER NOT NULL,
    "duracao_minutos" INTEGER NOT NULL,
    "comissao_centavos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "atendimento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamentos" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "cliente_id" UUID NOT NULL,
    "data" DATE NOT NULL,
    "validade" DATE,
    "observacoes" VARCHAR(2000),
    "subtotal_centavos" INTEGER NOT NULL,
    "desconto_centavos" INTEGER NOT NULL DEFAULT 0,
    "acrescimo_centavos" INTEGER NOT NULL DEFAULT 0,
    "total_centavos" INTEGER NOT NULL,
    "status" "StatusOrcamento" NOT NULL DEFAULT 'RASCUNHO',
    "enviado_em" TIMESTAMPTZ(3),
    "aprovado_em" TIMESTAMPTZ(3),
    "recusado_em" TIMESTAMPTZ(3),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_itens" (
    "id" UUID NOT NULL,
    "orcamento_id" UUID NOT NULL,
    "servico_id" UUID,
    "descricao" VARCHAR(150) NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 1,
    "valor_unitario_centavos" INTEGER NOT NULL,
    "total_centavos" INTEGER NOT NULL,

    CONSTRAINT "orcamento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orcamento_pdfs" (
    "orcamento_id" UUID NOT NULL,
    "versao" VARCHAR(64) NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "gerado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orcamento_pdfs_pkey" PRIMARY KEY ("orcamento_id")
);

-- CreateTable
CREATE TABLE "categorias_despesa" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "cor" VARCHAR(9),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_despesa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "despesas" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "descricao" VARCHAR(150) NOT NULL,
    "valor_centavos" INTEGER NOT NULL,
    "data" DATE NOT NULL,
    "forma_pagamento" "FormaPagamento",
    "observacao" VARCHAR(1000),
    "status" "StatusDespesa" NOT NULL DEFAULT 'PAGA',
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "despesas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs_auditoria" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "admin_id" UUID,
    "usuario_id" UUID,
    "acao" VARCHAR(80) NOT NULL,
    "entidade" VARCHAR(60) NOT NULL,
    "entidade_id" VARCHAR(64),
    "dados" JSONB,
    "ip" VARCHAR(64),
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planos_codigo_key" ON "planos"("codigo");

-- CreateIndex
CREATE INDEX "empresas_status_idx" ON "empresas"("status");

-- CreateIndex
CREATE INDEX "empresas_criado_em_idx" ON "empresas"("criado_em");

-- CreateIndex
CREATE INDEX "empresa_modulos_modulo_codigo_idx" ON "empresa_modulos"("modulo_codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_empresa_id_papel_idx" ON "usuarios"("empresa_id", "papel");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_usuario_id_idx" ON "refresh_tokens"("usuario_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_familia_idx" ON "refresh_tokens"("familia");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_refresh_tokens_token_hash_key" ON "admin_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "admin_refresh_tokens_admin_id_idx" ON "admin_refresh_tokens"("admin_id");

-- CreateIndex
CREATE INDEX "admin_refresh_tokens_familia_idx" ON "admin_refresh_tokens"("familia");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_assinatura_gateway_payment_id_key" ON "pagamentos_assinatura"("gateway_payment_id");

-- CreateIndex
CREATE INDEX "pagamentos_assinatura_empresa_id_idx" ON "pagamentos_assinatura"("empresa_id");

-- CreateIndex
CREATE INDEX "pagamentos_assinatura_status_criado_em_idx" ON "pagamentos_assinatura"("status", "criado_em");

-- CreateIndex
CREATE INDEX "chaves_idempotencia_expira_em_idx" ON "chaves_idempotencia"("expira_em");

-- CreateIndex
CREATE UNIQUE INDEX "chaves_idempotencia_escopo_chave_key" ON "chaves_idempotencia"("escopo", "chave");

-- CreateIndex
CREATE INDEX "clientes_empresa_id_nome_idx" ON "clientes"("empresa_id", "nome");

-- CreateIndex
CREATE INDEX "clientes_empresa_id_status_idx" ON "clientes"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_empresa_id_documento_key" ON "clientes"("empresa_id", "documento");

-- CreateIndex
CREATE INDEX "servicos_empresa_id_status_idx" ON "servicos"("empresa_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "servicos_empresa_id_nome_key" ON "servicos"("empresa_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "profissionais_usuario_id_key" ON "profissionais"("usuario_id");

-- CreateIndex
CREATE INDEX "profissionais_empresa_id_status_idx" ON "profissionais"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "profissional_servicos_servico_id_idx" ON "profissional_servicos"("servico_id");

-- CreateIndex
CREATE UNIQUE INDEX "atendimentos_orcamento_id_key" ON "atendimentos"("orcamento_id");

-- CreateIndex
CREATE INDEX "atendimentos_empresa_id_inicio_idx" ON "atendimentos"("empresa_id", "inicio");

-- CreateIndex
CREATE INDEX "atendimentos_empresa_id_status_inicio_idx" ON "atendimentos"("empresa_id", "status", "inicio");

-- CreateIndex
CREATE INDEX "atendimentos_empresa_id_profissional_id_inicio_idx" ON "atendimentos"("empresa_id", "profissional_id", "inicio");

-- CreateIndex
CREATE INDEX "atendimentos_empresa_id_cliente_id_inicio_idx" ON "atendimentos"("empresa_id", "cliente_id", "inicio");

-- CreateIndex
CREATE INDEX "atendimento_itens_atendimento_id_idx" ON "atendimento_itens"("atendimento_id");

-- CreateIndex
CREATE INDEX "atendimento_itens_servico_id_idx" ON "atendimento_itens"("servico_id");

-- CreateIndex
CREATE INDEX "orcamentos_empresa_id_status_idx" ON "orcamentos"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "orcamentos_empresa_id_cliente_id_idx" ON "orcamentos"("empresa_id", "cliente_id");

-- CreateIndex
CREATE INDEX "orcamentos_status_validade_idx" ON "orcamentos"("status", "validade");

-- CreateIndex
CREATE UNIQUE INDEX "orcamentos_empresa_id_numero_key" ON "orcamentos"("empresa_id", "numero");

-- CreateIndex
CREATE INDEX "orcamento_itens_orcamento_id_idx" ON "orcamento_itens"("orcamento_id");

-- CreateIndex
CREATE INDEX "orcamento_itens_servico_id_idx" ON "orcamento_itens"("servico_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_despesa_empresa_id_nome_key" ON "categorias_despesa"("empresa_id", "nome");

-- CreateIndex
CREATE INDEX "despesas_empresa_id_data_idx" ON "despesas"("empresa_id", "data");

-- CreateIndex
CREATE INDEX "despesas_empresa_id_categoria_id_idx" ON "despesas"("empresa_id", "categoria_id");

-- CreateIndex
CREATE INDEX "logs_auditoria_empresa_id_criado_em_idx" ON "logs_auditoria"("empresa_id", "criado_em");

-- CreateIndex
CREATE INDEX "logs_auditoria_admin_id_criado_em_idx" ON "logs_auditoria"("admin_id", "criado_em");

-- CreateIndex
CREATE INDEX "logs_auditoria_acao_criado_em_idx" ON "logs_auditoria"("acao", "criado_em");

-- AddForeignKey
ALTER TABLE "empresa_modulos" ADD CONSTRAINT "empresa_modulos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empresa_modulos" ADD CONSTRAINT "empresa_modulos_modulo_codigo_fkey" FOREIGN KEY ("modulo_codigo") REFERENCES "modulos"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_refresh_tokens" ADD CONSTRAINT "admin_refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_assinatura" ADD CONSTRAINT "pagamentos_assinatura_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional_servicos" ADD CONSTRAINT "profissional_servicos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional_servicos" ADD CONSTRAINT "profissional_servicos_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimentos" ADD CONSTRAINT "atendimentos_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimento_itens" ADD CONSTRAINT "atendimento_itens_atendimento_id_fkey" FOREIGN KEY ("atendimento_id") REFERENCES "atendimentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atendimento_itens" ADD CONSTRAINT "atendimento_itens_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamentos" ADD CONSTRAINT "orcamentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_servico_id_fkey" FOREIGN KEY ("servico_id") REFERENCES "servicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orcamento_pdfs" ADD CONSTRAINT "orcamento_pdfs_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_despesa" ADD CONSTRAINT "categorias_despesa_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_despesa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Constraints de integridade no banco (além da validação da aplicação)
-- =============================================================================
ALTER TABLE "planos"            ADD CONSTRAINT "planos_preco_chk"            CHECK ("preco_base_centavos" >= 0);
ALTER TABLE "modulos"           ADD CONSTRAINT "modulos_preco_chk"           CHECK ("preco_centavos" >= 0);
ALTER TABLE "empresas"          ADD CONSTRAINT "empresas_valor_chk"          CHECK ("valor_mensal_centavos" >= 0);
ALTER TABLE "empresas"          ADD CONSTRAINT "empresas_num_orc_chk"        CHECK ("proximo_numero_orcamento" >= 1);
ALTER TABLE "servicos"          ADD CONSTRAINT "servicos_valor_chk"          CHECK ("valor_centavos" >= 0);
ALTER TABLE "servicos"          ADD CONSTRAINT "servicos_duracao_chk"        CHECK ("duracao_minutos" > 0 AND "duracao_minutos" <= 1440);
ALTER TABLE "profissionais"     ADD CONSTRAINT "profissionais_comissao_chk"  CHECK ("comissao_bps" BETWEEN 0 AND 10000);
ALTER TABLE "atendimentos"      ADD CONSTRAINT "atendimentos_periodo_chk"    CHECK ("fim" > "inicio");
ALTER TABLE "atendimentos"      ADD CONSTRAINT "atendimentos_valores_chk"    CHECK ("subtotal_centavos" >= 0 AND "desconto_centavos" >= 0 AND "acrescimo_centavos" >= 0 AND "total_centavos" >= 0 AND "comissao_total_centavos" >= 0);
ALTER TABLE "atendimento_itens" ADD CONSTRAINT "atendimento_itens_chk"       CHECK ("quantidade" > 0 AND "valor_unitario_centavos" >= 0 AND "total_centavos" >= 0 AND "comissao_centavos" >= 0);
ALTER TABLE "orcamentos"        ADD CONSTRAINT "orcamentos_valores_chk"      CHECK ("subtotal_centavos" >= 0 AND "desconto_centavos" >= 0 AND "acrescimo_centavos" >= 0 AND "total_centavos" >= 0);
ALTER TABLE "orcamento_itens"   ADD CONSTRAINT "orcamento_itens_chk"         CHECK ("quantidade" > 0 AND "valor_unitario_centavos" >= 0 AND "total_centavos" >= 0);
ALTER TABLE "despesas"          ADD CONSTRAINT "despesas_valor_chk"          CHECK ("valor_centavos" > 0);
ALTER TABLE "pagamentos_assinatura" ADD CONSTRAINT "pagamentos_valor_chk"    CHECK ("valor_centavos" > 0);
