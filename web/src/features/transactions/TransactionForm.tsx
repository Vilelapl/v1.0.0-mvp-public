import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, errorMessage } from '../../api/client';
import { finance } from '../../api/finance';
import type { CategoryDto, CreateTransactionInput, TransactionDto, TransactionType, UpdateTransactionInput } from '../../api/dtos';
import { CategoryOptions } from '../categories/CategoryOptions';
import { fromLimaInput, sourceLabels, statusLabels, toLimaInput, validAmount } from './format';

export function TransactionForm({ transaction, categories, close, saved }: {
  transaction: TransactionDto | null; categories: CategoryDto[]; close: () => void; saved: (confirmed: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [amount, setAmount] = useState(transaction?.amount ?? '');
  const [currency, setCurrency] = useState(transaction?.currency ?? '');
  const [occurredAt, setOccurredAt] = useState(() => toLimaInput(transaction?.occurredAt ?? new Date().toISOString()));
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense');
  const [account, setAccount] = useState(transaction?.account ?? '');
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialog.current?.showModal();
    amountInput.current?.focus();
    return () => {
      request.current?.abort();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || uncertain) return;
    setError('');
    if (!validAmount(amount)) { setError('Introduce un monto positivo, con hasta 12 enteros y 2 decimales. Usa punto decimal.'); return; }
    if (currency.trim() && !/^[A-Z]{3}$/.test(currency.trim())) { setError('La moneda debe tener tres letras mayúsculas, por ejemplo PEN o USD.'); return; }
    let instant: string;
    try { instant = fromLimaInput(occurredAt); }
    catch { setError('Introduce una fecha y hora válidas de Lima.'); return; }
    const input: CreateTransactionInput = {
      amount: amount.trim(), currency: currency.trim() || null, occurredAt: instant,
      description: description.trim() || null, type, account: account.trim() || null, categoryId: categoryId || null,
    };
    const patch: UpdateTransactionInput = {};
    if (transaction) {
      // Omit unchanged fields; editing a category must preserve the original instant, including milliseconds.
      if (input.amount !== transaction.amount) patch.amount = input.amount;
      if (input.currency !== transaction.currency) patch.currency = input.currency;
      if (input.occurredAt !== transaction.occurredAt) patch.occurredAt = input.occurredAt;
      if (input.description !== transaction.description) patch.description = input.description;
      if (input.type !== transaction.type) patch.type = input.type;
      if (input.account !== transaction.account) patch.account = input.account;
      if (input.categoryId !== transaction.categoryId) patch.categoryId = input.categoryId;
      if (!Object.keys(patch).length) { close(); return; }
    }
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      if (transaction) await finance.update(transaction.id, patch, controller.signal);
      else await finance.create(input, controller.signal);
      if (!controller.signal.aborted) saved(true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && ['TIMEOUT', 'NETWORK_ERROR', 'INVALID_RESPONSE'].includes(error.code)) {
        setUncertain(true);
        setError('No se pudo confirmar el guardado. Actualiza los movimientos para comprobar si se registró antes de volver a enviarlo.');
      } else setError(errorMessage(error));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <dialog ref={dialog} className="transaction-dialog" aria-labelledby="form-title" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-heading"><div><p className="eyebrow">MOVIMIENTOS</p><h2 id="form-title">{transaction ? 'Editar movimiento' : 'Nuevo movimiento'}</h2></div><button type="button" className="quiet" onClick={close} disabled={busy} aria-label="Cerrar formulario">✕</button></div>
    {transaction && <p className="record-origin">{sourceLabels[transaction.source]} · {statusLabels[transaction.processingStatus]}</p>}
    <form onSubmit={(event) => { void submit(event); }}>
      <fieldset disabled={busy || uncertain}>
        <div className="form-grid">
          <div><label htmlFor="amount">Monto</label><input ref={amountInput} id="amount" type="text" inputMode="decimal" required maxLength={15} value={amount} onChange={(e) => setAmount(e.target.value)} aria-describedby="amount-help" /><small id="amount-help">Positivo, hasta 2 decimales. Ej. 24.90</small></div>
          <div><label htmlFor="currency">Moneda</label><input id="currency" type="text" maxLength={3} list="currencies" placeholder="Sin moneda" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} aria-describedby="currency-help" /><datalist id="currencies"><option value="PEN" /><option value="USD" /><option value="EUR" /></datalist><small id="currency-help">Vacío si no está especificada.</small></div>
          <div className="span-two"><label htmlFor="occurred-at">Fecha / hora (Lima)</label><input id="occurred-at" type="datetime-local" step="0.001" min="0001-01-01T00:00" max="9999-12-30T23:59:59.999" required value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} /></div>
          <div className="span-two"><label htmlFor="description">Descripción / comercio</label><input id="description" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div><label htmlFor="transaction-type">Tipo</label><select id="transaction-type" value={type} onChange={(e) => { if (e.target.value === 'income' || e.target.value === 'expense') setType(e.target.value); }}><option value="expense">Gasto</option><option value="income">Ingreso</option></select></div>
          <div><label htmlFor="transaction-category">Categoría</label><select id="transaction-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><CategoryOptions categories={categories} /></select></div>
          <div className="span-two"><label htmlFor="account">Cuenta</label><input id="account" maxLength={120} placeholder="Ej. IO crédito" value={account} onChange={(e) => setAccount(e.target.value)} /></div>
        </div>
      </fieldset>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancelar</button>
        {uncertain ? <button type="button" className="primary" onClick={() => saved(false)}>Actualizar movimientos</button> : <button type="submit" className="primary" disabled={busy}>{busy ? 'Guardando…' : transaction ? 'Guardar cambios' : 'Crear movimiento'}</button>}
      </div>
    </form>
  </dialog>;
}
