/**
 * Prepara o banco de TESTE do zero antes da suíte:
 *   DROP SCHEMA -> aplica todas as migrations (SQL) em ordem -> catálogo base.
 * Usa o driver `pg` direto, sem depender do CLI do Prisma (roda igual no CI).
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import 'dotenv/config';

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/atend_test';
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error(`Por segurança, o banco de testes precisa ter "test" no nome. Recebido: ${url}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = path.resolve('prisma/migrations');
    const migrations = fs
      .readdirSync(dir)
      .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
      .sort();
    for (const m of migrations) {
      await client.query(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
    }
    await client.query(`
      INSERT INTO planos (id, codigo, nome, preco_base_centavos, atualizado_em) VALUES (gen_random_uuid(), 'START', 'Start', 4990, now());
      INSERT INTO modulos (codigo, nome, preco_centavos, obrigatorio, ordem, atualizado_em) VALUES
        ('NUCLEO', 'Núcleo', 0, true, 0, now()),
        ('ORCAMENTOS', 'Orçamentos', 1990, false, 10, now()),
        ('FINANCEIRO', 'Financeiro', 1990, false, 20, now()),
        ('MULTI_PROFISSIONAL', 'Multi-profissional', 2990, false, 30, now());
    `);
  } finally {
    await client.end();
  }
}
