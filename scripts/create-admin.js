/**
 * Cria (ou reativa) um super admin da plataforma.
 *
 *   npm run admin:create -- --email voce@dominio.com --nome "Jefferson"
 *
 * A senha é pedida no terminal (não fica no histórico do shell).
 * Em CI/automação, use a variável ADMIN_SENHA.
 */
import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import { createPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/security/password.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, nome: { type: 'string' } } });
const email = values.email?.trim().toLowerCase();
const nome = values.nome?.trim() || 'Administrador';

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Uso: npm run admin:create -- --email voce@dominio.com --nome "Seu Nome"');
  process.exit(1);
}

let senha = process.env.ADMIN_SENHA;
if (!senha) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  senha = await rl.question('Senha (mín. 12 caracteres): ');
  rl.close();
}
if (!senha || senha.length < 12) {
  console.error('A senha do admin deve ter pelo menos 12 caracteres.');
  process.exit(1);
}

const prisma = createPrisma();
try {
  const senhaHash = await hashPassword(senha);
  const admin = await prisma.admin.upsert({
    where: { email },
    create: { email, nome, senhaHash },
    update: { nome, senhaHash, ativo: true },
    select: { id: true, email: true },
  });
  console.log(`✅ Admin pronto: ${admin.email}. No primeiro login, configure o 2FA em POST /v1/admin/auth/2fa/configurar.`);
} finally {
  await prisma.$disconnect();
}
