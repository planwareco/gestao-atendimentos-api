-- Desfaz o "Controle de cartão" (feature removida).
-- Mantém a coluna clientes.informacao_adicional criada na migration anterior.
ALTER TABLE "despesas" DROP CONSTRAINT IF EXISTS "despesas_cartao_id_fkey";
ALTER TABLE "despesas" DROP CONSTRAINT IF EXISTS "despesas_parcelas_chk";
DROP INDEX IF EXISTS "despesas_cartao_id_idx";
ALTER TABLE "despesas" DROP COLUMN IF EXISTS "cartao_id";
ALTER TABLE "despesas" DROP COLUMN IF EXISTS "parcelas";
DROP TABLE IF EXISTS "cartoes";
