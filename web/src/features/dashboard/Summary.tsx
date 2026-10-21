import type { CurrencySummary } from '../../api/dtos';
import { formatAmount } from '../transactions/format';

export function Summary({ totals }: { totals: CurrencySummary[] }) {
  if (!totals.length) return <div className="panel empty"><p>No hay movimientos en este período.</p><span className="muted">El resumen aparecerá cuando registres un movimiento.</span></div>;
  return <div className="summary-groups">{totals.map((total) => <section className="currency-summary" key={total.currency ?? 'unknown'} aria-label={`Resumen ${total.currency ?? 'sin moneda'}`}>
    <h3>{total.currency ?? 'Moneda no especificada'}{total.currency === null && <span className="muted"> · Registros separados</span>}</h3>
    <dl className="summary-grid">
      <div className="metric balance"><dt>Balance registrado</dt><dd>{formatAmount(total.balance)} <span>{total.currency ?? 'Sin moneda'}</span></dd></div>
      <div className="metric"><dt>Ingresos</dt><dd className="income">{formatAmount(total.income)} <span>{total.currency ?? 'Sin moneda'}</span></dd></div>
      <div className="metric"><dt>Gastos</dt><dd>{formatAmount(total.expenses)} <span>{total.currency ?? 'Sin moneda'}</span></dd></div>
    </dl>
  </section>)}</div>;
}
