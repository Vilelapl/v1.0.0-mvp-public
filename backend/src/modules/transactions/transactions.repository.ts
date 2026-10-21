import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../lib/api-error.js";
import type { DatabaseClient } from "../../lib/prisma.js";
import { transactionSelect } from "./transactions.dto.js";
import type { ListTransactionsQuery } from "./transactions.schemas.js";

export class TransactionsRepository {
  constructor(private readonly database: DatabaseClient) {}

  async insertCapture(data: Prisma.TransactionUncheckedCreateInput & {
    userId: string; clientTransactionId: string;
  }) {
    try {
      // INSERT first, outside an interactive transaction: a UNIQUE failure must
      // finish its rollback before the lookup can see the winning committed row.
      const created = await this.database.transaction.create({
        data, select: { id: true, clientTransactionId: true },
      });
      return { transactionId: created.id, clientTransactionId: data.clientTransactionId, syncResult: "created" as const };
    } catch (error: unknown) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const existing = await this.database.transaction.findUnique({
        where: { userId_clientTransactionId: {
          userId: data.userId, clientTransactionId: data.clientTransactionId,
        } },
        select: { id: true },
      });
      if (!existing) {
        throw new AppError("CONFLICT", 409, "No se pudo guardar la transacción por un conflicto");
      }
      return { transactionId: existing.id, clientTransactionId: data.clientTransactionId, syncResult: "already_exists" as const };
    }
  }

  listByUser(userId: string, query: ListTransactionsQuery) {
    const where: Prisma.TransactionWhereInput = {
      userId,
      occurredAt: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      },
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.account ? { account: query.account } : {}),
    };
    // Count and page share a snapshot even if synchronization runs concurrently.
    return this.database.$transaction([
      this.database.transaction.findMany({
        where, select: transactionSelect,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.transaction.count({ where }),
    ], { isolationLevel: "RepeatableRead" });
  }

  findByUser(userId: string, id: string) {
    return this.database.transaction.findFirst({
      where: { id, userId }, select: transactionSelect,
    });
  }

  createManual(data: Prisma.TransactionUncheckedCreateInput) {
    return this.database.transaction.create({ data, select: transactionSelect });
  }

  async updateByUser(userId: string, id: string, data: Prisma.TransactionUncheckedUpdateInput) {
    const [updated] = await this.database.transaction.updateManyAndReturn({
      where: { id, userId }, data, select: transactionSelect,
    });
    return updated ?? null;
  }
}
