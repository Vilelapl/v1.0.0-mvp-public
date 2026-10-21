import { z } from "zod";

const numericPort = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().min(1).max(65_535));

const positiveInteger = z
  .string()
  .regex(/^\d+$/u)
  .transform(Number)
  .pipe(z.number().int().positive().max(10_080));

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "postgresql:" || url.protocol === "postgres:";
  } catch {
    return false;
  }
}

function isCanonicalHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: numericPort,
    DATABASE_URL: z.string().min(1).refine(isPostgresUrl),
    WEB_ORIGIN: z.string().min(1).refine(isCanonicalHttpOrigin),
    SESSION_COOKIE_NAME: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_.-]+$/u),
    SESSION_TTL_MINUTES: positiveInteger,
    PAIRING_CODE_TTL_MINUTES: positiveInteger,
  })
  .refine((value) => value.NODE_ENV !== "production" || value.WEB_ORIGIN.startsWith("https://"), {
    path: ["WEB_ORIGIN"],
    message: "Production requires an HTTPS web origin",
  })
  .transform((value) => ({
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    webOrigin: value.WEB_ORIGIN,
    sessionCookieName: value.SESSION_COOKIE_NAME,
    sessionTtlMinutes: value.SESSION_TTL_MINUTES,
    pairingCodeTtlMinutes: value.PAIRING_CODE_TTL_MINUTES,
  }));

export type Environment = z.infer<typeof environmentSchema>;

export class EnvironmentConfigurationError extends Error {
  constructor(variableNames: readonly string[]) {
    super(
      `Invalid or missing environment variables: ${variableNames.join(", ")}.`,
    );
    this.name = "EnvironmentConfigurationError";
  }
}

export function loadEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const variableNames = [
      ...new Set(
        result.error.issues.map((issue) =>
          String(issue.path[0] ?? "environment"),
        ),
      ),
    ];

    throw new EnvironmentConfigurationError(variableNames);
  }

  return Object.freeze(result.data);
}
