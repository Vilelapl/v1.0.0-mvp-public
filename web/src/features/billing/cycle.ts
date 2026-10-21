import { Temporal } from '@js-temporal/polyfill';
import { fromLimaInput, TIME_ZONE } from '../transactions/format';

export const IO_ACCOUNT = 'IO crédito';
export interface BillingCycle {
  from: string;
  to: string;
  firstDay: string;
  lastDay: string;
  label: string;
}
export function currentBillingCycle(instant = new Date().toISOString()): BillingCycle {
  const today = Temporal.Instant.from(instant).toZonedDateTimeISO(TIME_ZONE).toPlainDate();
  const month = today.day >= 26 ? today : today.subtract({ months: 1 });
  const first = month.with({ day: 26 });
  const end = first.add({ months: 1 });
  const last = end.subtract({ days: 1 });
  const format = (day: Temporal.PlainDate) => day.toLocaleString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' });
  return {
    from: fromLimaInput(`${first}T00:00:00`),
    to: fromLimaInput(`${end}T00:00:00`),
    firstDay: first.toString(),
    lastDay: last.toString(),
    label: `${format(first)} — ${format(last)}`,
  };
}
