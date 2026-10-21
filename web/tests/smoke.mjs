// Run only against a disposable database. This creates clearly labelled test movements.
import { chromium, expect } from '@playwright/test';
import { Temporal } from '@js-temporal/polyfill';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173';
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
if (!email || !password || process.env.SMOKE_ALLOW_WRITES !== 'isolated-test-database') {
  throw new Error('Configure SMOKE_EMAIL, SMOKE_PASSWORD and SMOKE_ALLOW_WRITES=isolated-test-database for a disposable database.');
}
const output = path.resolve(process.env.SMOKE_OUTPUT_DIR || '../.cache/hito8/smoke');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Tokyo' });
const page = await context.newPage();
const general = page.getByRole('region', { name: 'Transacciones', exact: true });
const runtimeErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
const stamp = Date.now().toString();
const account = `Smoke MVP ${stamp}`;
const smokeDay = Temporal.Now.plainDateISO('America/Lima');
const localInstant = `${smokeDay}T00:00:12.123`;
const utc = (value) => Temporal.PlainDateTime.from(value).toZonedDateTime('America/Lima').toInstant().toString({ smallestUnit: 'millisecond' });
const occurredAt = utc(localInstant);
const from = utc(`${smokeDay}T00:00:00`);
const to = utc(`${smokeDay.add({ days: 1 })}T00:00:00`);
// Summary contract is fixed to two decimals. Exact integer cents keep assertions
// independent of floating point while verifying the database's calculation.
const cents = (amount) => BigInt(amount.replace('.', ''));
function expectExpenseChange(before, after, currency, delta) {
  const previous = before.find((row) => row.currency === currency) ?? { income: '0.00', expenses: '0.00', balance: '0.00' };
  const current = after.find((row) => row.currency === currency);
  expect(current).toBeDefined();
  expect(cents(current.income)).toBe(cents(previous.income));
  expect(cents(current.expenses)).toBe(cents(previous.expenses) + delta);
  expect(cents(current.balance)).toBe(cents(previous.balance) - delta);
  for (const other of before.filter((row) => row.currency !== currency)) {
    expect(after.find((row) => row.currency === other.currency)).toEqual(other);
  }
}
const waitApi = (suffix, method = 'GET') => {
  const waiting = page.waitForResponse((response) => {
    const url = new URL(response.url());
    if (method === 'GET' && url.searchParams.get('account') === 'IO crédito') return false;
    return url.pathname === `/api/v1/${suffix}` && response.request().method() === method;
  });
  // Preserve the first assertion failure if subsequent responses never arrive.
  void waiting.catch(() => {});
  return waiting;
};
try {
  const unauthorized = waitApi('auth/me');
  await page.goto(`${base}/dashboard`);
  expect((await unauthorized).status()).toBe(401);
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await page.screenshot({ path: path.join(output, 'login.png'), fullPage: true });
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  const loginResponse = waitApi('auth/login', 'POST');
  const initialList = waitApi('transactions');
  const initialSummary = waitApi('summary');
  const initialCategories = waitApi('categories');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  expect((await loginResponse).status()).toBe(200);
  const baseline = (await (await initialList).json()).data;
  const firstSummary = await initialSummary;
  expect(firstSummary.status()).toBe(200);
  let previousSummary = (await firstSummary.json()).data;
  const categoryList = (await (await initialCategories).json()).data;
  await expect(page.getByRole('heading', { name: 'Mis movimientos' })).toBeVisible();
  const cookies = await context.cookies();
  // SESSION_COOKIE_NAME is configurable; identify the cookie set by login.
  const setCookie = (await (await loginResponse).allHeaders())['set-cookie'];
  expect(setCookie).toBeTruthy();
  const sessionCookieName = setCookie.slice(0, setCookie.indexOf('='));
  const sessionCookie = cookies.find((cookie) => cookie.name === sessionCookieName);
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain(`${sessionCookieName}=`);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  const me = waitApi('auth/me'); const reloaded = waitApi('transactions');
  await page.reload(); expect((await me).status()).toBe(200); await reloaded;
  if (baseline.length) await expect(general.getByRole('table')).toBeVisible();
  else await expect(page.getByText('No hay movimientos para estos filtros.')).toBeVisible();
  for (const row of baseline) {
    expect(typeof row.amount).toBe('string');
    const expectedDate = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(row.occurredAt));
    await expect(page.locator(`time[datetime="${row.occurredAt}"]`).first()).toHaveText(expectedDate);
  }
  const sourceLabels = { io_notification: 'IO', yape_notification: 'Yape', google_wallet_notification: 'Google Wallet', manual: 'Manual' };
  for (const source of new Set(baseline.map((row) => row.source))) {
    expect(await general.getByRole('table').getByText(sourceLabels[source], { exact: true }).count()).toBe(baseline.filter((row) => row.source === source).length);
  }
  await page.screenshot({ path: path.join(output, 'dashboard-captures.png'), fullPage: true });
  async function create(currency, description, category) {
    await page.getByRole('button', { name: '+ Nuevo movimiento' }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Monto', { exact: true }).fill('0.10');
    await form.getByLabel('Moneda', { exact: true }).fill(currency);
    await form.getByLabel('Fecha / hora (Lima)').fill(localInstant);
    await form.getByLabel('Descripción / comercio').fill(description);
    await form.getByLabel('Cuenta', { exact: true }).fill(account);
    if (category) await form.getByLabel('Categoría', { exact: true }).selectOption(category);
    await page.screenshot({ path: path.join(output, 'form.png'), fullPage: true });
    const post = waitApi('transactions', 'POST'); const list = waitApi('transactions'); const summary = waitApi('summary');
    await form.getByRole('button', { name: 'Crear movimiento' }).click();
    const response = await post;
    expect(response.status()).toBe(201);
    const body = response.request().postDataJSON();
    expect(body.amount).toBe('0.10');
    expect(body.occurredAt).toBe(occurredAt);
    expect(Object.keys(body).sort()).toEqual(['account', 'amount', 'categoryId', 'currency', 'description', 'occurredAt', 'type'].sort());
    const saved = (await response.json()).data;
    expect(saved.source).toBe('manual'); expect(saved.processingStatus).toBe('manually_created');
    const listResponse = await list; const summaryResponse = await summary;
    expect(listResponse.status()).toBe(200); expect(summaryResponse.status()).toBe(200);
    const currentSummary = (await summaryResponse.json()).data;
    expectExpenseChange(previousSummary, currentSummary, currency || null, 10n);
    previousSummary = currentSummary;
    await expect(form).not.toBeVisible();
    return saved;
  }
  const description = `Smoke manual ${stamp}`;
  const manual = await create('PEN', description, categoryList[0]?.id);
  await create('USD', `Smoke USD ${stamp}`);
  await create('', `Smoke sin moneda ${stamp}`);
  for (const name of ['Resumen PEN', 'Resumen USD', 'Resumen sin moneda']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
  await general.getByLabel('Desde', { exact: true }).fill(smokeDay.toString());
  await general.getByLabel('Hasta (inclusive)').fill(smokeDay.toString());
  await general.getByLabel('Cuenta', { exact: true }).fill(account);
  await general.getByLabel('Tipo', { exact: true }).selectOption('expense');
  if (categoryList[0]) await general.getByLabel('Categoría', { exact: true }).selectOption(categoryList[0].id);
  const filtered = waitApi('transactions'); const filteredSummary = waitApi('summary');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  const filterResponse = await filtered;
  const filterParams = new URL(filterResponse.url()).searchParams;
  expect(filterParams.get('from')).toBe(from);
  expect(filterParams.get('to')).toBe(to);
  expect(filterParams.get('account')).toBe(account);
  const filteredBody = await filterResponse.json();
  expect(filteredBody.meta.total).toBe(categoryList[0] ? 1 : 3);
  const dailySummary = await filteredSummary;
  expect([...new URL(dailySummary.url()).searchParams.keys()].sort()).toEqual(['from', 'to']);
  previousSummary = (await dailySummary.json()).data;
  const row = general.getByRole('row').filter({ hasText: description });
  await row.getByRole('button', { name: /^Editar / }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Monto', { exact: true }).fill('0.20');
  await form.getByLabel('Categoría', { exact: true }).selectOption('');
  const editedDescription = `${description} editado`;
  await form.getByLabel('Descripción / comercio').fill(editedDescription);
  const patched = waitApi(`transactions/${manual.id}`, 'PATCH'); const editedList = waitApi('transactions'); const editedSummary = waitApi('summary');
  await form.getByRole('button', { name: 'Guardar cambios' }).click();
  const patchResponse = await patched;
  expect(patchResponse.status()).toBe(200);
  const patch = patchResponse.request().postDataJSON();
  expect(patch).toEqual({ amount: '0.20', description: editedDescription, ...(categoryList[0] ? { categoryId: null } : {}) });
  const edited = (await patchResponse.json()).data;
  expect(edited.amount).toBe('0.20'); expect(edited.categoryId).toBe(null);
  expect(edited.occurredAt).toBe(manual.occurredAt);
  expect(edited.processingStatus).toBe('manually_created');
  expect(edited.description).toBe(editedDescription);
  expect((await editedList).status()).toBe(200);
  const updatedSummary = await editedSummary; expect(updatedSummary.status()).toBe(200);
  expectExpenseChange(previousSummary, (await updatedSummary.json()).data, 'PEN', 10n);
  const persisted = await context.request.get(`${base}/api/v1/transactions/${manual.id}`);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).data).toEqual(edited);
  // Populate only disposable test records to exercise real server pagination.
  for (let i = 0; i < 21; i++) {
    const response = await context.request.post(`${base}/api/v1/transactions`, {
      headers: { Origin: base }, data: { amount: '0.01', currency: 'PEN', occurredAt: from, description: `Smoke página ${stamp} ${i}`, type: 'expense', account },
    });
    expect(response.status()).toBe(201);
  }
  const cleared = waitApi('transactions');
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click(); await cleared;
  await page.getByLabel('Cuenta', { exact: true }).fill(account);
  const paginationFirst = waitApi('transactions');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  const first = await (await paginationFirst).json(); expect(first.data.length).toBe(20); expect(first.meta.total).toBe(24);
  const paginationSecond = waitApi('transactions');
  await general.getByRole('button', { name: 'Siguiente' }).click();
  const second = await (await paginationSecond).json(); expect(second.data.length).toBe(4); expect(second.meta.page).toBe(2);
  await expect(general.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: path.join(output, `dashboard-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: window.innerWidth }))).toEqual({ scroll: width, viewport: width });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '+ Nuevo movimiento' }).click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: path.join(output, 'form-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape'); await expect(modal).not.toBeVisible();
  const logout = waitApi('auth/logout', 'POST');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click(); expect((await logout).status()).toBe(204);
  await expect(page.getByLabel('Contraseña')).toBeVisible();
  expect((await context.cookies()).filter((cookie) => cookie.name === sessionCookieName)).toHaveLength(0);
  const afterLogout = await context.request.get(`${base}/api/v1/auth/me`); expect(afterLogout.status()).toBe(401);
  expect(runtimeErrors).toEqual([]);
  console.log(JSON.stringify({ result: 'PASS', baselineMovements: baseline.length, baselineSources: [...new Set(baseline.map((row) => row.source))], createdForSmoke: 24, browserTimezone: 'Asia/Tokyo', uiTimezone: 'America/Lima', viewports: [1440, 768, 390], checks: ['protected route', 'login', 'HttpOnly cookie', 'me/reload', 'baseline movements', 'exact summary by currency', 'date/category/type/account filters', 'create', 'edit description/null category', 'persisted detail', 'pagination', 'responsive', 'modal keyboard', 'logout'], screenshots: output }));
} finally { await context.close(); await browser.close(); }
