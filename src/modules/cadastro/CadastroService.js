/**
 * Onboarding SaaS: o cliente escolhe os módulos, cria a conta e paga a adesão.
 *
 * Fluxo:
 *   1. POST /v1/public/cadastro  -> cria Empresa (PENDENTE) + proprietário + módulos
 *   2. Front abre o PaymentWidget usando o checkoutApiBaseUrl retornado
 *   3. Pagamento aprovado -> empresa vira ATIVO (ver AssinaturaService)
 */
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { hashPassword } from '../../security/password.js';
import { signCheckout } from '../../security/tokens.js';
import { APARENCIA_PADRAO, CATEGORIAS_DESPESA_PADRAO, presetDoSegmento } from '../configuracoes/segmentos.js';
import { JOBS, QUEUES } from '../../queue/queues.js';
import { formatBRL } from '../../utils/money.js';

export class CadastroService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async cadastrar({ empresa, proprietario, modulos }, meta) {
    const email = proprietario.email.toLowerCase();
    const emUso = await this.prisma.usuario.findUnique({ where: { email }, select: { id: true } });
    if (emUso) throw ApiError.conflict('Este e-mail já está cadastrado. Faça login para continuar.', 'EMAIL_EM_USO');

    const preco = await this.catalogo.calcularPreco(modulos);
    const senhaHash = await hashPassword(proprietario.senha);

    const criado = await this.prisma.$transaction(async (tx) => {
      const nova = await tx.empresa.create({
        data: {
          ...empresa,
          email: empresa.email.toLowerCase(),
          status: 'PENDENTE',
          valorMensalCentavos: preco.totalCentavos,
          aparencia: APARENCIA_PADRAO,
          camposPersonalizados: presetDoSegmento(empresa.segmento),
        },
        select: { id: true, nome: true, status: true },
      });
      await tx.empresaModulo.createMany({
        data: preco.modulos.map((m) => ({ empresaId: nova.id, moduloCodigo: m.codigo, precoCentavos: m.precoCentavos })),
      });
      await tx.categoriaDespesa.createMany({
        data: CATEGORIAS_DESPESA_PADRAO.map((nome) => ({ empresaId: nova.id, nome })),
      });
      const usuario = await tx.usuario.create({
        data: { empresaId: nova.id, nome: proprietario.nome, email, senhaHash, papel: 'PROPRIETARIO' },
        select: { id: true },
      });
      await this.auditoria.registrar(
        {
          acao: 'EMPRESA_CADASTRADA',
          entidade: 'Empresa',
          entidadeId: nova.id,
          empresaId: nova.id,
          usuarioId: usuario.id,
          dados: { modulos: preco.modulos.map((m) => m.codigo), totalCentavos: preco.totalCentavos },
          ip: meta.ip,
        },
        tx,
      );
      return { empresa: nova, usuarioId: usuario.id };
    });

    const checkoutToken = signCheckout({ empresaId: criado.empresa.id });
    const checkoutUrl = `${this.config.appUrl}/checkout/${checkoutToken}`;

    await this.queue.add(QUEUES.EMAILS, JOBS.EMAIL, {
      to: email,
      toName: proprietario.nome,
      template: 'cadastro-recebido',
      vars: { nome: proprietario.nome, empresa: criado.empresa.nome, valor: formatBRL(preco.totalCentavos), checkoutUrl },
    });

    return {
      empresa: criado.empresa,
      usuarioId: criado.usuarioId,
      preco,
      checkoutToken,
      checkoutApiBaseUrl: `${this.config.apiUrl}/v1/checkout/${checkoutToken}`,
      checkoutUrl,
    };
  }
}
