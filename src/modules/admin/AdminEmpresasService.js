/**
 * Gestão dos tenants pelo super admin:
 *  - listar/detalhar empresas
 *  - mudar status: ATIVO | SOMENTE_LEITURA | DESATIVADO (a mensalidade é cobrada fora deste sistema)
 *  - ligar/desligar módulos (muda as permissões de todos os usuários da empresa)
 *  - ativar manualmente (ex.: pagamento recebido por fora)
 *  - ativar/desativar usuários e trocar papel
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { MODULOS } from '../../security/permissions.js';

const SELECT_LISTA = {
  id: true,
  nome: true,
  nomeFantasia: true,
  email: true,
  documento: true,
  telefone: true,
  segmento: true,
  status: true,
  motivoStatus: true,
  valorMensalCentavos: true,
  ativadoEm: true,
  criadoEm: true,
  modulos: { where: { ativo: true }, select: { moduloCodigo: true } },
  _count: { select: { usuarios: true, clientes: true } },
};

const mapEmpresa = ({ modulos, _count, ...e }) => ({ ...e, modulos: modulos.map((m) => m.moduloCodigo), totais: _count });

export class AdminEmpresasService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async listar({ status, busca, page, perPage }) {
    const where = {
      ...(status && { status }),
      ...(busca && {
        OR: [
          { nome: { contains: busca, mode: 'insensitive' } },
          { email: { contains: busca, mode: 'insensitive' } },
          { documento: { contains: busca.replace(/\D/g, '') || busca } },
        ],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.empresa.findMany({ where, select: SELECT_LISTA, orderBy: { criadoEm: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.empresa.count({ where }),
    ]);
    return { items: items.map(mapEmpresa), total, page, perPage };
  }

  async obter(id) {
    const e = await this.prisma.empresa.findUnique({
      where: { id },
      select: {
        ...SELECT_LISTA,
        whatsapp: true,
        fusoHorario: true,
        modulos: { select: { moduloCodigo: true, ativo: true, precoCentavos: true } },
        usuarios: { select: { id: true, nome: true, email: true, papel: true, ativo: true, ultimoLoginEm: true }, orderBy: { criadoEm: 'asc' } },
        pagamentosAssinatura: {
          select: { id: true, gatewayPaymentId: true, metodo: true, status: true, valorCentavos: true, aprovadoEm: true, criadoEm: true },
          orderBy: { criadoEm: 'desc' },
          take: 20,
        },
        _count: { select: { usuarios: true, clientes: true, atendimentos: true, orcamentos: true } },
      },
    });
    this.notFoundIfNull(e, 'Empresa não encontrada.', 'EMPRESA_NAO_ENCONTRADA');
    const { _count, ...resto } = e;
    return { ...resto, totais: _count };
  }

  async alterarStatus(admin, id, { status, motivo }) {
    const atual = await this.prisma.empresa.findUnique({ where: { id }, select: { status: true } });
    this.notFoundIfNull(atual, 'Empresa não encontrada.', 'EMPRESA_NAO_ENCONTRADA');
    if (atual.status === status) return this.obter(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.empresa.update({
        where: { id },
        data: { status, motivoStatus: motivo ?? null, ...(status === 'ATIVO' && atual.status === 'PENDENTE' ? { ativadoEm: new Date() } : {}) },
        select: { id: true },
      });
      if (status === 'DESATIVADO') {
        // derruba todas as sessões da empresa imediatamente
        await tx.refreshToken.updateMany({ where: { usuario: { empresaId: id }, revogadoEm: null }, data: { revogadoEm: new Date() } });
      }
      await this.auditoria.registrar(
        {
          acao: 'EMPRESA_STATUS_ALTERADO',
          entidade: 'Empresa',
          entidadeId: id,
          empresaId: id,
          adminId: admin.id,
          dados: { de: atual.status, para: status, motivo },
          ip: admin.ip,
        },
        tx,
      );
    });
    await this.contexto.invalidarEmpresa(id);
    return this.obter(id);
  }

  /**
   * Define os módulos ativos da empresa. NUCLEO é sempre mantido.
   * Módulos novos entram com o preço atual do catálogo.
   */
  async definirModulos(admin, id, { modulos, recalcularValor }) {
    const empresa = await this.prisma.empresa.findUnique({ where: { id }, select: { id: true, modulos: { select: { moduloCodigo: true } } } });
    this.notFoundIfNull(empresa, 'Empresa não encontrada.', 'EMPRESA_NAO_ENCONTRADA');

    const catalogo = await this.prisma.modulo.findMany({ select: { codigo: true, precoCentavos: true, obrigatorio: true } });
    const porCodigo = new Map(catalogo.map((m) => [m.codigo, m]));
    const invalidos = modulos.filter((c) => !porCodigo.has(c));
    if (invalidos.length) throw ApiError.unprocessable(`Módulo(s) inválido(s): ${invalidos.join(', ')}.`, 'MODULO_INVALIDO');

    const desejados = new Set([...modulos, MODULOS.NUCLEO, ...catalogo.filter((m) => m.obrigatorio).map((m) => m.codigo)]);
    const existentes = new Set(empresa.modulos.map((m) => m.moduloCodigo));

    await this.prisma.$transaction(async (tx) => {
      const novos = [...desejados].filter((c) => !existentes.has(c));
      if (novos.length) {
        await tx.empresaModulo.createMany({ data: novos.map((c) => ({ empresaId: id, moduloCodigo: c, precoCentavos: porCodigo.get(c).precoCentavos })) });
      }
      await tx.empresaModulo.updateMany({ where: { empresaId: id, moduloCodigo: { in: [...desejados] } }, data: { ativo: true } });
      await tx.empresaModulo.updateMany({ where: { empresaId: id, moduloCodigo: { notIn: [...desejados] } }, data: { ativo: false } });

      if (recalcularValor) {
        const plano = await tx.plano.findUnique({ where: { codigo: 'START' }, select: { precoBaseCentavos: true } });
        const ativos = await tx.empresaModulo.findMany({ where: { empresaId: id, ativo: true }, select: { precoCentavos: true } });
        const valor = (plano?.precoBaseCentavos ?? 0) + ativos.reduce((a, m) => a + m.precoCentavos, 0);
        await tx.empresa.update({ where: { id }, data: { valorMensalCentavos: valor }, select: { id: true } });
      }
      await this.auditoria.registrar(
        {
          acao: 'EMPRESA_MODULOS_ALTERADOS',
          entidade: 'Empresa',
          entidadeId: id,
          empresaId: id,
          adminId: admin.id,
          dados: { modulos: [...desejados], recalcularValor },
          ip: admin.ip,
        },
        tx,
      );
    });
    await this.contexto.invalidarEmpresa(id);
    return this.obter(id);
  }

  async alterarUsuario(admin, empresaId, usuarioId, { ativo, papel }) {
    const usuario = await this.prisma.usuario.findFirst({ where: { id: usuarioId, empresaId }, select: { id: true, papel: true, ativo: true } });
    this.notFoundIfNull(usuario, 'Usuário não encontrado.', 'USUARIO_NAO_ENCONTRADO');

    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: usuarioId }, data: { ativo, papel }, select: { id: true } });
      if (ativo === false) await tx.refreshToken.updateMany({ where: { usuarioId, revogadoEm: null }, data: { revogadoEm: new Date() } });
      await this.auditoria.registrar(
        {
          acao: 'USUARIO_ALTERADO_PELO_ADMIN',
          entidade: 'Usuario',
          entidadeId: usuarioId,
          empresaId,
          adminId: admin.id,
          dados: { de: usuario, para: { ativo, papel } },
          ip: admin.ip,
        },
        tx,
      );
    });
    await this.contexto.invalidarUsuario(usuarioId);
    return this.obter(empresaId);
  }

  async metricas() {
    const [porStatus, mrr, novos30d] = await Promise.all([
      this.prisma.empresa.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.empresa.aggregate({ where: { status: { in: ['ATIVO', 'SOMENTE_LEITURA'] } }, _sum: { valorMensalCentavos: true } }),
      this.prisma.empresa.count({ where: { criadoEm: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    ]);
    return {
      empresasPorStatus: Object.fromEntries(porStatus.map((s) => [s.status, s._count._all])),
      receitaMensalContratadaCentavos: mrr._sum.valorMensalCentavos ?? 0,
      cadastrosUltimos30Dias: novos30d,
    };
  }
}
