/**
 * Seed idempotente do catálogo comercial (plano Start + módulos).
 * Pode rodar quantas vezes quiser: só cria o que não existe e NUNCA
 * sobrescreve preços já ajustados pelo admin.
 *
 *   npm run db:seed
 */
import { createPrisma } from '../src/config/prisma.js';

const prisma = createPrisma();

const PLANO = { codigo: 'START', nome: 'Start', precoBaseCentavos: 4990 };

const MODULOS = [
  {
    codigo: 'NUCLEO',
    nome: 'Núcleo',
    descricao: 'Clientes, serviços, atendimentos, agenda, histórico, dashboard e configurações.',
    precoCentavos: 0,
    obrigatorio: true,
    ordem: 0,
  },
  {
    codigo: 'ORCAMENTOS',
    nome: 'Orçamentos',
    descricao: 'Orçamentos com itens, PDF com sua marca e conversão em atendimento.',
    precoCentavos: 1990,
    ordem: 10,
  },
  {
    codigo: 'FINANCEIRO',
    nome: 'Financeiro',
    descricao: 'Despesas por categoria e resultado (receita − despesas − comissões).',
    precoCentavos: 1990,
    ordem: 20,
  },
  {
    codigo: 'MULTI_PROFISSIONAL',
    nome: 'Multi-profissional',
    descricao: 'Equipe com usuários e papéis, agenda por profissional e comissões.',
    precoCentavos: 2990,
    ordem: 30,
  },
];

async function main() {
  await prisma.plano.upsert({ where: { codigo: PLANO.codigo }, create: PLANO, update: {} });
  for (const m of MODULOS) {
    await prisma.modulo.upsert({
      where: { codigo: m.codigo },
      create: m,
      update: { nome: m.nome, descricao: m.descricao, obrigatorio: m.obrigatorio ?? false },
    });
  }
  console.log(`✅ Catálogo pronto: plano ${PLANO.codigo} + ${MODULOS.length} módulos`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
