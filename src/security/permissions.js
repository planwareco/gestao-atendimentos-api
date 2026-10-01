/**
 * RBAC + módulos contratados.
 *
 * Uma permissão só vale se:
 *   1) o PAPEL do usuário a concede, E
 *   2) o MÓDULO ao qual ela pertence está ativo para a empresa (plano Start customizado).
 *
 * O admin da plataforma liga/desliga módulos por empresa; isso muda as
 * permissões efetivas de todos os usuários daquela empresa imediatamente.
 */

export const MODULOS = Object.freeze({
  NUCLEO: 'NUCLEO',
  ORCAMENTOS: 'ORCAMENTOS',
  FINANCEIRO: 'FINANCEIRO',
  MULTI_PROFISSIONAL: 'MULTI_PROFISSIONAL',
});

/** permissão -> módulo necessário */
export const PERMISSOES = Object.freeze({
  'dashboard:ver': MODULOS.NUCLEO,
  'clientes:ler': MODULOS.NUCLEO,
  'clientes:escrever': MODULOS.NUCLEO,
  'servicos:ler': MODULOS.NUCLEO,
  'servicos:escrever': MODULOS.NUCLEO,
  'atendimentos:ler': MODULOS.NUCLEO,
  'atendimentos:escrever': MODULOS.NUCLEO,
  // ABAC: sem esta permissão o usuário só enxerga/edita os PRÓPRIOS atendimentos
  'atendimentos:todos': MODULOS.NUCLEO,
  'agenda:ler': MODULOS.NUCLEO,
  'configuracoes:gerenciar': MODULOS.NUCLEO,

  'orcamentos:ler': MODULOS.ORCAMENTOS,
  'orcamentos:escrever': MODULOS.ORCAMENTOS,

  'despesas:ler': MODULOS.FINANCEIRO,
  'despesas:escrever': MODULOS.FINANCEIRO,
  'financeiro:ver': MODULOS.FINANCEIRO,

  'profissionais:ler': MODULOS.MULTI_PROFISSIONAL,
  'profissionais:escrever': MODULOS.MULTI_PROFISSIONAL,
  'comissoes:ver': MODULOS.MULTI_PROFISSIONAL,
  'usuarios:gerenciar': MODULOS.MULTI_PROFISSIONAL,
});

const TODAS = Object.keys(PERMISSOES);

export const PAPEIS = Object.freeze({
  PROPRIETARIO: TODAS,
  RECEPCIONISTA: [
    'clientes:ler',
    'clientes:escrever',
    'servicos:ler',
    'atendimentos:ler',
    'atendimentos:escrever',
    'atendimentos:todos',
    'agenda:ler',
    'orcamentos:ler',
    'orcamentos:escrever',
    'profissionais:ler',
  ],
  PROFISSIONAL: ['clientes:ler', 'servicos:ler', 'atendimentos:ler', 'atendimentos:escrever', 'agenda:ler'],
});

/**
 * @param {string} papel
 * @param {Iterable<string>} modulosAtivos códigos dos módulos ativos da empresa
 * @returns {Set<string>} permissões efetivas
 */
export function permissoesEfetivas(papel, modulosAtivos) {
  const modulos = new Set(modulosAtivos);
  return new Set((PAPEIS[papel] ?? []).filter((p) => modulos.has(PERMISSOES[p])));
}

export function moduloDaPermissao(permissao) {
  return PERMISSOES[permissao];
}
