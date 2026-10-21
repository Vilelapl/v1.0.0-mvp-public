import { z } from "zod";

export const emptyQuerySchema = z.object({}).strict();
export const emptyBodySchema = z.object({}).strict().optional();

export const pairBodySchema = z.object({
  code: z.string().trim().toUpperCase()
    .regex(/^[A-HJ-NP-Z2-9]{5}-?[A-HJ-NP-Z2-9]{5}$/u)
    .transform((value) => value.replace("-", "")),
  deviceName: z.string().trim().min(1).max(100),
}).strict();

export const deviceIdParamsSchema = z.object({ id: z.uuid() }).strict();

export type PairInput = z.infer<typeof pairBodySchema>;
export type DeviceIdParams = z.infer<typeof deviceIdParamsSchema>;
