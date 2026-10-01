/**
 * Configurações da empresa: identidade, aparência (cores -> variáveis CSS no front),
 * segmento e campos personalizados.
 */
import { AbstractService } from '../../core/AbstractService.js';
import { presetDoSegmento } from './segmentos.js';

const SELECT = {
  id: true,
  nome: true,
  nomeFantasia: true,
  documento: true,
  email: true,
  telefone: true,
  whatsapp: true,
  segmento: true,
  endereco: true,
  aparencia: true,
  camposPersonalizados: true,
  fusoHorario: true,
  status: true,
  valorMensalCentavos: true,
  modulos: { where: { ativo: true }, select: { moduloCodigo: true, modulo: { select: { nome: true } } } },
};

export class ConfiguracoesService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async obter(ctx) {
    const e = await this.prisma.empresa.findUnique({ where: { id: ctx.empresaId }, select: SELECT });
    return { ...e, modulos: e.modulos.map((m) => ({ codigo: m.moduloCodigo, nome: m.modulo.nome })) };
  }

  /** Definição dos campos personalizados (cache 5 min, invalidado ao salvar). */
  camposPersonalizados(empresaId) {
    return this.cache.wrap(`cfg:campos:${empresaId}`, 300, async () => {
      const e = await this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { camposPersonalizados: true } });
      return e?.camposPersonalizados ?? {};
    });
  }

  async atualizar(ctx, { aparencia, camposPersonalizados, aplicarPresetSegmento, ...dados }) {
    const atual = await this.prisma.empresa.findUnique({ where: { id: ctx.empresaId }, select: { aparencia: true, segmento: true } });
    const data = { ...dados };
    if (aparencia) data.aparencia = { ...(atual.aparencia ?? {}), ...aparencia };
    if (camposPersonalizados) data.camposPersonalizados = camposPersonalizados;
    if (aplicarPresetSegmento) data.camposPersonalizados = presetDoSegmento(dados.segmento ?? atual.segmento);

    await this.prisma.empresa.update({ where: { id: ctx.empresaId }, data, select: { id: true } });
    await this.cache.del(`cfg:campos:${ctx.empresaId}`);
    await this.auditoria.registrar({
      acao: 'CONFIGURACOES_ALTERADAS',
      entidade: 'Empresa',
      entidadeId: ctx.empresaId,
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      dados: Object.keys(data),
      ip: ctx.ip,
    });
    return this.obter(ctx);
  }
}
