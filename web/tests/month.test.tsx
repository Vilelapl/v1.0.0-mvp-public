import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { currentCalendarMonth } from '../src/features/dashboard/month';
import { mockServer } from './fixtures';

describe('mes calendario en Lima', () => {
  it.each([
    ['2026-10-01T04:59:59.999Z', '2026-09-01', '2026-10-01'],
    ['2026-10-01T05:00:00.000Z', '2026-10-01', '2026-11-01'],
    ['2027-01-01T04:59:59.999Z', '2026-12-01', '2027-01-01'],
    ['2027-01-01T05:00:00.000Z', '2027-01-01', '2027-02-01'],
    ['2024-02-29T12:00:00.000Z', '2024-02-01', '2024-03-01'],
    ['2026-02-28T12:00:00.000Z', '2026-02-01', '2026-03-01'],
  ])('%s consulta el mes completo %s / %s', (instant, from, to) => {
    expect(currentCalendarMonth(instant)).toMatchObject({ from: `${from}T05:00:00.000Z`, to: `${to}T05:00:00.000Z` });
  });
});

function monthlyQueries(mock: ReturnType<typeof mockServer>) {
  return mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'))
    .filter((url) => url.pathname.endsWith('/summary') && !url.searchParams.has('account'))
    .map((url) => Object.fromEntries(url.searchParams));
}
async function mount(instant: string) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
  const mock = mockServer();
  await act(async () => { render(<MemoryRouter initialEntries={['/dashboard']}><App /></MemoryRouter>); });
  return mock;
}

describe('resumen mensual automático', () => {
  it('abre con el mes completo y conserva el historial de la lista', async () => {
    const mock = await mount('2026-09-13T12:00:00.000Z');
    expect(monthlyQueries(mock)).toEqual([{ from: '2026-09-01T05:00:00.000Z', to: '2026-10-01T05:00:00.000Z' }]);
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent(/se(?:p)?tiembre de 2026 · Mes completo/);
    const generalList = mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'))
      .find((url) => url.pathname.endsWith('/transactions') && !url.searchParams.has('account'))!;
    expect(generalList.searchParams.has('from')).toBe(false);
    expect(generalList.searchParams.has('to')).toBe(false);
  });
  it('renueva período y datos al empezar el mes sin recargar la página', async () => {
    const mock = await mount('2026-10-01T04:59:59.000Z');
    await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
    expect(monthlyQueries(mock)).toEqual([
      { from: '2026-09-01T05:00:00.000Z', to: '2026-10-01T05:00:00.000Z' },
      { from: '2026-10-01T05:00:00.000Z', to: '2026-11-01T05:00:00.000Z' },
    ]);
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent('octubre de 2026 · Mes completo');
  });
  it('recupera el mes actual al volver de una pestaña suspendida', async () => {
    const mock = await mount('2026-09-13T12:00:00.000Z');
    vi.setSystemTime(new Date('2027-01-13T12:00:00.000Z'));
    await act(async () => { fireEvent(window, new Event('focus')); });
    expect(monthlyQueries(mock).at(-1)).toEqual({ from: '2027-01-01T05:00:00.000Z', to: '2027-02-01T05:00:00.000Z' });
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent('enero de 2027 · Mes completo');
  });
  it('mantiene fechas personalizadas y al limpiar vuelve al mes vigente', async () => {
    const mock = await mount('2026-09-30T12:00:00.000Z');
    const list = screen.getByRole('region', { name: 'Transacciones' });
    fireEvent.change(within(list).getByLabelText('Desde'), { target: { value: '2026-08-10' } });
    fireEvent.change(within(list).getByLabelText('Hasta (inclusive)'), { target: { value: '2026-08-11' } });
    await act(async () => { fireEvent.submit(within(list).getByRole('form')); });
    expect(monthlyQueries(mock).at(-1)).toEqual({ from: '2026-08-10T05:00:00.000Z', to: '2026-08-12T05:00:00.000Z' });
    const previousCount = monthlyQueries(mock).length;
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    await act(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(monthlyQueries(mock)).toHaveLength(previousCount);
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent('Período seleccionado');
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: 'Limpiar' })); });
    expect(monthlyQueries(mock).at(-1)).toEqual({ from: '2026-10-01T05:00:00.000Z', to: '2026-11-01T05:00:00.000Z' });
    expect(screen.getByRole('region', { name: 'Resumen financiero' })).toHaveTextContent('octubre de 2026 · Mes completo');
  });
});
