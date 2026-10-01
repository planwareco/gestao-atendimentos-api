/**
 * Guards de acesso — montados com as dependências do container (DI).
 *
 * guards.usuario(route)  -> JWT do usuário + status da empresa + RBAC/módulo
 * guards.admin(route)    -> JWT do super admin (+ exige 2FA configurado)
 * guards.checkout()      -> token do link de pagamento (na URL)
 *
 * Status da empresa (tenant):
 *   PENDENTE        -> 402 em tudo, exceto rotas marcadas `allowPending`
 *   SOMENTE_LEITURA -> 403 em POST/PUT/PATCH/DELETE (exceto `allowReadOnly`)
 *   DESATIVADO      -> 403 em tudo (o login também é bloqueado)
 */
import { ApiError } from '../core/ApiError.js';
import { extractBearer, verifyAdminAccess, verifyCheckout, verifyUsuarioAccess } from '../security/tokens.js';
import { moduloDaPermissao, permissoesEfetivas } from '../security/permissions.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertEmpresaPodeAcessar(empresa, { method, allowPending = false, allowReadOnly = false }) {
  switch (empresa.status) {
    case 'DESATIVADO':
      throw new ApiError(403, 'O acesso desta empresa está desativado. Entre em contato com o suporte.', 'EMPRESA_DESATIVADA');
    case 'PENDENTE':
      if (!allowPending) throw new ApiError(402, 'Conclua o pagamento da adesão para liberar o sistema.', 'ASSINATURA_PENDENTE');
      break;
    case 'SOMENTE_LEITURA':
      if (!SAFE_METHODS.has(method) && !allowReadOnly) {
        throw new ApiError(403, 'Sua conta está em modo somente leitura. Regularize a assinatura para voltar a editar.', 'EMPRESA_SOMENTE_LEITURA');
      }
      break;
    default:
  }
}

export function assertPermissao(permissoes, modulosAtivos, required) {
  if (!required) return;
  const lista = [required].flat();
  if (lista.some((p) => permissoes.has(p))) return;
  const modulos = new Set(modulosAtivos);
  const faltaModulo = lista.every((p) => !modulos.has(moduloDaPermissao(p)));
  if (faltaModulo) {
    throw new ApiError(403, 'Este recurso não faz parte do seu plano. Fale com o suporte para contratar o módulo.', 'MODULO_NAO_CONTRATADO');
  }
  throw new ApiError(403, 'Você não tem permissão para esta ação.', 'PERMISSAO_NEGADA');
}

export function createGuards({ services, rateLimiters, config }) {
  const { contexto, adminAuth } = services;

  function usuario(route = {}) {
    const authenticate = async (req, _res, next) => {
      try {
        const token = extractBearer(req);
        if (!token) throw ApiError.unauthorized('Token de acesso ausente.', 'TOKEN_AUSENTE');
        const payload = verifyUsuarioAccess(token);

        const user = await contexto.usuario(payload.sub);
        if (!user || !user.ativo || user.empresaId !== payload.emp) {
          throw ApiError.unauthorized('Sessão inválida. Faça login novamente.', 'SESSAO_INVALIDA');
        }
        const empresa = await contexto.empresa(user.empresaId);
        if (!empresa) throw ApiError.unauthorized('Sessão inválida.', 'SESSAO_INVALIDA');

        assertEmpresaPodeAcessar(empresa, { method: req.method, allowPending: route.allowPending, allowReadOnly: route.allowReadOnly });

        const permissoes = permissoesEfetivas(user.papel, empresa.modulos);
        assertPermissao(permissoes, empresa.modulos, route.permission);

        req.ctx = {
          usuarioId: user.id,
          empresaId: user.empresaId,
          papel: user.papel,
          profissionalId: user.profissionalId ?? null,
          permissoes,
          modulos: new Set(empresa.modulos),
          statusEmpresa: empresa.status,
          fusoHorario: empresa.fusoHorario,
          ip: req.ip,
          requestId: req.id,
          /** ABAC: pode ver/editar atendimentos de todos? */
          podeVerTodos: permissoes.has('atendimentos:todos'),
        };
        return next();
      } catch (err) {
        return next(err);
      }
    };
    return [authenticate, rateLimiters.porUsuario];
  }

  function admin(route = {}) {
    return async (req, _res, next) => {
      try {
        const token = extractBearer(req);
        if (!token) throw ApiError.unauthorized('Token de acesso ausente.', 'TOKEN_AUSENTE');
        const payload = verifyAdminAccess(token);
        const found = await adminAuth.carregarAdminAtivo(payload.sub);
        if (!found) throw ApiError.unauthorized('Sessão inválida.', 'SESSAO_INVALIDA');
        if (config.auth.adminRequire2fa && !found.totpAtivo && !route.allowMfaSetup) {
          throw ApiError.forbidden('Configure a verificação em duas etapas (2FA) para continuar.', 'MFA_CONFIGURACAO_OBRIGATORIA');
        }
        req.admin = { id: found.id, nome: found.nome, email: found.email, ip: req.ip, requestId: req.id };
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  function checkout() {
    return (req, _res, next) => {
      try {
        const payload = verifyCheckout(req.params.token);
        req.checkout = { empresaId: payload.sub, ip: req.ip, requestId: req.id };
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  return { usuario, admin, checkout };
}
