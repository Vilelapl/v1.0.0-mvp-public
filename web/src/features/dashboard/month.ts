import { useEffect, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { fromLimaInput, millisecondsUntilLimaMidnight, TIME_ZONE } from '../transactions/format';

export function currentCalendarMonth(instant = new Date().toISOString()) {
  const first = Temporal.Instant.from(instant).toZonedDateTimeISO(TIME_ZONE).toPlainDate().with({ day: 1 });
  return {
    from: fromLimaInput(`${first}T00:00:00`),
    to: fromLimaInput(`${first.add({ months: 1 })}T00:00:00`),
    label: first.toLocaleString('es-PE', { month: 'long', year: 'numeric' }),
  };
}

export function useCalendarMonth() {
  const [month, setMonth] = useState(currentCalendarMonth);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const next = currentCalendarMonth();
      setMonth((previous) => previous.from === next.from ? previous : next);
      clearTimeout(timer);
      // Daily scheduling stays below the browser's maximum timeout for long months.
      timer = setTimeout(update, millisecondsUntilLimaMidnight());
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return month;
}
