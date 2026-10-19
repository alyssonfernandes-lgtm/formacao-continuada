/** Formata datas no fuso configurado do município. */
export function fmtDate(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));
}
export function fmtTime(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
}
export function fmtDateTime(d: Date | string, tz: string) {
  return `${fmtDate(d, tz)} ${fmtTime(d, tz)}`;
}
export function fmtLongDate(d: Date | string, tz: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
}
/** Período de realização: "10/03/2026" ou "10/03/2026 a 12/03/2026". */
export function fmtPeriod(start: Date | string, end: Date | string, tz: string) {
  const a = fmtDate(start, tz);
  const b = fmtDate(end, tz);
  return a === b ? a : `${a} a ${b}`;
}
export function fmtHours(h: number) {
  return `${Number.isInteger(h) ? h : h.toFixed(1).replace('.', ',')} ${h === 1 ? 'hora' : 'horas'}`;
}
