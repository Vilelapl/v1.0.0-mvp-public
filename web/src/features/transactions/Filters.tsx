import { useState } from 'react';
import type { FormEvent } from 'react';
import type { CategoryDto, DateRange, TransactionQuery } from '../../api/dtos';
import { CategoryOptions } from '../categories/CategoryOptions';
import { localDateRange } from './format';
import type { BillingCycle } from '../billing/cycle';

export type FiltersValue = Omit<TransactionQuery, 'page' | 'pageSize'>;
export function Filters({ categories, categoriesReady, apply, cycle }: {
  categories: CategoryDto[]; categoriesReady: boolean;
  apply: (filters: FiltersValue, range: DateRange) => void;
  cycle?: BillingCycle;
}) {
  const prefix = cycle ? 'billing' : 'transactions';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [type, setType] = useState('');
  const [account, setAccount] = useState('');
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (cycle && ((from && (from < cycle.firstDay || from > cycle.lastDay)) || (to && (to < cycle.firstDay || to > cycle.lastDay)))) {
        setError('Elige fechas dentro del ciclo de facturación actual.'); return;
      }
      const range = localDateRange(from, to);
      apply({ ...range, ...(categoryId ? { categoryId } : {}),
        ...(type === 'income' || type === 'expense' ? { type } : {}),
        ...(account.trim() ? { account: account.trim() } : {}),
      }, range);
      setError('');
    } catch { setError('Revisa las fechas: el día final debe ser igual o posterior al inicial.'); }
  }
  function reset() {
    setFrom(''); setTo(''); setCategoryId(''); setType(''); setAccount(''); setError(''); apply({}, {});
  }
  return <form className="filters" aria-label={cycle ? 'Filtros del ciclo iO' : 'Filtros de transacciones'} onSubmit={submit}>
      <div className={`filter-grid${cycle ? ' cycle-filter-grid' : ''}`}>
        <div><label htmlFor={`${prefix}-from`}>{cycle ? 'Desde (ciclo iO)' : 'Desde'}</label><input id={`${prefix}-from`} type="date" min={cycle?.firstDay ?? '0001-01-01'} max={cycle?.lastDay ?? '9999-12-30'} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label htmlFor={`${prefix}-to`}>{cycle ? 'Hasta (ciclo iO, inclusive)' : 'Hasta (inclusive)'}</label><input id={`${prefix}-to`} type="date" min={cycle?.firstDay ?? '0001-01-01'} max={cycle?.lastDay ?? '9999-12-30'} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div><label htmlFor={`${prefix}-category`}>{cycle ? 'Categoría del ciclo' : 'Categoría'}</label><select id={`${prefix}-category`} disabled={!categoriesReady} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><CategoryOptions categories={categories} filter /></select></div>
        {!cycle && <><div><label htmlFor="filter-type">Tipo</label><select id="filter-type" value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos los tipos</option><option value="income">Ingreso</option><option value="expense">Gasto</option></select></div>
        <div><label htmlFor="filter-account">Cuenta</label><input id="filter-account" maxLength={120} placeholder="Nombre exacto de la cuenta" value={account} onChange={(e) => setAccount(e.target.value)} /></div></>}
      </div>
      <div className="filter-footer"><p className="muted">{cycle ? 'Días de Lima, dentro del ciclo actual.' : 'Días de Lima. La cuenta se busca por nombre exacto.'}</p><div className="actions"><button type="button" className="quiet" onClick={reset}>{cycle ? 'Limpiar ciclo' : 'Limpiar'}</button><button type="submit">{cycle ? 'Filtrar ciclo' : 'Aplicar filtros'}</button></div></div>
      {error && <p role="alert" className="error">{error}</p>}
    </form>;
}
