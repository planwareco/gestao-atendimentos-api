/**
 * Processadores dos jobs. Recebem o container (DI) — a mesma lógica de negócio
 * dos services é reutilizada, nada é duplicado no worker.
 */
import { JOBS } from './queues.js';
import { EMAIL_TEMPLATES } from './emailTemplates.js';

export function createProcessors(container) {
  const { services, emailClient, config, logger, prisma, refreshTokens, adminRefreshTokens } = container;

  return {
    [JOBS.EMAIL]: async ({ to, toName, template, vars }) => {
      const build = EMAIL_TEMPLATES[template];
      if (!build) throw new Error(`Template de e-mail desconhecido: ${template}`);
      const { subject, html } = build(vars, config.appName);
      await emailClient.send({ to, toName, subject, html });
      return { enviado: true };
    },

    [JOBS.PDF_ORCAMENTO]: (data) => services.orcamentos.gerarPdf(data),

    [JOBS.RECONCILIAR_PAGAMENTOS]: async () => {
      const r = await services.assinatura.reconciliarPendentes();
      if (r.verificados) logger.info(r, 'Reconciliação de pagamentos concluída');
      return r;
    },

    [JOBS.EXPIRAR_ORCAMENTOS]: () => services.orcamentos.expirarVencidos(),

    [JOBS.LIMPAR_EXPIRADOS]: async () => {
      const [idem, rt, art] = await Promise.all([
        prisma.chaveIdempotencia.deleteMany({ where: { expiraEm: { lt: new Date() } } }),
        refreshTokens.limparExpirados(),
        adminRefreshTokens.limparExpirados(),
      ]);
      return { idempotencia: idem.count, refreshTokens: rt, adminRefreshTokens: art };
    },
  };
}
