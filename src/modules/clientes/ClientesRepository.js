import { AbstractRepository } from '../../core/AbstractRepository.js';

export const CLIENTE_SELECT = {
  id: true,
  nome: true,
  informacaoAdicional: true,
  telefone: true,
  whatsapp: true,
  email: true,
  documento: true,
  dataNascimento: true,
  cep: true,
  logradouro: true,
  numero: true,
  complemento: true,
  bairro: true,
  cidade: true,
  estado: true,
  observacoes: true,
  status: true,
  camposExtras: true,
  criadoEm: true,
  atualizadoEm: true,
};

export class ClientesRepository extends AbstractRepository {
  constructor(prisma) {
    super(prisma, 'cliente', { defaultSelect: CLIENTE_SELECT, defaultOrderBy: { nome: 'asc' } });
  }

  /** Aniversariantes entre hoje e +N dias (comparando mês/dia no fuso da empresa). */
  async aniversariantes(empresaId, { hoje, dias }) {
    return this.db.$queryRaw`
      SELECT id, nome, telefone, whatsapp, email, data_nascimento AS "dataNascimento"
      FROM clientes
      WHERE empresa_id = ${empresaId}::uuid
        AND status = 'ATIVO'
        AND data_nascimento IS NOT NULL
        AND (
          make_date(EXTRACT(YEAR FROM ${hoje}::date)::int, EXTRACT(MONTH FROM data_nascimento)::int,
                    LEAST(EXTRACT(DAY FROM data_nascimento)::int, 28 + (EXTRACT(MONTH FROM data_nascimento)::int <> 2)::int * 3))
            BETWEEN ${hoje}::date AND (${hoje}::date + ${dias}::int)
          OR
          make_date(EXTRACT(YEAR FROM ${hoje}::date)::int + 1, EXTRACT(MONTH FROM data_nascimento)::int,
                    LEAST(EXTRACT(DAY FROM data_nascimento)::int, 28 + (EXTRACT(MONTH FROM data_nascimento)::int <> 2)::int * 3))
            BETWEEN ${hoje}::date AND (${hoje}::date + ${dias}::int)
        )
      ORDER BY EXTRACT(MONTH FROM data_nascimento), EXTRACT(DAY FROM data_nascimento)
      LIMIT 200`;
  }

  /**
   * Clientes "sumidos": sem atendimento realizado há mais de N dias.
   * Uma única query com agregação (sem N+1).
   */
  async inativos(empresaId, { dias, limite = 100 }) {
    return this.db.$queryRaw`
      SELECT c.id, c.nome, c.telefone, c.whatsapp,
             MAX(a.inicio) AS "ultimoAtendimento",
             COUNT(a.id)::int AS "totalAtendimentos",
             CASE WHEN COUNT(a.id) > 1
                  THEN ROUND(EXTRACT(EPOCH FROM (MAX(a.inicio) - MIN(a.inicio))) / 86400 / (COUNT(a.id) - 1))::int
             END AS "frequenciaMediaDias"
      FROM clientes c
      JOIN atendimentos a ON a.cliente_id = c.id AND a.empresa_id = c.empresa_id AND a.status = 'REALIZADO'
      WHERE c.empresa_id = ${empresaId}::uuid AND c.status = 'ATIVO'
      GROUP BY c.id
      HAVING MAX(a.inicio) < now() - make_interval(days => ${dias}::int)
      ORDER BY MAX(a.inicio) ASC
      LIMIT ${limite}::int`;
  }
}
