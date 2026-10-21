import type { CategoryDto, TransactionDto, TransactionPage } from '../../api/dtos';
import { formatAmount, formatDate, sourceLabels, statusLabels, typeLabels } from './format';

export function TransactionList({ result, categories, edit, changePage, billing = false }: {
  result: TransactionPage; categories: CategoryDto[]; edit: (transaction: TransactionDto) => void;
  changePage: (page: number) => void;
  billing?: boolean;
}) {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const pages = Math.max(1, Math.ceil(result.meta.total / result.meta.pageSize));
  return <>
    {result.data.length === 0 ? <div className="empty"><h3>{billing ? 'No hay gastos de iO para estos filtros.' : 'No hay movimientos para estos filtros.'}</h3><p className="muted">{billing ? 'Aquí aparecerán los gastos registrados en IO crédito durante este ciclo.' : 'Prueba otro período o registra un movimiento manual.'}</p></div> :
      <div className="table-scroll" role="region" aria-label={billing ? 'Lista del ciclo iO' : 'Lista de transacciones'} tabIndex={0}>
        <table aria-label={billing ? 'Gastos del ciclo iO' : 'Transacciones'}><caption className="sr-only">Movimientos financieros. Fecha y hora de Lima.</caption>
          <thead><tr><th scope="col">Fecha / hora</th><th scope="col">Descripción / comercio</th><th scope="col">Monto / moneda</th><th scope="col">Tipo</th><th scope="col">Categoría</th><th scope="col">Cuenta</th><th scope="col">Fuente</th><th scope="col">Procesamiento</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody>{result.data.map((transaction) => <tr key={transaction.id}>
            <td><time dateTime={transaction.occurredAt}>{formatDate(transaction.occurredAt)}</time></td>
            <td className="description">{transaction.description ?? <span className="muted">Sin descripción</span>}</td>
            <td className="amount"><strong className={transaction.type === 'income' ? 'income' : 'expense'}>{formatAmount(transaction.amount)}</strong><span className="currency">{transaction.currency ?? 'Sin moneda'}</span></td>
            <td>{typeLabels[transaction.type]}</td>
            <td>{transaction.categoryId === null ? <span className="muted">Sin categoría</span> : categoryNames.get(transaction.categoryId) ?? 'Categoría no disponible'}</td>
            <td>{transaction.account ?? <span className="muted">Sin cuenta</span>}</td>
            <td><span className="source-badge">{sourceLabels[transaction.source]}</span></td>
            <td><span className="processing">{statusLabels[transaction.processingStatus]}</span></td>
            <td><button className="edit-button" onClick={() => edit(transaction)} aria-label={`Editar ${transaction.description ?? 'movimiento'} del ${formatDate(transaction.occurredAt)}`}>Editar</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
    <nav className="pagination" aria-label={billing ? 'Paginación del ciclo iO' : 'Paginación de movimientos'}><span>{result.meta.total} {billing ? 'gastos' : 'movimientos'} · Página {result.meta.page} de {pages}</span><div className="actions">
      <button aria-label={billing ? 'Página anterior del ciclo iO' : undefined} disabled={result.meta.page <= 1} onClick={() => changePage(result.meta.page - 1)}>Anterior</button>
      <button aria-label={billing ? 'Página siguiente del ciclo iO' : undefined} disabled={result.meta.page >= pages} onClick={() => changePage(result.meta.page + 1)}>Siguiente</button>
    </div></nav>
  </>;
}
