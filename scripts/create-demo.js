/**
 * Cria uma empresa de DEMONSTRAÇÃO já ATIVA (sem pagamento), com todos os módulos,
 * um usuário proprietário e dados de exemplo (serviços, clientes, atendimentos, despesas).
 *
 *   node scripts/create-demo.js --email demo@teste.com --senha Demo1234
 *   node scripts/create-demo.js --email demo@teste.com --senha Demo1234 --segmento PETSHOP --sem-dados
 *
 * Segmentos: SALAO_BELEZA, BARBEARIA, ESTETICA, PETSHOP, FISIOTERAPIA, CONSULTORIA, OUTRO
 * A ativação fica registrada na auditoria como DEMO_CRIADA.
 */
import { parseArgs } from 'node:util';
import { createPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/security/password.js';
import { APARENCIA_PADRAO, CATEGORIAS_DESPESA_PADRAO, SEGMENTOS, presetDoSegmento } from '../src/modules/configuracoes/segmentos.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string', default: 'demo@teste.com' },
    senha: { type: 'string', default: 'Demo1234' },
    nome: { type: 'string', default: 'Usuário Demo' },
    empresa: { type: 'string', default: 'Empresa Demo' },
    segmento: { type: 'string', default: 'SALAO_BELEZA' },
    'sem-dados': { type: 'boolean', default: false },
  },
});

const email = values.email.trim().toLowerCase();
if (!SEGMENTOS[values.segmento]) {
  console.error(`Segmento inválido. Use: ${Object.keys(SEGMENTOS).join(', ')}`);
  process.exit(1);
}
if (values.senha.length < 8 || !/[A-Za-z]/.test(values.senha) || !/\d/.test(values.senha)) {
  console.error('A senha precisa ter 8+ caracteres, com letras e números.');
  process.exit(1);
}

const prisma = createPrisma();

// Serviços de exemplo por segmento: [nome, valor em centavos, duração em minutos]
const SERVICOS = {
  PETSHOP: [
    ['Banho', 6000, 60],
    ['Tosa', 5000, 45],
    ['Banho e tosa', 9500, 90],
    ['Hidratação de pelos', 3500, 30],
  ],
  FISIOTERAPIA: [
    ['Avaliação', 15000, 60],
    ['Sessão de fisioterapia', 12000, 50],
    ['Pilates clínico', 9000, 50],
  ],
  CONSULTORIA: [
    ['Diagnóstico', 50000, 120],
    ['Reunião de acompanhamento', 25000, 60],
  ],
  BARBEARIA: [
    ['Corte', 4500, 30],
    ['Barba', 3500, 30],
    ['Corte + barba', 7000, 60],
  ],
  ESTETICA: [
    ['Limpeza de pele', 15000, 60],
    ['Design de sobrancelha', 5000, 30],
    ['Drenagem linfática', 12000, 60],
  ],
  default: [
    ['Corte feminino', 8000, 60],
    ['Escova', 4000, 45],
    ['Hidratação', 5000, 30],
    ['Manicure', 3500, 45],
  ],
};

const CLIENTES = ['Maria Silva', 'João Souza', 'Ana Oliveira', 'Carlos Lima', 'Fernanda Costa'];

async function main() {
  const existente = await prisma.usuario.findUnique({ where: { email }, select: { id: true } });
  if (existente) {
    console.error(`Já existe um usuário com o e-mail ${email}. Use outro --email.`);
    process.exitCode = 1;
    return;
  }

  const [plano, modulos] = await Promise.all([prisma.plano.findUnique({ where: { codigo: 'START' } }), prisma.modulo.findMany({ where: { ativo: true } })]);
  if (!plano || !modulos.length) {
    console.error('Catálogo vazio. Rode antes: npm run db:seed');
    process.exitCode = 1;
    return;
  }

  const senhaHash = await hashPassword(values.senha);
  const segmento = values.segmento;
  const fuso = 'America/Sao_Paulo';

  const { empresa } = await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.create({
      data: {
        nome: values.empresa,
        email,
        segmento,
        status: 'ATIVO',
        ativadoEm: new Date(),
        motivoStatus: 'Conta de demonstração',
        valorMensalCentavos: plano.precoBaseCentavos + modulos.reduce((a, m) => a + m.precoCentavos, 0),
        aparencia: APARENCIA_PADRAO,
        camposPersonalizados: presetDoSegmento(segmento),
        fusoHorario: fuso,
      },
      select: { id: true, nome: true },
    });
    await tx.empresaModulo.createMany({ data: modulos.map((m) => ({ empresaId: empresa.id, moduloCodigo: m.codigo, precoCentavos: m.precoCentavos })) });
    await tx.categoriaDespesa.createMany({ data: CATEGORIAS_DESPESA_PADRAO.map((nome) => ({ empresaId: empresa.id, nome })) });
    const usuario = await tx.usuario.create({
      data: { empresaId: empresa.id, nome: values.nome, email, senhaHash, papel: 'PROPRIETARIO' },
      select: { id: true },
    });
    await tx.logAuditoria.create({
      data: {
        acao: 'DEMO_CRIADA',
        entidade: 'Empresa',
        entidadeId: empresa.id,
        empresaId: empresa.id,
        usuarioId: usuario.id,
        dados: { origem: 'scripts/create-demo.js' },
      },
    });
    return { empresa };
  });

  if (!values['sem-dados']) await popular(empresa.id, segmento);

  console.log('\n✅ Empresa de demonstração criada e ATIVA');
  console.log(`   Empresa : ${empresa.nome} (${segmento})`);
  console.log(`   Login   : ${email}`);
  console.log(`   Senha   : ${values.senha}`);
  console.log('   Módulos : todos');
  console.log(values['sem-dados'] ? '   Dados   : nenhum' : '   Dados   : serviços, clientes, atendimentos e despesas de exemplo');
  console.log('\n   POST /v1/auth/login  { "email": "...", "senha": "..." }\n');
}

/** Dados de exemplo para o dashboard não ficar vazio. */
async function popular(empresaId, segmento) {
  const lista = SERVICOS[segmento] ?? SERVICOS.default;
  const servicos = [];
  for (const [nome, valorCentavos, duracaoMinutos] of lista) {
    servicos.push(
      await prisma.servico.create({
        data: { empresaId, nome, valorCentavos, duracaoMinutos },
        select: { id: true, nome: true, valorCentavos: true, duracaoMinutos: true },
      }),
    );
  }
  const clientes = [];
  for (const nome of CLIENTES) {
    clientes.push(
      await prisma.cliente.create({
        data: { empresaId, nome, whatsapp: `8199${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}` },
        select: { id: true },
      }),
    );
  }

  const camposPet = segmento === 'PETSHOP' ? { petNome: 'Thor', especie: 'Cachorro' } : {};
  const agora = new Date();
  // 30 dias para trás (realizados) e 7 para frente (agendados), um atendimento por dia às 10h e 14h (horário de Brasília)
  for (let dia = -30; dia <= 7; dia += 1) {
    for (const horaUtc of [13, 17]) {
      if ((dia + horaUtc) % 3 === 0) continue; // deixa alguns buracos na agenda
      const s = servicos[Math.abs(dia + horaUtc) % servicos.length];
      const c = clientes[Math.abs(dia * 7 + horaUtc) % clientes.length];
      const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + dia, horaUtc, 0));
      const fim = new Date(inicio.getTime() + s.duracaoMinutos * 60_000);
      const passado = inicio < agora;
      const cancelado = passado && dia % 9 === 0;
      const status = cancelado ? 'CANCELADO' : passado ? 'REALIZADO' : dia % 2 ? 'CONFIRMADO' : 'AGENDADO';
      await prisma.atendimento.create({
        data: {
          empresaId,
          clienteId: c.id,
          inicio,
          fim,
          status,
          subtotalCentavos: s.valorCentavos,
          totalCentavos: s.valorCentavos,
          formaPagamento: status === 'REALIZADO' ? ['PIX', 'DINHEIRO', 'CARTAO_CREDITO'][Math.abs(dia) % 3] : null,
          realizadoEm: status === 'REALIZADO' ? fim : null,
          canceladoEm: cancelado ? inicio : null,
          motivoCancelamento: cancelado ? 'Cliente desmarcou' : null,
          camposExtras: camposPet,
          itens: {
            create: [
              {
                servicoId: s.id,
                descricao: s.nome,
                quantidade: 1,
                valorUnitarioCentavos: s.valorCentavos,
                totalCentavos: s.valorCentavos,
                duracaoMinutos: s.duracaoMinutos,
              },
            ],
          },
        },
        select: { id: true },
      });
    }
  }

  const categorias = await prisma.categoriaDespesa.findMany({
    where: { empresaId, nome: { in: ['Insumos', 'Aluguel', 'Energia', 'Marketing'] } },
    select: { id: true, nome: true },
  });
  const valores = { Insumos: 18000, Aluguel: 120000, Energia: 25000, Marketing: 15000 };
  const hoje = new Date();
  for (const cat of categorias) {
    for (const mesesAtras of [0, 1]) {
      const data = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mesesAtras, 5));
      await prisma.despesa.create({
        data: { empresaId, categoriaId: cat.id, descricao: cat.nome, valorCentavos: valores[cat.nome], data, status: 'PAGA', formaPagamento: 'PIX' },
      });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
