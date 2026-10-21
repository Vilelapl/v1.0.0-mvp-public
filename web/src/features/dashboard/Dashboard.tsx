import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { finance } from '../../api/finance';
import type { CategoryDto, CurrencySummary, DateRange, TransactionDto, TransactionPage } from '../../api/dtos';
import { Brand } from '../../components/Brand';
import { Loading, RequestError } from '../../components/RequestState';
import { useAuth } from '../auth/AuthProvider';
import { Filters } from '../transactions/Filters';
import type { FiltersValue } from '../transactions/Filters';
import { TransactionForm } from '../transactions/TransactionForm';
import { TransactionList } from '../transactions/TransactionList';
import { Summary } from './Summary';
import { useCalendarMonth } from './month';
import { BillingCycleSection } from '../billing/BillingCycleSection';

type Remote<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; data: T };
interface FinancialData { summary: CurrencySummary[]; transactions: TransactionPage }
export function Dashboard() {
  const { session, logout } = useAuth();
  const [filters, setFilters] = useState<FiltersValue>({});
  const [range, setRange] = useState<DateRange>({});
  const month = useCalendarMonth();
  const hasDateFilter = Boolean(range.from || range.to);
  const summaryRange = hasDateFilter ? range : month;
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [categoryRevision, setCategoryRevision] = useState(0);
  const [categories, setCategories] = useState<Remote<CategoryDto[]>>({ status: 'loading' });
  const [data, setData] = useState<Remote<FinancialData>>({ status: 'loading' });
  const [editor, setEditor] = useState<{ transaction: TransactionDto | null } | null>(null);
  const [notice, setNotice] = useState('');
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setCategories({ status: 'loading' });
    void finance.categories(controller.signal).then(({ data }) => {
      if (!controller.signal.aborted) setCategories({ status: 'success', data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setCategories({ status: 'error', message: `No se pudieron cargar las categorías. ${errorMessage(error)}` });
    });
    return () => controller.abort();
  }, [categoryRevision]);
  useEffect(() => {
    const controller = new AbortController();
    setData({ status: 'loading' });
    // Commit both views together, and discard responses for previous filters or sessions.
    void Promise.all([
      finance.summary({ from: summaryRange.from, to: summaryRange.to }, controller.signal),
      finance.transactions({ ...filters, page, pageSize: 20 }, controller.signal),
    ]).then(([summary, transactions]) => {
      if (!controller.signal.aborted) setData({ status: 'success', data: { summary: summary.data, transactions } });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setData({ status: 'error', message: `No se pudieron cargar los movimientos y el resumen. ${errorMessage(error)}` });
    });
    return () => controller.abort();
  }, [filters, summaryRange, page, revision]);
  function refresh() { setRevision((value) => value + 1); }
  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true); setLogoutError('');
    try { await logout(); }
    catch (error) { setLogoutError(errorMessage(error)); setLoggingOut(false); }
  }
  const categoryList = categories.status === 'success' ? categories.data : [];
  const edit = (transaction: TransactionDto) => {
    if (categories.status === 'success') { setNotice(''); setEditor({ transaction }); }
    else setNotice('Carga las categorías antes de editar un movimiento.');
  };
  return <>
    <a className="skip-link" href="#main">Ir al contenido</a>
    <header className="topbar"><div className="topbar-inner"><Brand /><div className="session-controls"><span>{session.status === 'authenticated' ? session.user.email : ''}</span><button disabled={loggingOut} onClick={() => { void signOut(); }}>{loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</button></div></div></header>
    <main id="main" className="dashboard">
      <div className="page-heading"><div><p className="eyebrow">VISTA GENERAL</p><h1>Mis movimientos</h1><p className="muted">Tus ingresos y gastos, con su origen a la vista.</p></div><div className="actions"><button onClick={refresh} disabled={data.status === 'loading'}>Actualizar</button><button className="primary" disabled={categories.status !== 'success' || loggingOut} onClick={() => { setNotice(''); setEditor({ transaction: null }); }}>+ Nuevo movimiento</button></div></div>
      {logoutError && <p className="error" role="alert">{logoutError}</p>}
      {notice && <p role="status" className="success">{notice}</p>}
      <section aria-labelledby="summary-title"><div className="section-heading"><h2 id="summary-title">Resumen financiero</h2><span className="muted">{hasDateFilter ? 'Período seleccionado' : `${month.label} · Mes completo`}</span></div>
        <p className="summary-scope">{hasDateFilter ? 'Totales de las fechas seleccionadas.' : 'Totales del día 1 al último día del mes actual.'} Categoría, tipo y cuenta filtran solo la lista.</p>
        {data.status === 'loading' && <Loading>Cargando resumen y movimientos…</Loading>}
        {data.status === 'error' && <RequestError message={data.message} retry={refresh} />}
        {data.status === 'success' && <Summary totals={data.data.summary} />}
        <p className="duplicate-note"><span aria-hidden="true">ⓘ</span> Los movimientos pueden incluir registros provenientes de distintas fuentes que representen una misma operación. Los totales reflejan los registros, sin conciliación entre fuentes.</p>
      </section>
      {categories.status === 'loading' && <Loading>Cargando categorías…</Loading>}
      {categories.status === 'error' && <RequestError message={categories.message} retry={() => setCategoryRevision((value) => value + 1)} />}
      {categories.status === 'success' && !categories.data.length && <p className="muted">No hay categorías disponibles. Puedes guardar movimientos sin categoría.</p>}
      <BillingCycleSection categories={categoryList} categoriesReady={categories.status === 'success'} revision={revision} edit={edit} />
      <section className="panel movements" aria-labelledby="transactions-title"><div className="section-heading"><h2 id="transactions-title">Transacciones</h2><span className="muted">Fecha / hora de Lima</span></div>
        <Filters categories={categoryList} categoriesReady={categories.status === 'success'} apply={(filters, range) => { setFilters(filters); setRange(range); setPage(1); setNotice(''); }} />
        {data.status === 'loading' && <Loading>Cargando movimientos…</Loading>}
        {data.status === 'error' && <p className="request-state">La lista estará disponible al reintentar la carga.</p>}
        {data.status === 'success' && <TransactionList result={data.data.transactions} categories={categoryList}
          edit={edit} changePage={setPage} />}
      </section>
      <footer className="dashboard-footer">Gestor Financiero <span>Los importes se muestran por moneda, sin conversión.</span></footer>
    </main>
    {editor && <TransactionForm transaction={editor.transaction} categories={categoryList} close={() => setEditor(null)} saved={(confirmed) => {
      setEditor(null); setPage(1); refresh();
      setNotice(confirmed ? 'Movimiento guardado. Se están actualizando la lista y el resumen.' : 'Comprueba en la lista si el movimiento se guardó.');
    }} />}
  </>;
}
