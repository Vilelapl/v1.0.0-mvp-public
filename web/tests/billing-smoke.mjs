// Read-only browser verification against the running local backend.
import { chromium, expect } from '@playwright/test';
import { Temporal } from '@js-temporal/polyfill';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173';
if (!process.env.SMOKE_EMAIL || !process.env.SMOKE_PASSWORD) throw new Error('SMOKE_EMAIL and SMOKE_PASSWORD are required.');
const output = path.resolve(process.env.SMOKE_OUTPUT_DIR || '../.cache/hito8/billing');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.SMOKE_BROWSER_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'Asia/Tokyo' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const general = page.getByRole('region', { name: 'Transacciones', exact: true });
const cycle = page.getByRole('region', { name: 'Ciclo de facturación actual' });
const requests = [];
page.on('request', (request) => { if (request.url().includes('/api/v1/')) requests.push(new URL(request.url())); });
try {
  await page.goto(base);
  await page.getByLabel('Correo electrónico').fill(process.env.SMOKE_EMAIL);
  await page.getByLabel('Contraseña').fill(process.env.SMOKE_PASSWORD);
  const totalsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/summary' && new URL(response.url()).searchParams.get('account') === 'IO crédito');
  const listResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/transactions' && new URL(response.url()).searchParams.get('account') === 'IO crédito');
  const monthlyResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/summary' && !new URL(response.url()).searchParams.has('account'));
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  const monthly = await monthlyResponse; expect(monthly.status()).toBe(200);
  const today = Temporal.Now.plainDateISO('America/Lima');
  const midnight = (day) => day.toZonedDateTime('America/Lima').toInstant().toString({ smallestUnit: 'millisecond' });
  const month = today.with({ day: 1 });
  const monthStart = midnight(month);
  const nextMonth = midnight(month.add({ months: 1 }));
  expect(Object.fromEntries(new URL(monthly.url()).searchParams)).toEqual({ from: monthStart, to: nextMonth });
  const monthlySection = page.getByRole('region', { name: 'Resumen financiero', exact: true });
  await expect(monthlySection).toContainText('Mes completo');
  await expect(monthlySection).toContainText('Totales del día 1 al último día del mes actual.');
  for (const total of (await monthly.json()).data) {
    const displayed = monthlySection.getByRole('region', { name: `Resumen ${total.currency ?? 'sin moneda'}`, exact: true });
    for (const amount of [total.income, total.expenses, total.balance]) {
      await expect(displayed).toContainText(amount.replace(/\B(?=(\d{3})+\.)/g, ','));
    }
  }
  const totals = await totalsResponse; expect(totals.status()).toBe(200);
  const totalsBody = await totals.json();
  const list = await listResponse; expect(list.status()).toBe(200);
  const rows = await list.json();
  const query = new URL(totals.url()).searchParams;
  expect(query.get('type')).toBe('expense');
  const cycleStart = (today.day >= 26 ? today : today.subtract({ months: 1 })).with({ day: 26 });
  expect(query.get('from')).toBe(midnight(cycleStart));
  expect(query.get('to')).toBe(midnight(cycleStart.add({ months: 1 })));
  const amounts = cycle.getByLabel('Totales del ciclo iO');
  await expect(amounts).toBeVisible();
  const originalTotals = await amounts.innerText();
  for (const currency of ['PEN', 'USD']) {
    const total = totalsBody.data.find((row) => row.currency === currency)?.expenses || '0.00';
    const formatted = total.replace(/\B(?=(\d{3})+\.)/g, ',');
    await expect(amounts).toContainText(`${formatted} ${currency}`);
  }
  for (const row of rows.data) {
    expect(row.type).toBe('expense'); expect(row.account).toBe('IO crédito');
    expect(Date.parse(row.occurredAt)).toBeGreaterThanOrEqual(Date.parse(query.get('from')));
    expect(Date.parse(row.occurredAt)).toBeLessThan(Date.parse(query.get('to')));
  }
  await expect(general.getByRole('form', { name: 'Filtros de transacciones' })).toBeVisible();
  if (rows.data.length) await expect(cycle.getByRole('table')).toBeVisible();
  const options = await cycle.getByLabel('Categoría del ciclo').locator('option').evaluateAll((elements) => elements.map((element) => element.value));
  const generalRequestsBefore = requests.filter((url) => url.pathname.endsWith('/transactions') && !url.searchParams.has('account')).length;
  if (options[1]) {
    await cycle.getByLabel('Categoría del ciclo').selectOption(options[1]);
    const filtered = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/transactions' && new URL(response.url()).searchParams.has('categoryId'));
    await cycle.getByRole('button', { name: 'Filtrar ciclo' }).click(); expect((await filtered).status()).toBe(200);
    expect(await amounts.innerText()).toBe(originalTotals);
    expect(requests.filter((url) => url.pathname.endsWith('/transactions') && !url.searchParams.has('account'))).toHaveLength(generalRequestsBefore);
    const cleared = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/transactions' && new URL(response.url()).searchParams.get('account') === 'IO crédito');
    await cycle.getByRole('button', { name: 'Limpiar ciclo' }).click(); await cleared;
  }
  const cardRequestCount = requests.filter((url) => url.searchParams.get('account') === 'IO crédito').length;
  await general.getByLabel('Tipo', { exact: true }).selectOption('income');
  const income = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/transactions' && new URL(response.url()).searchParams.get('type') === 'income');
  await general.getByRole('button', { name: 'Aplicar filtros' }).click(); expect((await income).status()).toBe(200);
  expect(requests.filter((url) => url.searchParams.get('account') === 'IO crédito')).toHaveLength(cardRequestCount);
  expect(await amounts.innerText()).toBe(originalTotals);
  const reset = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/transactions' && !new URL(response.url()).searchParams.has('account'));
  const resetSummary = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/summary' && !new URL(response.url()).searchParams.has('account'));
  await general.getByRole('button', { name: 'Limpiar', exact: true }).click();
  const generalRows = await reset; expect(generalRows.status()).toBe(200);
  expect(Object.fromEntries(new URL((await resetSummary).url()).searchParams)).toEqual({ from: monthStart, to: nextMonth });
  if ((await generalRows.json()).data.length) await expect(general.getByRole('table')).toBeVisible();
  else await expect(general.getByText('No hay movimientos para estos filtros.')).toBeVisible();
  const expense = general.locator('td.amount strong.expense').first();
  if (await expense.count()) await expect(expense).toHaveCSS('color', 'rgb(179, 44, 53)');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.screenshot({ path: path.join(output, `billing-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const logout = page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout'));
  await page.getByRole('button', { name: 'Cerrar sesión' }).click(); expect((await logout).status()).toBe(204);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: 'PASS', month: { from: monthStart, to: nextMonth }, cycleExpenses: rows.meta.total, expenseCurrencies: totalsBody.data.map((row) => row.currency), checks: ['real monthly summary', 'clear restores current month', 'only IO credit expenses', '26–25 Lima', 'independent filters', 'full totals unaffected by filters', 'integrated filters', 'red expenses', 'responsive'], screenshots: output }));
} finally { await browser.close(); }
