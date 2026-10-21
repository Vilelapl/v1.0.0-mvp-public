import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import App from '../src/App';
import type { TransactionDto } from '../src/api/dtos';
import { categories, failure, json, mockServer, summary, transaction, user } from './fixtures';

function mount(route = '/dashboard') { return render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>); }
async function ready() { await screen.findByRole('table'); }
async function submitLogin() {
  const actor = userEvent.setup();
  await actor.type(await screen.findByLabelText('Correo electrónico'), user.email);
  await actor.type(screen.getByLabelText('Contraseña'), 'not-a-real-password');
  await actor.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('sesión y rutas', () => {
  it('espera /me sin mostrar información financiera', async () => {
    let complete: ((value: Response) => void) | undefined;
    mockServer((url) => url.pathname.endsWith('/auth/me') ? new Promise((resolve) => { complete = resolve; }) : undefined);
    mount();
    expect(screen.getByText('Comprobando sesión…')).toBeInTheDocument();
    expect(screen.queryByText('Mis movimientos')).not.toBeInTheDocument();
    await act(async () => complete?.(json({ data: user })));
    await ready();
  });
  it('protege acceso directo y permite login correcto con el usuario devuelto', async () => {
    const mock = mockServer((url) => url.pathname.endsWith('/auth/me') ? failure(401, 'AUTH_REQUIRED') : undefined);
    mount(); await submitLogin(); await ready();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    expect(mock.mock.calls.find(([url]) => String(url).endsWith('/auth/login'))?.[1]).toMatchObject({ credentials: 'include', body: JSON.stringify({ email: user.email, password: 'not-a-real-password' }) });
  });
  it('muestra error genérico para login incorrecto y borra contraseña', async () => {
    mockServer((url) => url.pathname.includes('/auth/') ? failure(401, 'AUTH_REQUIRED') : undefined);
    mount('/login'); await submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    expect(screen.queryByText('Mis movimientos')).not.toBeInTheDocument();
  });
  it('con sesión válida /login redirige al dashboard', async () => { mockServer(); mount('/login'); await ready(); expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument(); });
  it('error de /me permite reintento sin confundir red con logout', async () => {
    let fail = true;
    mockServer((url) => url.pathname.endsWith('/auth/me') && fail ? failure(500) : undefined);
    mount();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    fail = false; await userEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await ready();
  });
  it('logout usa endpoint, vuelve al login y desmonta estado financiero', async () => {
    const mock = mockServer(); mount(); await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.queryByText(transaction.description!)).not.toBeInTheDocument();
    expect(screen.queryByText('75.10')).not.toBeInTheDocument();
    expect(mock.mock.calls.some(([url, init]) => String(url).endsWith('/auth/logout') && init?.method === 'POST')).toBe(true);
  });
  it('fallo de logout mantiene sesión y ofrece error legible', async () => {
    mockServer((url) => url.pathname.endsWith('/auth/logout') ? failure(500) : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument(); expect(screen.getByRole('table')).toBeInTheDocument();
  });
  it('401 financiero cierra sesión y no permite conservar un editor', async () => {
    let expired = false;
    mockServer((url, init) => expired && init.method === 'PATCH' && url.pathname.includes('/transactions/') ? failure(401, 'AUTH_REQUIRED') : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: /^Editar / }));
    await userEvent.type(screen.getByLabelText('Descripción / comercio'), ' editada'); expired = true;
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByLabelText('Contraseña')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('dashboard, categorías y fuentes', () => {
  it('muestra loading financiero hasta tener lista y summary', async () => {
    let resolve: ((value: Response) => void) | undefined;
    mockServer((url) => url.pathname.endsWith('/summary') ? new Promise((done) => { resolve = done; }) : undefined);
    mount(); expect(await screen.findByText('Cargando movimientos…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => resolve?.(json({ data: summary }))); await ready();
  });
  it('renderiza summary multimoneda y null separados, datos y etiquetas reales', async () => {
    mockServer(); mount(); await ready();
    expect(screen.getByRole('region', { name: 'Resumen PEN' })).toHaveTextContent('75.10');
    expect(screen.getByRole('region', { name: 'Resumen USD' })).toHaveTextContent('5.00');
    expect(screen.getByRole('region', { name: 'Resumen sin moneda' })).toHaveTextContent('-1.25');
    const table = screen.getByRole('table');
    for (const text of ['10/09/2026, 23:30', '24.90', 'PEN', 'Gasto', 'Sin categoría', 'IO crédito', 'IO', 'Automático']) expect(within(table).getByText(text)).toBeInTheDocument();
    expect(screen.queryByText(transaction.id)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Categoría')).toHaveTextContent('Comida');
  });
  it('no fusiona dos capturas similares de IO y Wallet', async () => {
    mockServer((url) => url.pathname.endsWith('/transactions') ? json({ data: [transaction, { ...transaction, id: 'other-id', source: 'google_wallet_notification' }], meta: { page: 1, pageSize: 20, total: 2 } }) : undefined);
    mount(); await ready();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByText('IO')).toBeInTheDocument(); expect(screen.getByText('Google Wallet')).toBeInTheDocument();
    expect(screen.getByText(/Los movimientos pueden incluir registros/)).toBeInTheDocument();
  });
  it('contempla lista y summary vacíos', async () => {
    mockServer((url) => url.pathname.endsWith('/summary') ? json({ data: [] }) : url.pathname.endsWith('/transactions') ? json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }) : undefined);
    mount(); expect(await screen.findByText('No hay movimientos para estos filtros.')).toBeInTheDocument();
    expect(screen.getByText('No hay movimientos en este período.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });
  it('error de resumen/lista permite recargar ambos sin totales desactualizados', async () => {
    let fail = true;
    mockServer((url) => url.pathname.endsWith('/summary') && fail ? failure(500) : undefined);
    mount(); expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los movimientos y el resumen.');
    expect(screen.queryByText('75.10')).not.toBeInTheDocument();
    fail = false; await userEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await ready();
  });
  it('maneja error de categorías y reintento sin asignar null por accidente', async () => {
    let fail = true;
    mockServer((url) => url.pathname.endsWith('/categories') && fail ? failure(500) : undefined);
    mount(); await ready(); expect(screen.getByRole('button', { name: '+ Nuevo movimiento' })).toBeDisabled();
    expect(screen.getByLabelText('Categoría')).toBeDisabled();
    fail = false; await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Nuevo movimiento' })).toBeEnabled());
  });
  it('categorías vacías permiten crear sin categoría', async () => {
    mockServer((url) => url.pathname.endsWith('/categories') ? json({ data: [] }) : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: '+ Nuevo movimiento' }));
    expect(screen.getByLabelText('Categoría', { selector: '#transaction-category' })).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Sin categoría' })).toBeInTheDocument();
  });
});

describe('filtros, paginación y mutaciones', () => {
  it('pagina con 20 filas y reinicia página al aplicar filtros; summary recibe solo fechas', async () => {
    const mock = mockServer((url) => url.pathname.endsWith('/transactions') ? json({ data: [transaction], meta: { page: Number(url.searchParams.get('page')), pageSize: 20, total: 41 } }) : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText('41 movimientos · Página 2 de 3');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-10' } });
    fireEvent.change(screen.getByLabelText('Hasta (inclusive)'), { target: { value: '2026-09-11' } });
    await userEvent.selectOptions(screen.getByLabelText('Categoría'), categories[0]!.id);
    await userEvent.selectOptions(screen.getByLabelText('Tipo'), 'expense');
    await userEvent.type(screen.getByLabelText('Cuenta'), 'IO crédito');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await screen.findByText('41 movimientos · Página 1 de 3');
    const urls = mock.mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
    const list = urls.filter((url) => url.pathname.endsWith('/transactions')).at(-1)!;
    expect(Object.fromEntries(list.searchParams)).toEqual({ from: '2026-09-10T05:00:00.000Z', to: '2026-09-12T05:00:00.000Z', categoryId: categories[0]!.id, type: 'expense', account: 'IO crédito', page: '1', pageSize: '20' });
    const totals = urls.filter((url) => url.pathname.endsWith('/summary')).at(-1)!;
    expect([...totals.searchParams.keys()]).toEqual(['from', 'to']);
    await userEvent.click(screen.getByRole('button', { name: 'Limpiar' })); await ready();
    expect(screen.getByLabelText('Desde')).toHaveValue(''); expect(screen.getByLabelText('Cuenta')).toHaveValue('');
  });
  it('rechaza rango invertido sin llamar a la API', async () => {
    const mock = mockServer(); mount(); await ready(); const count = mock.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-12' } });
    fireEvent.change(screen.getByLabelText('Hasta (inclusive)'), { target: { value: '2026-09-11' } });
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa las fechas'); expect(mock.mock.calls.length).toBe(count);
  });
  it('crea solo campos permitidos, mantiene dinero string y refresca ambos recursos', async () => {
    let created: TransactionDto | null = null;
    const mock = mockServer((url, init) => {
      if (url.pathname.endsWith('/transactions') && init.method === 'POST') {
        const input: Partial<TransactionDto> = JSON.parse(String(init.body));
        created = { ...transaction, ...input, source: 'manual', processingStatus: 'manually_created' };
        return json({ data: created }, 201);
      }
      if (url.pathname.endsWith('/transactions') && created) return json({ data: [created], meta: { page: 1, pageSize: 20, total: 1 } });
      if (url.pathname.endsWith('/summary') && created) return json({ data: [{ currency: null, income: '0.10', expenses: '0.00', balance: '0.10' }] });
      return undefined;
    });
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: '+ Nuevo movimiento' }));
    const form = screen.getByRole('dialog');
    await userEvent.type(within(form).getByLabelText('Monto'), '0.10');
    fireEvent.change(within(form).getByLabelText('Fecha / hora (Lima)'), { target: { value: '2026-09-11T00:00' } });
    await userEvent.type(within(form).getByLabelText('Descripción / comercio'), 'Ingreso de prueba');
    await userEvent.selectOptions(within(form).getByLabelText('Tipo'), 'income');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear movimiento' }));
    await ready(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Ingreso de prueba')).toBeInTheDocument();
    expect(screen.getByText('Creado manualmente')).toBeInTheDocument();
    const request = mock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ amount: '0.10', currency: null, occurredAt: '2026-09-11T05:00:00.000Z', description: 'Ingreso de prueba', type: 'income', account: null, categoryId: null });
    expect(mock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/summary') && !new URL(String(url), 'http://localhost').searchParams.has('account'))).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Resumen sin moneda' })).toHaveTextContent('0.10');
  });
  it('edita categoría y descripción conservando fecha, origen y monto; null quita categoría', async () => {
    let row = { ...transaction, categoryId: categories[0]!.id };
    const mock = mockServer((url, init) => {
      if (init.method === 'PATCH') { row = { ...row, ...JSON.parse(String(init.body)), processingStatus: 'manually_modified' }; return json({ data: row }); }
      if (url.pathname.endsWith('/transactions')) return json({ data: [row], meta: { page: 1, pageSize: 20, total: 1 } });
      return undefined;
    });
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: /^Editar / }));
    const form = screen.getByRole('dialog');
    expect(within(form).getByLabelText('Monto')).toHaveValue('24.90');
    expect(within(form).queryByLabelText('Fuente')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText('Categoría'), '');
    await userEvent.clear(within(form).getByLabelText('Descripción / comercio'));
    await userEvent.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
    await ready();
    expect(JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body))).toEqual({ categoryId: null, description: null });
    expect(screen.getByText('Modificado manualmente')).toBeInTheDocument(); expect(screen.getByText('IO')).toBeInTheDocument();
    expect(screen.getByText('10/09/2026, 23:30')).toBeInTheDocument();
    expect(mock.mock.calls.filter(([url]) => String(url).startsWith('/api/v1/summary') && !new URL(String(url), 'http://localhost').searchParams.has('account'))).toHaveLength(2);
  });
  it('no modifica una captura al guardar sin cambios', async () => {
    const mock = mockServer(); mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: /^Editar / }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });
  it('no envía monto inválido y mantiene abierto el formulario', async () => {
    const mock = mockServer(); mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: '+ Nuevo movimiento' }));
    await userEvent.type(screen.getByLabelText('Monto'), '0.001'); await userEvent.click(screen.getByRole('button', { name: 'Crear movimiento' }));
    expect(screen.getByRole('alert')).toHaveTextContent('monto positivo'); expect(mock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('fallo HTTP de edición conserva los datos del formulario para corregirlos', async () => {
    mockServer((_url, init) => init.method === 'PATCH' ? failure(422, 'VALIDATION_ERROR') : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: /^Editar / }));
    await userEvent.type(screen.getByLabelText('Descripción / comercio'), ' cambio');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa los datos');
    expect(screen.getByLabelText('Descripción / comercio')).toHaveValue('Compra de prueba cambio');
  });
  it('fallo de red al crear no reenvía automáticamente un movimiento posiblemente guardado', async () => {
    const mock = mockServer((_url, init) => init.method === 'POST' ? Promise.reject(new TypeError('network')) : undefined);
    mount(); await ready(); await userEvent.click(screen.getByRole('button', { name: '+ Nuevo movimiento' }));
    await userEvent.type(screen.getByLabelText('Monto'), '1.00'); await userEvent.click(screen.getByRole('button', { name: 'Crear movimiento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar el guardado');
    expect(screen.queryByRole('button', { name: 'Crear movimiento' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar movimientos' })); await ready();
    expect(mock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(screen.getByText('Comprueba en la lista si el movimiento se guardó.')).toBeInTheDocument();
  });
  it('respuestas antiguas no reemplazan el resultado de nuevos filtros', async () => {
    let release: ((value: Response) => void) | undefined;
    mockServer((url) => {
      if (url.pathname.endsWith('/transactions') && url.searchParams.get('account') === 'old') return new Promise((resolve) => { release = resolve; });
      if (url.pathname.endsWith('/transactions') && url.searchParams.get('account') === 'new') return json({ data: [{ ...transaction, description: 'Resultado nuevo' }], meta: { page: 1, pageSize: 20, total: 1 } });
      return undefined;
    });
    mount(); await ready(); await userEvent.type(screen.getByLabelText('Cuenta'), 'old');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await userEvent.clear(screen.getByLabelText('Cuenta')); await userEvent.type(screen.getByLabelText('Cuenta'), 'new');
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await screen.findByText('Resultado nuevo');
    await act(async () => release?.(json({ data: [{ ...transaction, description: 'Resultado antiguo' }], meta: { page: 1, pageSize: 20, total: 1 } })));
    expect(screen.queryByText('Resultado antiguo')).not.toBeInTheDocument(); expect(screen.getByText('Resultado nuevo')).toBeInTheDocument();
  });
});
