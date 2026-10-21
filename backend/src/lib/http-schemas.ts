import { z } from "zod";

export const emptyQuerySchema = z.object({}).strict();
export const emptyBodySchema = z.object({}).strict().optional();
export const idParamsSchema = z.object({ id: z.uuid() }).strict();

// ISO validation rejects local timestamps and impossible calendar dates.
export const instantSchema = z.iso.datetime({ offset: true })
  .refine((value) => {
    const instant = new Date(value);
    // Keep the UTC instant within the four-digit AD years used by our DTOs
    // and PostgreSQL's input format (which has no year zero).
    return Number.isFinite(instant.getTime()) && instant.getUTCFullYear() >= 1
      && instant.getUTCFullYear() <= 9999;
  }, "Fecha inválida");

export const temporalFields = {
  from: instantSchema.optional(),
  to: instantSchema.optional(),
};

export type TemporalRange = z.infer<typeof temporalRangeSchema>;

export function isOrderedRange(value: { from?: string | undefined; to?: string | undefined }): boolean {
  return !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to);
}

export const temporalRangeSchema = z.object(temporalFields).strict()
  .refine(isOrderedRange, { path: ["to"], message: "to debe ser posterior a from" });
