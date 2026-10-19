let tz = 'America/Sao_Paulo';
export const setTimezone = (t: string) => (tz = t);
export const getTimezone = () => tz;

const f = (o: Intl.DateTimeFormatOptions) => (d: string | Date | null | undefined) => (d ? new Intl.DateTimeFormat('pt-BR', { timeZone: tz, ...o }).format(new Date(d)) : '—');
export const fmtDate = f({ day: '2-digit', month: '2-digit', year: 'numeric' });
export const fmtTime = f({ hour: '2-digit', minute: '2-digit' });
export const fmtDateTime = f({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtLong = f({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const fmtHours = (h: number) => `${String(h).replace('.', ',')} h`;

/** Converte ISO para o valor de <input type="datetime-local"> no fuso do município. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)?.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/** Converte o valor de datetime-local (horário do município) para ISO UTC. */
export function fromLocalInput(v: string) {
  if (!v) return '';
  const [d, t] = v.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, hh, mm);
  // offset do fuso no instante estimado
  const offset = (instant: number) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - instant;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first)).toISOString();
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [29, 78, 216];
}

/** Escolhe texto branco ou preto conforme o contraste (WCAG) com a cor de fundo. */
export function readableOn(hex: string) {
  const lum = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '255 255 255' : '15 23 42';
}
