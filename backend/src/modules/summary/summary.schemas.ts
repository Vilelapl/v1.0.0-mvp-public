import { z } from "zod";
import { isOrderedRange, temporalFields } from "../../lib/http-schemas.js";
import { accountSchema, transactionTypeSchema } from "../transactions/transactions.schemas.js";

// Optional filters preserve the existing unfiltered summary contract.
export const summaryQuerySchema = z.object({
  ...temporalFields,
  account: accountSchema.unwrap().optional(),
  type: transactionTypeSchema.optional(),
}).strict().refine(isOrderedRange, { path: ["to"], message: "to debe ser posterior a from" });

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
