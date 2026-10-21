import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import { currentCalendarMonth } from '../src/features/dashboard/month';
import { categories, json, mockServer, transaction } from './fixtures';

// In-memory API responses only. Amounts are anonymized, as in the Android
// fixtures; these are neither real balances nor records to upload anywhere.
const yapes = [1709568977123, 1709568331321].map((postTime, index) => ({
  ...transaction, id: `yape-test-${index}`, amount: '1.10', currency: 'PEN',
  occurredAt: new Date(postTime).toISOString(), description: null, account: null,
  source: 'yape_notification' as const, type: 'income' as const,
}));
function setup() {
  const mock = mockServer((url, init) => {
    if (init.method === 'PATCH') return json({ data: { ...yapes[0], ...JSON.parse(String(init.body)) } });
    if (url.pathname.endsWith('/transactions')) return json({ data: yapes, meta: { page: 1, pageSize: 20, total: yapes.length } });
    if (url.pathname.endsWith('/summary')) return json({ data: [{ currency: 'PEN', income: '2.20', expenses: '0.00', balance: '2.20' }] });
    return undefined;
  });
  render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>);
  return mock;
}

describe('compatibilidad con ingresos decimales de Yape', () => {
  it('presenta ingresos independientes con precisión, fecha de publicación y opcionales null', async () => {
    const mock = setup();
    const table = await screen.findByRole('table', { name: 'Transacciones' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByText('Yape')).toHaveLength(2);
    expect(within(table).getAllByText('Sin descripción')).toHaveLength(2);
    expect(within(table).getAllByText('Sin cuenta')).toHaveLength(2);
    expect(within(table).getAllByText('Ingreso')).toHaveLength(2);
    for (const amount of within(table).getAllByText('1.10')) expect(amount).toHaveClass('income');
    const dates = table.querySelectorAll('time');
    expect(Array.from(dates, (date) => date.getAttribute('datetime'))).toEqual(yapes.map((row) => row.occurredAt));
    expect(dates[0]).toHaveTextContent('04/03/2024, 11:16');
    expect(dates[1]).toHaveTextContent('04/03/2024, 11:05');
    expect(screen.getByRole('region', { name: 'Resumen PEN' })).toHaveTextContent('Ingresos2.20 PEN');
    expect(screen.getByRole('region', { name: 'Ciclo de facturación actual' })).not.toHaveTextContent('Yape');
    const urls = mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    const generalSummary = urls.find((url) => url.pathname.endsWith('/summary') && !url.searchParams.has('account'))!;
    const month = currentCalendarMonth();
    expect(Object.fromEntries(generalSummary.searchParams)).toEqual({ from: month.from, to: month.to });
    for (const url of urls.filter((url) => url.searchParams.get('account') === 'IO crédito')) {
      expect(url.searchParams.get('type')).toBe('expense');
    }
  });

  it('filtra ingresos por día de Lima sin exigir cuenta o descripción', async () => {
    const mock = setup(); await screen.findByRole('table', { name: 'Transacciones' });
    const list = screen.getByRole('region', { name: 'Transacciones' });
    fireEvent.change(within(list).getByLabelText('Desde'), { target: { value: '2024-03-04' } });
    fireEvent.change(within(list).getByLabelText('Hasta (inclusive)'), { target: { value: '2024-03-04' } });
    await userEvent.selectOptions(within(list).getByLabelText('Tipo'), 'income');
    await userEvent.click(within(list).getByRole('button', { name: 'Aplicar filtros' }));
    await within(list).findByRole('table');
    const urls = mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    expect(Object.fromEntries(urls.filter((url) => url.pathname.endsWith('/transactions')).at(-1)!.searchParams)).toEqual({
      from: '2024-03-04T05:00:00.000Z', to: '2024-03-05T05:00:00.000Z', type: 'income', page: '1', pageSize: '20',
    });
    expect(Object.fromEntries(urls.filter((url) => url.pathname.endsWith('/summary')).at(-1)!.searchParams)).toEqual({
      from: '2024-03-04T05:00:00.000Z', to: '2024-03-05T05:00:00.000Z',
    });
  });

  it('editar categoría preserva el importe, postTime, origen y opcionales vacíos', async () => {
    const mock = setup();
    const table = await screen.findByRole('table', { name: 'Transacciones' });
    await userEvent.click(within(table).getAllByRole('button', { name: /^Editar / })[0]!);
    const form = screen.getByRole('dialog');
    expect(within(form).getByLabelText('Monto')).toHaveValue('1.10');
    expect(within(form).getByLabelText('Fecha / hora (Lima)')).toHaveValue('2024-03-04T11:16:17.123');
    expect(within(form).getByLabelText('Descripción / comercio')).toHaveValue('');
    expect(within(form).getByLabelText('Cuenta')).toHaveValue('');
    await userEvent.selectOptions(within(form).getByLabelText('Categoría'), categories[0]!.id);
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByRole('table', { name: 'Transacciones' });
    const patch = mock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ categoryId: categories[0]!.id });
    expect(mock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});
