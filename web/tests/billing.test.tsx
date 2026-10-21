import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { BillingCycleSection } from '../src/features/billing/BillingCycleSection';
import { currentBillingCycle, IO_ACCOUNT } from '../src/features/billing/cycle';
import { categories, failure, json, mockServer, transaction } from './fixtures';

describe('ciclo de facturación en Lima', () => {
  it.each([
    ['2026-09-26T04:59:59.999Z', '2026-08-26', '2026-09-25'],
    ['2026-09-26T05:00:00.000Z', '2026-09-26', '2026-10-25'],
    ['2026-09-13T12:00:00.000Z', '2026-08-26', '2026-09-25'],
    ['2027-01-01T02:00:00.000Z', '2026-12-26', '2027-01-25'],
    ['2024-02-29T12:00:00.000Z', '2024-02-26', '2024-03-25'],
    ['2026-02-25T12:00:00.000Z', '2026-01-26', '2026-02-25'],
  ])('%s pertenece a %s / %s', (instant, firstDay, lastDay) => {
    const cycle = currentBillingCycle(instant);
    expect(cycle).toMatchObject({ firstDay, lastDay, from: `${firstDay}T05:00:00.000Z` });
    expect(cycle.to).toBe(`${lastDay.slice(0, 8)}26T05:00:00.000Z`);
  });
});

function mount(revision = 0) {
  return render(<BillingCycleSection categories={categories} categoriesReady revision={revision} edit={vi.fn()} />);
}
const cardTotals = [{ currency: 'PEN', income: '0.00', expenses: '1500.30', balance: '-1500.30' },
  { currency: 'USD', income: '0.00', expenses: '20.10', balance: '-20.10' }];
function billingServer() {
  return mockServer((url) => {
    if (url.pathname.endsWith('/summary')) return json({ data: cardTotals });
    if (url.pathname.endsWith('/transactions')) return json({
      data: [transaction, { ...transaction, id: 'wallet', source: 'google_wallet_notification' }],
      meta: { page: Number(url.searchParams.get('page')), pageSize: 20, total: 45 },
    });
    return undefined;
  }, true);
}

describe('sección iO', () => {
  it('consulta gastos de la cuenta exacta y muestra totales completos separados, sin sumar la página', async () => {
    const mock = billingServer(); mount();
    await screen.findByRole('table', { name: 'Gastos del ciclo iO' });
    const totals = screen.getByLabelText('Totales del ciclo iO');
    expect(totals).toHaveTextContent('1,500.30 PEN'); expect(totals).toHaveTextContent('20.10 USD');
    expect(totals).not.toHaveTextContent('Ingresos');
    const expected = { from: currentBillingCycle().from, to: currentBillingCycle().to, account: IO_ACCOUNT, type: 'expense' };
    for (const [url] of mock.mock.calls) {
      const parsed = new URL(String(url), 'http://localhost');
      expect(Object.fromEntries(parsed.searchParams)).toMatchObject(expected);
    }
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('IO')).toBeInTheDocument(); expect(screen.getByText('Google Wallet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tipo')).not.toBeInTheDocument(); expect(screen.queryByLabelText('Cuenta')).not.toBeInTheDocument();
    expect(screen.getAllByText('24.90')[0]).toHaveClass('expense');
  });
  it('filtra y pagina independientemente sin cambiar el total completo del ciclo', async () => {
    const mock = billingServer(); mount(); await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Página siguiente del ciclo iO' }));
    await screen.findByText('45 gastos · Página 2 de 3');
    await userEvent.selectOptions(screen.getByLabelText('Categoría del ciclo'), categories[0]!.id);
    fireEvent.change(screen.getByLabelText('Desde (ciclo iO)'), { target: { value: currentBillingCycle().lastDay } });
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar ciclo' }));
    await screen.findByText('45 gastos · Página 1 de 3');
    const urls = mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    expect(urls.filter((url) => url.pathname.endsWith('/summary'))).toHaveLength(1);
    expect(Object.fromEntries(urls.at(-1)!.searchParams)).toMatchObject({ page: '1', categoryId: categories[0]!.id, account: IO_ACCOUNT, type: 'expense', from: `${currentBillingCycle().lastDay}T05:00:00.000Z`, to: currentBillingCycle().to });
    expect(screen.getByLabelText('Totales del ciclo iO')).toHaveTextContent('1,500.30');
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar ciclo' })); await screen.findByRole('table');
    expect(screen.getByLabelText('Desde (ciclo iO)')).toHaveValue('');
  });
  it('impide filtros fuera del ciclo y rangos invertidos', async () => {
    const mock = billingServer(); mount(); await screen.findByRole('table');
    const form = screen.getByRole('form', { name: 'Filtros del ciclo iO' });
    fireEvent.change(screen.getByLabelText('Desde (ciclo iO)'), { target: { value: '2000-01-01' } });
    fireEvent.submit(form); expect(screen.getByRole('alert')).toHaveTextContent('dentro del ciclo');
    fireEvent.change(screen.getByLabelText('Desde (ciclo iO)'), { target: { value: currentBillingCycle().lastDay } });
    fireEvent.change(screen.getByLabelText('Hasta (ciclo iO, inclusive)'), { target: { value: currentBillingCycle().firstDay } });
    fireEvent.submit(form); expect(screen.getByRole('alert')).toHaveTextContent('Revisa las fechas');
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('maneja carga, error y reintento sin presentar totales incompletos como cero', async () => {
    let release: ((response: Response) => void) | undefined;
    let fail = true;
    mockServer((url) => url.pathname.endsWith('/summary') ? fail ? new Promise((resolve) => { release = resolve; }) : json({ data: cardTotals }) : undefined, true);
    mount(); expect(screen.getByText('Cargando gastos del ciclo…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Totales del ciclo iO')).not.toBeInTheDocument();
    await act(async () => release?.(failure(500)));
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los totales del ciclo');
    fail = false; await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Totales del ciclo iO')).toHaveTextContent('1,500.30');
  });
  it('muestra cero para PEN/USD vacíos y mantiene monedas desconocidas aparte', async () => {
    mockServer((url) => url.pathname.endsWith('/summary') ? json({ data: [{ currency: null, expenses: '3.20', income: '0.00', balance: '-3.20' }] }) : json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }), true);
    mount(); const totals = await screen.findByLabelText('Totales del ciclo iO');
    expect(totals).toHaveTextContent('0.00 PEN'); expect(totals).toHaveTextContent('0.00 USD'); expect(totals).toHaveTextContent('3.20 Sin moneda');
    expect(screen.getByText('No hay gastos de iO para estos filtros.')).toBeInTheDocument();
  });
  it('recarga lista y totales al guardar una mutación en el dashboard', async () => {
    const mock = billingServer(); const view = mount(); await screen.findByRole('table');
    view.rerender(<BillingCycleSection categories={categories} categoriesReady revision={1} edit={vi.fn()} />);
    await screen.findByRole('table');
    expect(mock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/summary'))).toHaveLength(2);
    expect(mock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/transactions'))).toHaveLength(2);
  });
  it('cambia automáticamente de ciclo a medianoche de Lima del día 26', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T04:59:59.000Z'));
    const mock = billingServer(); mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    const summaryUrls = mock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/summary'));
    expect(new URL(String(summaryUrls.at(-1)?.[0]), 'http://localhost').searchParams.get('from')).toBe('2026-09-26T05:00:00.000Z');
    expect(screen.getByLabelText('Desde (ciclo iO)')).toHaveAttribute('min', '2026-09-26');
  });
  it('está antes de Transacciones, con filtros integrados y sin compartir estado', async () => {
    const mock = mockServer(); render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
    await screen.findByRole('table', { name: 'Transacciones' });
    const general = screen.getByRole('region', { name: 'Transacciones' });
    const billing = screen.getByRole('region', { name: 'Ciclo de facturación actual' });
    expect(within(general).getByRole('form', { name: 'Filtros de transacciones' })).toBeInTheDocument();
    expect(billing.compareDocumentPosition(general) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = mock.mock.calls.filter(([url]) => new URL(String(url), 'http://localhost').searchParams.get('account') === IO_ACCOUNT).length;
    await userEvent.selectOptions(within(general).getByLabelText('Tipo'), 'income');
    await userEvent.click(within(general).getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(within(general).getByRole('table')).toBeInTheDocument());
    expect(mock.mock.calls.filter(([url]) => new URL(String(url), 'http://localhost').searchParams.get('account') === IO_ACCOUNT)).toHaveLength(before);
    expect(within(general).getByText('24.90')).toHaveClass('expense');
  });
});
