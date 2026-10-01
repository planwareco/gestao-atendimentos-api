/**
 * Datas: o banco guarda UTC; o fuso do negócio (ex.: America/Sao_Paulo)
 * define o que é "hoje", "mês" e "horário de trabalho".
 */

/** 'YYYY-MM-DD' -> Date (meia-noite UTC), para colunas @db.Date */
export const parseDateOnly = (s) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Date (@db.Date) -> 'YYYY-MM-DD' */
export const formatDateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Partes de data/hora de um instante em um fuso. */
export function partsInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: weekdays[p.weekday],
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Diferença (ms) entre o fuso e UTC naquele instante. */
function tzOffsetMs(date, timeZone) {
  const p = partsInTz(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, date.getUTCSeconds());
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converte data local ('YYYY-MM-DD') + hora local ('HH:mm') de um fuso para um instante UTC. */
export function zonedToUtc(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMs(guess, timeZone);
  const result = new Date(guess.getTime() - offset);
  // segunda passada cobre mudanças de horário de verão
  const offset2 = tzOffsetMs(result, timeZone);
  return offset2 === offset ? result : new Date(guess.getTime() - offset2);
}

/** Início e fim (exclusivo) de um dia local em UTC. */
export function dayRangeUtc(dateStr, timeZone) {
  const inicio = zonedToUtc(dateStr, '00:00', timeZone);
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { inicio, fim: zonedToUtc(next, '00:00', timeZone) };
}

/** Data local de hoje ('YYYY-MM-DD') no fuso. */
export const todayInTz = (timeZone) => partsInTz(new Date(), timeZone).date;

export const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
