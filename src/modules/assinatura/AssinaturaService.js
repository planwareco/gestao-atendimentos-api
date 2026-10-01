/**
 * Pagamento da adesão via payment-system-mp + ativação da empresa.
 *
 * SEGURANÇA
 *  - O VALOR é sempre calculado no servidor (empresa.valorMensalCentavos).
 *    Qualquer `amount` enviado pelo front é ignorado.
 *  - O token de API do payment-system-mp nunca sai do servidor.
 *  - Só é possível consultar/cancelar pagamentos da própria empresa.
 *
 * CONFIRMAÇÃO DO PAGAMENTO
 *  O payment-system-mp não notifica os SaaS clientes. A confirmação acontece:
 *   1. quando o PaymentWidget faz polling em GET /payments/:id (?syncWithMp=true)
 *   2. por um job de reconciliação a cada 5 min (se o usuário fechar a aba)
 *  A ativação é idempotente: o mesmo pagamento nunca ativa duas vezes.
 */
import crypto from 'node:crypto';
import { AbstractService } from '../../core/AbstractService.js';
import { ApiError } from '../../core/ApiError.js';
import { JOBS, QUEUES } from '../../queue/queues.js';
import { centavosParaReais, formatBRL } from '../../utils/money.js';

const STATUS_VALIDOS = new Set(['PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK']);
const normalizarStatus = (s) => (STATUS_VALIDOS.has(s) ? s : 'PENDING');

export class AssinaturaService extends AbstractService {
  constructor(deps) {
    super(deps);
  }

  async #empresaPendente(empresaId) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        id: true,
        nome: true,
        email: true,
        documento: true,
        status: true,
        valorMensalCentavos: true,
        modulos: { where: { ativo: true }, select: { moduloCodigo: true, precoCentavos: true, modulo: { select: { nome: true } } } },
      },
    });
    if (!empresa) throw ApiError.notFound('Cadastro não encontrado.', 'EMPRESA_NAO_ENCONTRADA');
    return empresa;
  }

  /** Dados que a tela de checkout precisa (valor, módulos, public key do MP). */
  async resumo(empresaId) {
    const e = await this.#empresaPendente(empresaId);
    return {
      empresa: { id: e.id, nome: e.nome, status: e.status },
      pago: e.status !== 'PENDENTE',
      valorCentavos: e.valorMensalCentavos,
      valor: centavosParaReais(e.valorMensalCentavos),
      descricao: `Adesão plano Start — ${e.nome}`,
      modulos: e.modulos.map((m) => ({ codigo: m.moduloCodigo, nome: m.modulo.nome, precoCentavos: m.precoCentavos })),
      publicKey: this.gateway.publicKey,
      metodos: ['PIX', 'CREDIT_CARD', 'BOLETO'],
    };
  }

  configWidget() {
    return { publicKey: this.gateway.publicKey };
  }

  async criarPagamento(empresaId, dadosPagador) {
    const empresa = await this.#empresaPendente(empresaId);
    if (empresa.status !== 'PENDENTE') {
      throw ApiError.conflict('O pagamento desta empresa já foi confirmado.', 'ASSINATURA_JA_ATIVA');
    }

    const payload = {
      ...dadosPagador,
      amount: centavosParaReais(empresa.valorMensalCentavos), // definido pelo servidor, nunca pelo cliente
      description: `Adesão plano Start — ${empresa.nome}`.slice(0, 255),
      externalReference: `adesao:${empresa.id}:${crypto.randomUUID().slice(0, 8)}`,
      metadata: { empresaId: empresa.id, tipo: 'ADESAO' },
    };

    const pagamento = await this.gateway.createPayment(payload);

    const local = await this.prisma.pagamentoAssinatura.create({
      data: {
        empresaId: empresa.id,
        gatewayPaymentId: String(pagamento.id),
        mpPaymentId: pagamento.mpPaymentId ? String(pagamento.mpPaymentId) : null,
        metodo: pagamento.method ?? dadosPagador.method,
        // aprovado na hora (cartão) entra como PENDING e é promovido por #aplicarStatus,
        // que é o ÚNICO caminho que ativa a empresa
        status: normalizarStatus(pagamento.status) === 'APPROVED' ? 'PENDING' : normalizarStatus(pagamento.status),
        valorCentavos: empresa.valorMensalCentavos,
        ultimaSincronizacaoEm: new Date(),
      },
      select: { id: true, empresaId: true, status: true, gatewayPaymentId: true },
    });

    this.logger.info({ empresaId, gatewayPaymentId: local.gatewayPaymentId, status: local.status }, 'Pagamento de adesão criado');

    // Cartão pode ser aprovado na hora
    if (normalizarStatus(pagamento.status) === 'APPROVED') await this.#aplicarStatus(local, pagamento);
    return pagamento;
  }

  async #pagamentoDaEmpresa(empresaId, gatewayPaymentId) {
    const local = await this.prisma.pagamentoAssinatura.findFirst({
      where: { empresaId, gatewayPaymentId },
      select: { id: true, empresaId: true, status: true, gatewayPaymentId: true },
    });
    // 404 também quando é de outra empresa: não revela existência
    if (!local) throw ApiError.notFound('Pagamento não encontrado.', 'PAGAMENTO_NAO_ENCONTRADO');
    return local;
  }

  async consultarPagamento(empresaId, gatewayPaymentId, { sync = false } = {}) {
    const local = await this.#pagamentoDaEmpresa(empresaId, gatewayPaymentId);
    const pagamento = await this.gateway.getPayment(gatewayPaymentId, { sync });
    await this.#aplicarStatus(local, pagamento);
    return pagamento;
  }

  async cancelarPagamento(empresaId, gatewayPaymentId) {
    const local = await this.#pagamentoDaEmpresa(empresaId, gatewayPaymentId);
    const pagamento = await this.gateway.cancelPayment(gatewayPaymentId);
    await this.#aplicarStatus(local, pagamento);
    return pagamento;
  }

  async comprovante(empresaId, gatewayPaymentId) {
    const local = await this.#pagamentoDaEmpresa(empresaId, gatewayPaymentId);
    if (local.status !== 'APPROVED') throw ApiError.conflict('Comprovante disponível apenas para pagamentos aprovados.', 'PAGAMENTO_NAO_APROVADO');
    return this.gateway.getReceipt(gatewayPaymentId);
  }

  /** Atualiza o status local e ativa a empresa se aprovado (idempotente). */
  async #aplicarStatus(local, pagamento) {
    const status = normalizarStatus(pagamento?.status);
    const agora = new Date();

    if (status !== 'APPROVED') {
      if (status !== local.status) {
        await this.prisma.pagamentoAssinatura.update({ where: { id: local.id }, data: { status, ultimaSincronizacaoEm: agora }, select: { id: true } });
      }
      return { ativou: false };
    }

    const ativou = await this.prisma.$transaction(async (tx) => {
      // Condição no WHERE = trava contra duas confirmações simultâneas (polling + job)
      const pag = await tx.pagamentoAssinatura.updateMany({
        where: { id: local.id, status: { not: 'APPROVED' } },
        data: {
          status: 'APPROVED',
          aprovadoEm: agora,
          ultimaSincronizacaoEm: agora,
          mpPaymentId: pagamento.mpPaymentId ? String(pagamento.mpPaymentId) : undefined,
        },
      });
      if (pag.count === 0) return false;
      const emp = await tx.empresa.updateMany({
        where: { id: local.empresaId, status: 'PENDENTE' },
        data: { status: 'ATIVO', ativadoEm: agora, motivoStatus: null },
      });
      await this.auditoria.registrar(
        {
          acao: emp.count ? 'ASSINATURA_ATIVADA' : 'PAGAMENTO_APROVADO',
          entidade: 'Empresa',
          entidadeId: local.empresaId,
          empresaId: local.empresaId,
          dados: { gatewayPaymentId: local.gatewayPaymentId },
        },
        tx,
      );
      return emp.count === 1;
    });

    if (ativou) {
      await this.contexto.invalidarEmpresa(local.empresaId);
      await this.#emailBoasVindas(local.empresaId);
      this.logger.info({ empresaId: local.empresaId }, 'Empresa ativada após pagamento');
    }
    return { ativou };
  }

  async #emailBoasVindas(empresaId) {
    const dono = await this.prisma.usuario.findFirst({
      where: { empresaId, papel: 'PROPRIETARIO' },
      orderBy: { criadoEm: 'asc' },
      select: { nome: true, email: true, empresa: { select: { nome: true, valorMensalCentavos: true } } },
    });
    if (!dono) return;
    await this.queue.add(
      QUEUES.EMAILS,
      JOBS.EMAIL,
      {
        to: dono.email,
        toName: dono.nome,
        template: 'boas-vindas',
        vars: { nome: dono.nome, empresa: dono.empresa.nome, valor: formatBRL(dono.empresa.valorMensalCentavos), loginUrl: `${this.config.appUrl}/login` },
      },
      { jobId: `boas-vindas-${empresaId}` },
    );
  }

  /** Job: confere pagamentos pendentes das últimas 72h direto no payment-system-mp. */
  async reconciliarPendentes({ limite = 50 } = {}) {
    const pendentes = await this.prisma.pagamentoAssinatura.findMany({
      where: { status: { in: ['PENDING', 'IN_PROCESS'] }, criadoEm: { gte: new Date(Date.now() - 72 * 3600_000) } },
      orderBy: { ultimaSincronizacaoEm: { sort: 'asc', nulls: 'first' } },
      take: limite,
      select: { id: true, empresaId: true, status: true, gatewayPaymentId: true },
    });
    let ativadas = 0;
    for (const local of pendentes) {
      try {
        const pagamento = await this.gateway.getPayment(local.gatewayPaymentId, { sync: true });
        const r = await this.#aplicarStatus(local, pagamento);
        if (r.ativou) ativadas += 1;
        else await this.prisma.pagamentoAssinatura.update({ where: { id: local.id }, data: { ultimaSincronizacaoEm: new Date() }, select: { id: true } });
      } catch (err) {
        this.logger.warn({ err: err.message, gatewayPaymentId: local.gatewayPaymentId }, 'Falha ao reconciliar pagamento');
        if (err.code === 'PAGAMENTOS_CIRCUITO_ABERTO') break;
      }
    }
    return { verificados: pendentes.length, ativadas };
  }
}
