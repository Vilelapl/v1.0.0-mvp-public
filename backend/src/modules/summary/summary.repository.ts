import { Prisma } from "../../../generated/prisma/client.js";
import type { SummaryQuery } from "./summary.schemas.js";
import type { DatabaseClient } from "../../lib/prisma.js";

export type CurrencyTotals = {
  currency: string | null;
  income: Prisma.Decimal;
  expenses: Prisma.Decimal;
  balance: Prisma.Decimal;
};

export class SummaryRepository {
  constructor(private readonly database: DatabaseClient) {}

  totalsByUser(userId: string, range: SummaryQuery) {
    // PostgreSQL NUMERIC performs all arithmetic, including balance, exactly.
    // Values are bound parameters; NULL currency forms its own SQL group.
    return this.database.$queryRaw<CurrencyTotals[]>(Prisma.sql`
      SELECT currency,
        COALESCE(SUM(amount) FILTER (WHERE type = 'income'), 0) AS income,
        COALESCE(SUM(amount) FILTER (WHERE type = 'expense'), 0) AS expenses,
        SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) AS balance
      FROM transactions
      WHERE user_id = ${userId}::uuid
        ${range.from ? Prisma.sql`AND occurred_at >= ${new Date(range.from)}::timestamptz` : Prisma.empty}
        ${range.to ? Prisma.sql`AND occurred_at < ${new Date(range.to)}::timestamptz` : Prisma.empty}
        ${range.account ? Prisma.sql`AND account = ${range.account}` : Prisma.empty}
        ${range.type ? Prisma.sql`AND type = ${range.type}::"TransactionType"` : Prisma.empty}
      GROUP BY currency
      ORDER BY currency ASC NULLS LAST
    `);
  }
}
