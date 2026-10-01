import { describe, expect, it } from '@jest/globals';
import { permissoesEfetivas } from '../../src/security/permissions.js';
import { assertEmpresaPodeAcessar, assertPermissao } from '../../src/middlewares/guards.js';
import { decrypt, encrypt, hashObject } from '../../src/security/crypto.js';

describe('permissões efetivas = papel ∩ módulos contratados', () => {
  it('proprietário só com NÚCLEO não tem orçamentos nem financeiro', () => {
    const p = permissoesEfetivas('PROPRIETARIO', ['NUCLEO']);
    expect(p.has('clientes:escrever')).toBe(true);
    expect(p.has('orcamentos:ler')).toBe(false);
    expect(p.has('financeiro:ver')).toBe(false);
  });

  it('profissional nunca vê financeiro nem atendimentos de todos', () => {
    const p = permissoesEfetivas('PROFISSIONAL', ['NUCLEO', 'FINANCEIRO', 'MULTI_PROFISSIONAL', 'ORCAMENTOS']);
    expect(p.has('financeiro:ver')).toBe(false);
    expect(p.has('atendimentos:todos')).toBe(false);
    expect(p.has('atendimentos:escrever')).toBe(true);
  });

  it('diferencia módulo não contratado de permissão negada', () => {
    const modulos = ['NUCLEO'];
    expect(() => assertPermissao(permissoesEfetivas('PROPRIETARIO', modulos), modulos, 'orcamentos:ler')).toThrow(
      expect.objectContaining({ code: 'MODULO_NAO_CONTRATADO', status: 403 }),
    );
    const todos = ['NUCLEO', 'FINANCEIRO'];
    expect(() => assertPermissao(permissoesEfetivas('PROFISSIONAL', todos), todos, 'financeiro:ver')).toThrow(
      expect.objectContaining({ code: 'PERMISSAO_NEGADA' }),
    );
  });
});

describe('status da empresa', () => {
  const pode =
    (status, method, opts = {}) =>
    () =>
      assertEmpresaPodeAcessar({ status }, { method, ...opts });

  it('ATIVO libera tudo', () => {
    expect(pode('ATIVO', 'POST')).not.toThrow();
  });
  it('PENDENTE retorna 402 exceto rotas liberadas', () => {
    expect(pode('PENDENTE', 'GET')).toThrow(expect.objectContaining({ status: 402, code: 'ASSINATURA_PENDENTE' }));
    expect(pode('PENDENTE', 'GET', { allowPending: true })).not.toThrow();
  });
  it('SOMENTE_LEITURA permite GET e bloqueia escrita', () => {
    expect(pode('SOMENTE_LEITURA', 'GET')).not.toThrow();
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(pode('SOMENTE_LEITURA', m)).toThrow(expect.objectContaining({ code: 'EMPRESA_SOMENTE_LEITURA' }));
    }
  });
  it('DESATIVADO bloqueia até leitura', () => {
    expect(pode('DESATIVADO', 'GET', { allowPending: true, allowReadOnly: true })).toThrow(expect.objectContaining({ code: 'EMPRESA_DESATIVADA' }));
  });
});

describe('criptografia', () => {
  it('AES-256-GCM ida e volta, com IV aleatório', () => {
    const a = encrypt('segredo-totp');
    const b = encrypt('segredo-totp');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('segredo-totp');
  });

  it('adulteração é detectada', () => {
    const [iv, tag, enc] = encrypt('x').split('.');
    expect(() => decrypt([iv, tag, `${enc}AA`].join('.'))).toThrow();
  });

  it('hashObject independe da ordem das chaves', () => {
    expect(hashObject({ a: 1, b: { c: 2, d: 3 } })).toBe(hashObject({ b: { d: 3, c: 2 }, a: 1 }));
  });
});
