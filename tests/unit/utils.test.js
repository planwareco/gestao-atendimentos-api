import { describe, expect, it, jest } from '@jest/globals';
import { aplicarBps, calcularTotais, centavosParaReais, formatBRL } from '../../src/utils/money.js';
import { dayRangeUtc, partsInTz, zonedToUtc } from '../../src/utils/dates.js';
import { CircuitBreaker, retryWithBackoff } from '../../src/utils/resilience.js';
import { createCache } from '../../src/utils/cache.js';
import { validarCamposExtras } from '../../src/modules/configuracoes/camposExtras.js';
import { presetDoSegmento } from '../../src/modules/configuracoes/segmentos.js';

describe('dinheiro em centavos', () => {
  it('sem erro de ponto flutuante', () => {
    const t = calcularTotais([{ quantidade: 3, valorUnitarioCentavos: 10 }], { descontoCentavos: 0 });
    expect(t.totalCentavos).toBe(30);
    expect(centavosParaReais(11960)).toBe(119.6);
  });
  it('basis points', () => {
    expect(aplicarBps(9000, 4000)).toBe(3600);
    expect(aplicarBps(333, 3333)).toBe(111);
  });
  it('formata em BRL', () => {
    expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
  });
});

describe('fuso horário', () => {
  it('converte horário local de São Paulo para UTC', () => {
    expect(zonedToUtc('2026-10-05', '08:00', 'America/Sao_Paulo').toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });
  it('limites do dia local', () => {
    const { inicio, fim } = dayRangeUtc('2026-10-05', 'America/Sao_Paulo');
    expect(inicio.toISOString()).toBe('2026-10-05T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-10-06T03:00:00.000Z');
  });
  it('dia da semana no fuso', () => {
    // 2026-10-05 01:00 UTC ainda é domingo (04/10) em São Paulo
    expect(partsInTz(new Date('2026-10-05T01:00:00Z'), 'America/Sao_Paulo').weekday).toBe(0);
  });
});

describe('resiliência', () => {
  it('retry com backoff para de tentar em erro não transitório', async () => {
    const fn = jest.fn().mockRejectedValue(Object.assign(new Error('400'), { clientError: true }));
    await expect(retryWithBackoff(fn, { retries: 3, baseMs: 1, shouldRetry: (e) => !e.clientError })).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retry recupera de falha transitória', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue('ok');
    await expect(retryWithBackoff(fn, { retries: 2, baseMs: 1 })).resolves.toBe('ok');
  });

  it('circuit breaker abre após N falhas e fecha após sucesso em HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 20 });
    const falha = () => Promise.reject(new Error('down'));
    const aberto = () => new Error('OPEN');
    await expect(cb.exec(falha, aberto)).rejects.toThrow('down');
    await expect(cb.exec(falha, aberto)).rejects.toThrow('down');
    await expect(cb.exec(() => Promise.resolve(1), aberto)).rejects.toThrow('OPEN');
    await new Promise((r) => setTimeout(r, 25));
    await expect(cb.exec(() => Promise.resolve(1), aberto)).resolves.toBe(1);
    expect(cb.state).toBe('CLOSED');
  });
});

describe('cache', () => {
  it('single-flight: chamadas simultâneas executam o loader uma vez', async () => {
    const cache = createCache(null);
    const loader = jest.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { v: 1 };
    });
    const res = await Promise.all(Array.from({ length: 5 }, () => cache.wrap('k', 60, loader)));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(res.every((r) => r.v === 1)).toBe(true);
  });

  it('bump invalida por versão', async () => {
    const cache = createCache(null);
    const v1 = await cache.version('ns');
    await cache.bump('ns');
    expect(await cache.version('ns')).not.toBe(v1);
  });
});

describe('campos personalizados por segmento', () => {
  const defs = presetDoSegmento('PETSHOP');

  it('pet shop exige nome do pet e espécie válida', () => {
    expect(() => validarCamposExtras(defs, 'atendimento', { especie: 'Cachorro' })).toThrow(expect.objectContaining({ code: 'CAMPOS_EXTRAS_INVALIDOS' }));
    expect(() => validarCamposExtras(defs, 'atendimento', { petNome: 'Thor', especie: 'Dragão' })).toThrow();
  });

  it('descarta chaves não definidas', () => {
    expect(validarCamposExtras(defs, 'atendimento', { petNome: 'Thor', especie: 'Gato', hack: '<script>' })).toEqual({ petNome: 'Thor', especie: 'Gato' });
  });
});
