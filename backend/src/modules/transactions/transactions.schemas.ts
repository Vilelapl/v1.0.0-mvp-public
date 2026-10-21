import { z } from "zod";

import { instantSchema, isOrderedRange, temporalFields } from "../../lib/http-schemas.js";

// Twelve integer digits + two fractional digits fit PostgreSQL Decimal(14,2).
// Keep money textual throughout validation; never coerce it to Number.
export const amountSchema = z.string().trim()
  .regex(/^\d{1,12}(?:\.\d{1,2})?$/u, "Debe ser un decimal de hasta 12 enteros y 2 decimales")
  .refine((value) => /[1-9]/u.test(value), "Debe ser un decimal positivo");
export const currencySchema = z.string().trim().regex(/^[A-Z]{3}$/u).nullable();
export const transactionTypeSchema = z.enum(["income", "expense"]);
export const deviceSourceSchema = z.enum([
  "io_notification", "yape_notification", "google_wallet_notification",
]);

function boundedText(maximum: number) {
  return z.string().trim().min(1).max(maximum)
    .refine((value) => !value.includes("\u0000"), "El texto contiene caracteres inválidos");
}

export const descriptionSchema = boundedText(300).nullable();
export const accountSchema = boundedText(120).nullable();
export const categoryIdSchema = z.uuid().nullable();

const financialFields = {
  amount: amountSchema,
  currency: currencySchema,
  occurredAt: instantSchema,
  description: descriptionSchema.optional(),
  type: transactionTypeSchema,
  account: accountSchema.optional(),
};

export const deviceSyncSchema = z.object({
  ...financialFields,
  clientTransactionId: z.uuid(),
  source: deviceSourceSchema,
}).strict();

export const createManualSchema = z.object({
  ...financialFields,
  categoryId: categoryIdSchema.optional(),
}).strict();

export const updateTransactionSchema = createManualSchema.partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined),
    "Debe enviar al menos un campo modificable");

const positiveQueryInteger = z.string().regex(/^\d+$/u).transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));

export const listTransactionsSchema = z.object({
  ...temporalFields,
  categoryId: z.uuid().optional(),
  type: transactionTypeSchema.optional(),
  account: boundedText(120).optional(),
  page: positiveQueryInteger.default(1),
  pageSize: positiveQueryInteger.pipe(z.number().max(100)).default(20),
}).strict()
  .refine(isOrderedRange, { path: ["to"], message: "to debe ser posterior a from" })
  .refine((value) => (value.page - 1) * value.pageSize <= 2_147_483_647,
    { path: ["page"], message: "La página excede el límite de paginación" });

export type DeviceSyncInput = z.infer<typeof deviceSyncSchema>;
export type CreateManualInput = z.infer<typeof createManualSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsSchema>;
