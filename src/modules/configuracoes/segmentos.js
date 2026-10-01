/**
 * Presets por segmento de negócio.
 * O núcleo é sempre o mesmo (Cliente -> Serviço -> Atendimento -> Financeiro);
 * cada segmento só muda rótulos e campos extras (guardados em JSONB).
 * O proprietário pode editar esses campos depois em /v1/configuracoes.
 */
export const SEGMENTOS = Object.freeze({
  SALAO_BELEZA: {
    nome: 'Salão de beleza',
    rotulos: { cliente: 'Cliente', servico: 'Serviço', atendimento: 'Atendimento' },
    campos: { cliente: [], atendimento: [] },
  },
  BARBEARIA: {
    nome: 'Barbearia',
    rotulos: { cliente: 'Cliente', servico: 'Serviço', atendimento: 'Atendimento' },
    campos: { cliente: [], atendimento: [] },
  },
  ESTETICA: {
    nome: 'Estética',
    rotulos: { cliente: 'Cliente', servico: 'Procedimento', atendimento: 'Sessão' },
    campos: {
      cliente: [
        { chave: 'tipoPele', rotulo: 'Tipo de pele', tipo: 'selecao', obrigatorio: false, opcoes: ['Normal', 'Seca', 'Oleosa', 'Mista', 'Sensível'] },
        { chave: 'alergias', rotulo: 'Alergias / contraindicações', tipo: 'texto', obrigatorio: false },
      ],
      atendimento: [],
    },
  },
  PETSHOP: {
    nome: 'Pet shop',
    rotulos: { cliente: 'Tutor', servico: 'Serviço', atendimento: 'Atendimento' },
    campos: {
      cliente: [],
      // No pet shop o atendimento é do animal, o cliente é o tutor
      atendimento: [
        { chave: 'petNome', rotulo: 'Nome do pet', tipo: 'texto', obrigatorio: true },
        { chave: 'especie', rotulo: 'Espécie', tipo: 'selecao', obrigatorio: true, opcoes: ['Cachorro', 'Gato', 'Outro'] },
        { chave: 'raca', rotulo: 'Raça', tipo: 'texto', obrigatorio: false },
        { chave: 'porte', rotulo: 'Porte', tipo: 'selecao', obrigatorio: false, opcoes: ['Pequeno', 'Médio', 'Grande'] },
      ],
    },
  },
  FISIOTERAPIA: {
    nome: 'Fisioterapia',
    rotulos: { cliente: 'Paciente', servico: 'Procedimento', atendimento: 'Sessão' },
    campos: {
      cliente: [
        { chave: 'convenio', rotulo: 'Convênio', tipo: 'texto', obrigatorio: false },
        { chave: 'queixaPrincipal', rotulo: 'Queixa principal', tipo: 'texto', obrigatorio: false },
      ],
      atendimento: [{ chave: 'evolucao', rotulo: 'Evolução da sessão', tipo: 'texto', obrigatorio: false }],
    },
  },
  CONSULTORIA: {
    nome: 'Consultoria',
    rotulos: { cliente: 'Cliente', servico: 'Serviço', atendimento: 'Reunião' },
    campos: {
      cliente: [{ chave: 'responsavel', rotulo: 'Pessoa de contato', tipo: 'texto', obrigatorio: false }],
      atendimento: [{ chave: 'pauta', rotulo: 'Pauta', tipo: 'texto', obrigatorio: false }],
    },
  },
  OUTRO: {
    nome: 'Outro',
    rotulos: { cliente: 'Cliente', servico: 'Serviço', atendimento: 'Atendimento' },
    campos: { cliente: [], atendimento: [] },
  },
});

export const CATEGORIAS_DESPESA_PADRAO = [
  'Insumos',
  'Aluguel',
  'Energia',
  'Água',
  'Internet',
  'Equipamentos',
  'Marketing',
  'Funcionários',
  'Impostos',
  'Transporte',
  'Software',
  'Outros',
];

export const APARENCIA_PADRAO = Object.freeze({
  nomeSistema: null, // nome exibido no topo do menu (null = nome da empresa)
  corPrimaria: '#6D5EF8',
  corSecundaria: '#14B8A6',
  tema: 'claro',
  logoUrl: null,
  faviconUrl: null,
});

export function presetDoSegmento(segmento) {
  const s = SEGMENTOS[segmento] ?? SEGMENTOS.OUTRO;
  return { rotulos: s.rotulos, ...s.campos };
}
