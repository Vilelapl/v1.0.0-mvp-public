import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { finance } from '../../api/finance';
import type { CategoryDto, CurrencySummary, TransactionDto, TransactionPage } from '../../api/dtos';
import { Loading, RequestError } from '../../components/RequestState';
import { Filters } from '../transactions/Filters';
import type { FiltersValue } from '../transactions/Filters';
import { TransactionList } from '../transactions/TransactionList';
import { formatAmount, millisecondsUntilLimaMidnight } from '../transactions/format';
import { currentBillingCycle, IO_ACCOUNT } from './cycle';
import type { BillingCycle } from './cycle';

type Remote<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; data: T };
interface Props {
  categories: CategoryDto[];
  categoriesReady: boolean;
  revision: number;
  edit: (transaction: TransactionDto) => void;
}

export function BillingCycleSection(props: Props) {
  const [cycle, setCycle] = useState(currentBillingCycle);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const next = currentBillingCycle();
      setCycle((previous) => previous.from === next.from ? previous : next);
      clearTimeout(timer);
      timer = setTimeout(update, millisecondsUntilLimaMidnight());
    };
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  // A new cycle starts with its own clean filters, page and data.
  return <CycleContents key={cycle.from} {...props} cycle={cycle} />;
}

function CycleContents({ categories, categoriesReady, revision, edit, cycle }: Props & { cycle: BillingCycle }) {
  const [filters, setFilters] = useState<FiltersValue>({});
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [totals, setTotals] = useState<Remote<CurrencySummary[]>>({ status: 'loading' });
  const [rows, setRows] = useState<Remote<TransactionPage>>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setTotals({ status: 'loading' });
    // The mini dashboard always covers ALL cycle expenses, regardless of list filters/page.
    void finance.summary({ from: cycle.from, to: cycle.to, account: IO_ACCOUNT, type: 'expense' }, controller.signal)
      .then(({ data }) => { if (!controller.signal.aborted) setTotals({ status: 'success', data }); })
      .catch((error: unknown) => { if (!controller.signal.aborted) setTotals({ status: 'error', message: errorMessage(error) }); });
    return () => controller.abort();
  }, [cycle.from, cycle.to, revision, retry]);

  useEffect(() => {
    const controller = new AbortController();
    setRows({ status: 'loading' });
    void finance.transactions({
      from: filters.from ?? cycle.from, to: filters.to ?? cycle.to,
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      account: IO_ACCOUNT, type: 'expense', page, pageSize: 20,
    }, controller.signal).then((data) => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(data.meta.total / data.meta.pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows({ status: 'success', data });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setRows({ status: 'error', message: errorMessage(error) }); });
    return () => controller.abort();
  }, [cycle.from, cycle.to, filters, page, revision, retry]);

  const reload = () => setRetry((value) => value + 1);
  const currencies: Array<string | null> = ['PEN', 'USD'];
  if (totals.status === 'success') for (const total of totals.data) {
    if (!currencies.includes(total.currency)) currencies.push(total.currency);
  }
  return <section className="panel movements billing-cycle" aria-labelledby="billing-title">
    <div className="section-heading billing-heading"><div><p className="eyebrow">TARJETA DE CRÉDITO iO</p><h2 id="billing-title">Ciclo de facturación actual</h2><p className="billing-period">{cycle.label}</p></div><span className="billing-badge">Solo gastos · Del 26 al 25</span></div>
    <div className="billing-overview">
      <p className="summary-scope">Todos los gastos del ciclo. Los filtros de abajo solo cambian la lista.</p>
      {totals.status === 'loading' && <Loading>Cargando gastos del ciclo…</Loading>}
      {totals.status === 'error' && <RequestError message={`No se pudieron cargar los totales del ciclo. ${totals.message}`} retry={reload} />}
      {totals.status === 'success' && <dl className="billing-totals" aria-label="Totales del ciclo iO">{currencies.map((currency) => {
        const total = totals.data.find((row) => row.currency === currency);
        const label = currency === 'PEN' ? 'Gastos en soles' : currency === 'USD' ? 'Gastos en dólares' : currency === null ? 'Gastos sin moneda' : `Gastos en ${currency}`;
        return <div className="metric" key={currency ?? 'unknown'}><dt>{label}</dt><dd className="expense">{formatAmount(total?.expenses ?? '0.00')} <span>{currency ?? 'Sin moneda'}</span></dd></div>;
      })}</dl>}
      <p className="billing-note">Cuenta: {IO_ACCOUNT}. Incluye sus registros de todas las fuentes; una misma operación puede aparecer más de una vez.</p>
    </div>
    <Filters categories={categories} categoriesReady={categoriesReady} cycle={cycle} apply={(value) => { setFilters(value); setPage(1); }} />
    {rows.status === 'loading' && <Loading>Cargando movimientos del ciclo…</Loading>}
    {rows.status === 'error' && <RequestError message={`No se pudieron cargar los gastos de iO. ${rows.message}`} retry={reload} />}
    {rows.status === 'success' && <TransactionList result={rows.data} categories={categories} edit={edit} changePage={setPage} billing />}
  </section>;
}
