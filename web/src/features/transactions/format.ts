import { Temporal } from '@js-temporal/polyfill';
import type { ProcessingStatus, TransactionSource, TransactionType } from '../../api/dtos';

export const TIME_ZONE = 'America/Lima';
export const sourceLabels: Record<TransactionSource, string> = {
  io_notification: 'IO', yape_notification: 'Yape', google_wallet_notification: 'Google Wallet', manual: 'Manual',
};
export const statusLabels: Record<ProcessingStatus, string> = {
  automatic: 'Automático', manually_modified: 'Modificado manualmente', manually_created: 'Creado manualmente',
};
export const typeLabels: Record<TransactionType, string> = { income: 'Ingreso', expense: 'Gasto' };
export function validAmount(amount: string): boolean {
  return /^\d{1,12}(?:\.\d{1,2})?$/.test(amount.trim()) && /[1-9]/.test(amount);
}
// String-only formatting preserves cents even above Number.MAX_SAFE_INTEGER.
// Currency is displayed separately, including the backend's unknown-currency group.
export function formatAmount(amount: string): string {
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(amount)) return amount;
  const [integer = '', fraction = ''] = amount.split('.');
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0')}`;
}
const dateFormatter = new Intl.DateTimeFormat('es-PE', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function formatDate(instant: string): string {
  return dateFormatter.format(new Date(instant));
}
export function toLimaInput(instant: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(TIME_ZONE).toPlainDateTime()
    .toString({ smallestUnit: 'millisecond' });
}
export function fromLimaInput(value: string): string {
  const result = Temporal.PlainDateTime.from(value, { overflow: 'reject' })
    .toZonedDateTime(TIME_ZONE, { disambiguation: 'reject' }).toInstant();
  const iso = result.toString({ smallestUnit: 'millisecond' });
  if (!/^(?!0000)\d{4}-/.test(iso)) throw new RangeError('Fecha fuera de rango');
  return iso;
}
export function localDateRange(fromDay: string, toDay: string): { from?: string; to?: string } {
  if (fromDay && toDay && fromDay > toDay) throw new RangeError('La fecha final debe ser igual o posterior a la inicial.');
  const start = (date: Temporal.PlainDate) => fromLimaInput(`${date.toString()}T00:00:00`);
  return {
    ...(fromDay ? { from: start(Temporal.PlainDate.from(fromDay, { overflow: 'reject' })) } : {}),
    // Backend uses an exclusive upper bound: next local midnight, never 23:59:59.
    ...(toDay ? { to: start(Temporal.PlainDate.from(toDay, { overflow: 'reject' }).add({ days: 1 })) } : {}),
  };
}

export function millisecondsUntilLimaMidnight(): number {
  const now = Temporal.Now.zonedDateTimeISO(TIME_ZONE);
  const next = now.toPlainDate().add({ days: 1 }).toZonedDateTime(TIME_ZONE);
  return next.epochMilliseconds - now.epochMilliseconds + 100;
}
