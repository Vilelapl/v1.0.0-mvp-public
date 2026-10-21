import { z } from "zod";

export const loginBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).email(),
    password: z.string().min(1).max(1_024),
  })
  .strict();

export type LoginInput = z.infer<typeof loginBodySchema>;
