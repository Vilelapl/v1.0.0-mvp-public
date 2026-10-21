import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.js";

export type DatabaseClient = PrismaClient;

export function readDatabaseUrl(
  source: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = source.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set to a non-empty value.");
  }

  return databaseUrl;
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  // adapter-pg 7.10 serializes UTC date fields without an offset and reads
  // timestamptz by replacing its offset. A non-UTC session silently shifts the
  // stored instant while Prisma's own round trip can conceal the discrepancy.
  // Apply UTC to every pool connection, retaining other caller-supplied options.
  const url = new URL(databaseUrl);
  const existingOptions = url.searchParams.get("options")?.trim();
  url.searchParams.set("options", [existingOptions, "-c TimeZone=UTC"].filter(Boolean).join(" "));
  const adapter = new PrismaPg({
    connectionString: url.toString(),
    connectionTimeoutMillis: 5_000,
  });

  return new PrismaClient({ adapter });
}
