import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "../../lib/api-error.js";
import type { CategoriesRepository } from "../categories/categories.repository.js";
import { transactionDto } from "./transactions.dto.js";
import type { TransactionsRepository } from "./transactions.repository.js";
import type {
  CreateManualInput, DeviceSyncInput, ListTransactionsQuery, UpdateTransactionInput,
} from "./transactions.schemas.js";

function notFound() {
  return new AppError("NOT_FOUND", 404, "Transacción no encontrada");
}

// An explicit allowlist also protects persistence from fields not in the DTO.
function editableFields(input: UpdateTransactionInput) {
  return {
    ...(input.amount !== undefined ? { amount: new Prisma.Decimal(input.amount) } : {}),
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
    ...(input.occurredAt !== undefined ? { occurredAt: new Date(input.occurredAt) } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.account !== undefined ? { account: input.account } : {}),
    ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
  };
}

export class TransactionsService {
  constructor(
    private readonly repository: TransactionsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  sync(identity: Express.AuthenticatedDeviceIdentity, input: DeviceSyncInput) {
    return this.repository.insertCapture({
      userId: identity.userId,
      deviceId: identity.deviceId,
      clientTransactionId: input.clientTransactionId,
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency,
      occurredAt: new Date(input.occurredAt),
      description: input.description ?? null,
      type: input.type,
      account: input.account ?? null,
      categoryId: null,
      source: input.source,
      processingStatus: "automatic",
    });
  }

  async list(userId: string, query: ListTransactionsQuery) {
    const [transactions, total] = await this.repository.listByUser(userId, query);
    return {
      data: transactions.map(transactionDto),
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async detail(userId: string, id: string) {
    const transaction = await this.repository.findByUser(userId, id);
    if (!transaction) throw notFound();
    return transactionDto(transaction);
  }

  private async validateCategory(userId: string, categoryId: string | null | undefined) {
    if (categoryId && !await this.categories.belongsToUser(userId, categoryId)) {
      throw new AppError("VALIDATION_ERROR", 400, "La solicitud contiene datos inválidos", [
        { field: "categoryId", message: "Categoría no válida" },
      ]);
    }
  }

  async createManual(userId: string, input: CreateManualInput) {
    await this.validateCategory(userId, input.categoryId);
    const transaction = await this.repository.createManual({
      userId,
      amount: new Prisma.Decimal(input.amount),
      currency: input.currency,
      occurredAt: new Date(input.occurredAt),
      description: input.description ?? null,
      type: input.type,
      account: input.account ?? null,
      categoryId: input.categoryId ?? null,
      source: "manual",
      processingStatus: "manually_created",
      deviceId: null,
      clientTransactionId: null,
    });
    return transactionDto(transaction);
  }

  async update(userId: string, id: string, input: UpdateTransactionInput) {
    const existing = await this.repository.findByUser(userId, id);
    if (!existing) throw notFound();
    await this.validateCategory(userId, input.categoryId);
    const updated = await this.repository.updateByUser(userId, id, {
      ...editableFields(input),
      processingStatus: existing.processingStatus === "automatic"
        ? "manually_modified" : existing.processingStatus,
    });
    if (!updated) throw notFound();
    return transactionDto(updated);
  }
}
