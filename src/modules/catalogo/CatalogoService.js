/**
 * Catálogo comercial: plano Start (preço base) + módulos opcionais.
 * Preço mensal = base + soma dos módulos escolhidos (obrigatórios entram sempre).
 * O valor é "congelado" na empresa no momento da contratação (snapshot).
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';

export const PLANO_PADRAO = 'START';

export class CatalogoService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async obterPlano() {
    return this.cache.wrap('catalogo:v1', 300, async () => {
      const [plano, modulos] = await Promise.all([
        this.prisma.plano.findUnique({ where: { codigo: PLANO_PADRAO }, select: { codigo: true, nome: true, precoBaseCentavos: true, ativo: true } }),
        this.prisma.modulo.findMany({
          where: { ativo: true },
          orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
          select: { codigo: true, nome: true, descricao: true, precoCentavos: true, obrigatorio: true },
        }),
      ]);
      if (!plano?.ativo) return null;
      return { plano, modulos };
    });
  }

  /**
   * Calcula o preço para os módulos escolhidos.
   * @param {string[]} codigosEscolhidos
   */
  async calcularPreco(codigosEscolhidos = []) {
    const catalogo = await this.obterPlano();
    if (!catalogo) throw new ApiError(503, 'Plano indisponível no momento.', 'PLANO_INDISPONIVEL');

    const porCodigo = new Map(catalogo.modulos.map((m) => [m.codigo, m]));
    const invalidos = codigosEscolhidos.filter((c) => !porCodigo.has(c));
    if (invalidos.length) {
      throw ApiError.unprocessable(`Módulo(s) inválido(s): ${invalidos.join(', ')}.`, 'MODULO_INVALIDO');
    }
    const escolhidos = new Set([...codigosEscolhidos, ...catalogo.modulos.filter((m) => m.obrigatorio).map((m) => m.codigo)]);
    const modulos = catalogo.modulos.filter((m) => escolhidos.has(m.codigo));
    const totalModulos = modulos.reduce((acc, m) => acc + m.precoCentavos, 0);

    return {
      plano: catalogo.plano.codigo,
      precoBaseCentavos: catalogo.plano.precoBaseCentavos,
      modulos: modulos.map(({ codigo, nome, precoCentavos }) => ({ codigo, nome, precoCentavos })),
      totalCentavos: catalogo.plano.precoBaseCentavos + totalModulos,
    };
  }

  // ----- administração (super admin) -----

  async listarAdmin() {
    const [plano, modulos] = await Promise.all([
      this.prisma.plano.findUnique({ where: { codigo: PLANO_PADRAO } }),
      this.prisma.modulo.findMany({ orderBy: [{ ordem: 'asc' }] }),
    ]);
    return { plano, modulos };
  }

  async atualizarPlano(admin, { precoBaseCentavos, nome }) {
    const plano = await this.prisma.plano.update({ where: { codigo: PLANO_PADRAO }, data: { precoBaseCentavos, nome } });
    await this.#aposAlteracao(admin, 'CATALOGO_PLANO_ATUALIZADO', 'Plano', plano.id, { precoBaseCentavos, nome });
    return plano;
  }

  async atualizarModulo(admin, codigo, data) {
    const modulo = await this.prisma.modulo.update({ where: { codigo }, data });
    await this.#aposAlteracao(admin, 'CATALOGO_MODULO_ATUALIZADO', 'Modulo', codigo, data);
    return modulo;
  }

  async #aposAlteracao(admin, acao, entidade, entidadeId, dados) {
    await this.cache.del('catalogo:v1');
    await this.auditoria.registrar({ acao, entidade, entidadeId, adminId: admin.id, dados, ip: admin.ip });
  }
}
