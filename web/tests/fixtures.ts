import { vi } from 'vitest';
import type { CategoryDto, CurrencySummary, TransactionDto, UserDto } from '../src/api/dtos';
import { currentBillingCycle, IO_ACCOUNT } from '../src/features/billing/cycle';

export const user: UserDto = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'owner@example.test' };
export const categories: CategoryDto[] = [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Comida' }];
export const transaction: TransactionDto = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', amount: '24.90', currency: 'PEN',
  occurredAt: '2026-09-11T04:30:45.123Z', description: 'Compra de prueba', type: 'expense',
  account: 'IO crédito', categoryId: null, source: 'io_notification', processingStatus: 'automatic',
  createdAt: '2026-09-11T04:31:00.000Z', updatedAt: '2026-09-11T04:31:00.000Z',
};
export const summary: CurrencySummary[] = [
  { currency: 'PEN', income: '100.00', expenses: '24.90', balance: '75.10' },
  { currency: 'USD', income: '5.00', expenses: '0.00', balance: '5.00' },
  { currency: null, income: '0.00', expenses: '1.25', balance: '-1.25' },
];
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
export function failure(status: number, code = 'INTERNAL_ERROR'): Response {
  return json({ error: { code, message: 'Server internals must not be shown', details: [], requestId: 'test-request' } }, status);
}
export type Handler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;
export function mockServer(handler?: Handler, includeBilling = false) {
  const fetchMock = vi.fn<typeof fetch>(async (input, init = {}) => {
    const url = new URL(String(input), 'http://localhost');
    // Existing general-dashboard tests isolate their responses from the extra card section.
    if (!includeBilling && url.searchParams.get('account') === IO_ACCOUNT && url.searchParams.get('from') === currentBillingCycle().from) {
      return url.pathname.endsWith('/summary') ? json({ data: [] })
        : json({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    }
    const custom = handler?.(url, init);
    if (custom) return custom;
    if (url.pathname === '/api/v1/auth/me' || url.pathname === '/api/v1/auth/login') return json({ data: user });
    if (url.pathname === '/api/v1/auth/logout') return new Response(null, { status: 204 });
    if (url.pathname === '/api/v1/categories') return json({ data: categories });
    if (url.pathname === '/api/v1/summary') return json({ data: summary });
    if (url.pathname === '/api/v1/transactions') return json({ data: [transaction], meta: { page: 1, pageSize: 20, total: 1 } });
    return failure(404, 'NOT_FOUND');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
