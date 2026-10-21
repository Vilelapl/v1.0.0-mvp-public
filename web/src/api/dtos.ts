export interface Envelope<T> { data: T }
export interface UserDto { id: string; email: string }
export interface CategoryDto { id: string; name: string }
export type TransactionType = 'income' | 'expense';
export type TransactionSource = 'io_notification' | 'yape_notification' | 'google_wallet_notification' | 'manual';
export type ProcessingStatus = 'automatic' | 'manually_modified' | 'manually_created';

export interface TransactionDto {
  id: string;
  amount: string;
  currency: string | null;
  occurredAt: string;
  description: string | null;
  type: TransactionType;
  account: string | null;
  categoryId: string | null;
  source: TransactionSource;
  processingStatus: ProcessingStatus;
  createdAt: string;
  updatedAt: string;
}
export interface TransactionPage extends Envelope<TransactionDto[]> {
  meta: { page: number; pageSize: number; total: number };
}
export interface CurrencySummary {
  currency: string | null;
  income: string;
  expenses: string;
  balance: string;
}
export interface CreateTransactionInput {
  amount: string;
  currency: string | null;
  occurredAt: string;
  description?: string | null;
  type: TransactionType;
  account?: string | null;
  categoryId?: string | null;
}
export type UpdateTransactionInput = Partial<CreateTransactionInput>;
export interface DateRange { from?: string; to?: string }
export interface SummaryQuery extends DateRange { account?: string; type?: TransactionType }
export interface TransactionQuery extends DateRange {
  categoryId?: string;
  type?: TransactionType;
  account?: string;
  page: number;
  pageSize: number;
}
