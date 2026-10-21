import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { generateOpaqueToken, hashSecret } from "../src/lib/credentials.js";
import { verifyPassword } from "../src/lib/password.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { readTestDatabaseUrl } from "./test-database.js";

const run = promisify(execFile);
const databaseUrl = readTestDatabaseUrl();
const database = createPrismaClient(databaseUrl);
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));

describe("bootstrap and seed regression with PostgreSQL", () => {
  afterAll(async () => {
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    await database.$disconnect();
  });

  it("can repeat the existing administrative scripts without changing owner, categories or financial relations", async () => {
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    const password = generateOpaqueToken();
    const env = {
      ...process.env, DATABASE_URL: databaseUrl,
      BOOTSTRAP_USER_EMAIL: "  BOOTSTRAP-REGRESSION@EXAMPLE.COM  ",
      BOOTSTRAP_USER_PASSWORD: password,
    };
    async function administrativeScript(path: string) {
      const result = await run(process.execPath, ["--import", "tsx", path], {
        cwd: backendDirectory, env, windowsHide: true, timeout: 30_000,
      });
      expect(result.stdout + result.stderr).not.toContain(password);
      expect(result.stdout + result.stderr).not.toContain(databaseUrl);
    }
    await administrativeScript("src/scripts/bootstrap.ts");
    await administrativeScript("prisma/seed.ts");
    const owner = await database.user.findUniqueOrThrow({ where: { email: "bootstrap-regression@example.com" } });
    const categories = await database.category.findMany({ where: { userId: owner.id }, orderBy: { id: "asc" } });
    expect(categories).toHaveLength(8);
    const device = await database.device.create({ data: {
      userId: owner.id, name: "Existing device", tokenHash: hashSecret(generateOpaqueToken()),
    } });
    const transaction = await database.transaction.create({ data: {
      userId: owner.id, deviceId: device.id, categoryId: categories[0]!.id,
      clientTransactionId: randomUUID(),
      amount: "0.10", currency: "PEN", occurredAt: new Date(), type: "income",
      source: "io_notification", processingStatus: "automatic",
    } });
    await administrativeScript("src/scripts/bootstrap.ts");
    await administrativeScript("prisma/seed.ts");
    const repeated = await database.user.findUniqueOrThrow({ where: { email: owner.email } });
    expect(repeated.id).toBe(owner.id);
    expect(await verifyPassword(repeated.passwordHash, password)).toBe(true);
    expect(await database.category.findMany({ where: { userId: owner.id }, orderBy: { id: "asc" } })).toEqual(categories);
    expect(await database.device.findUniqueOrThrow({ where: { id: device.id } })).toEqual(device);
    expect(await database.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).toEqual(transaction);
  }, 60_000);
});
