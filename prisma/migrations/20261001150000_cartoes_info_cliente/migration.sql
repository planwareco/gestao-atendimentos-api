-- Cliente: informação adicional (aparece logo após o nome)
ALTER TABLE "clientes" ADD COLUMN "informacao_adicional" VARCHAR(500);

-- Cartões de crédito da empresa
CREATE TABLE "cartoes" (
    "id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "nome" VARCHAR(60) NOT NULL,
    "bandeira" VARCHAR(30),
    "final_numero" CHAR(4),
    "dia_fechamento" INTEGER NOT NULL,
    "dia_vencimento" INTEGER NOT NULL,
    "limite_centavos" INTEGER,
    "cor" VARCHAR(9),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "cartoes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cartoes_empresa_id_nome_key" ON "cartoes"("empresa_id", "nome");
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_dias_chk" CHECK ("dia_fechamento" BETWEEN 1 AND 31 AND "dia_vencimento" BETWEEN 1 AND 31);
ALTER TABLE "cartoes" ADD CONSTRAINT "cartoes_limite_chk" CHECK ("limite_centavos" IS NULL OR "limite_centavos" >= 0);

-- Despesas: cartão usado + número de parcelas
ALTER TABLE "despesas" ADD COLUMN "cartao_id" UUID;
ALTER TABLE "despesas" ADD COLUMN "parcelas" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "despesas_cartao_id_idx" ON "despesas"("cartao_id");
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_cartao_id_fkey" FOREIGN KEY ("cartao_id") REFERENCES "cartoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_parcelas_chk" CHECK ("parcelas" BETWEEN 1 AND 48);
