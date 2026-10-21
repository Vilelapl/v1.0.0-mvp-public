import type { Prisma } from "../../../generated/prisma/client.js";

export const transactionSelect = {
  id: true,
  amount: true,
  currency: true,
  occurredAt: true,
  description: true,
  type: true,
  account: true,
  categoryId: true,
  source: true,
  processingStatus: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TransactionSelect;

type PublicTransaction = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;

export function transactionDto(transaction: PublicTransaction) {
  return {
    ...transaction,
    amount: transaction.amount.toFixed(2),
    occurredAt: transaction.occurredAt.toISOString(),
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
