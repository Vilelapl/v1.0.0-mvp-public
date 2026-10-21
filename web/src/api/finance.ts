import { api } from './client';
import type { CategoryDto, CreateTransactionInput, CurrencySummary, SummaryQuery, Envelope, TransactionDto, TransactionPage, TransactionQuery, UpdateTransactionInput } from './dtos';

export function queryString(query: SummaryQuery | TransactionQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.size ? `?${params.toString()}` : '';
}
export const finance = {
  categories: (signal?: AbortSignal) => api.get<Envelope<CategoryDto[]>>('/categories', { signal }),
  summary: (query: SummaryQuery, signal?: AbortSignal) => api.get<Envelope<CurrencySummary[]>>(`/summary${queryString(query)}`, { signal }),
  transactions: (query: TransactionQuery, signal?: AbortSignal) => api.get<TransactionPage>(`/transactions${queryString(query)}`, { signal }),
  create: (input: CreateTransactionInput, signal?: AbortSignal) => api.post<Envelope<TransactionDto>>('/transactions', input, { signal }),
  update: (id: string, input: UpdateTransactionInput, signal?: AbortSignal) => api.patch<Envelope<TransactionDto>>(`/transactions/${encodeURIComponent(id)}`, input, { signal }),
};
