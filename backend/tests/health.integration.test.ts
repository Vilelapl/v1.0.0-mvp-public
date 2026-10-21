import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { Environment } from "../src/config/env.js";
import { createPrismaClient, type DatabaseClient } from "../src/lib/prisma.js";
import { createReadinessCheck } from "../src/lib/readiness.js";
import { readTestDatabaseUrl } from "./test-database.js";

const databaseUrl = readTestDatabaseUrl();
const database = createPrismaClient(databaseUrl);
const config: Environment = {
  nodeEnv: "test", port: 3000, databaseUrl, webOrigin: "http://localhost:5173",
  sessionCookieName: "gf_session", sessionTtlMinutes: 720, pairingCodeTtlMinutes: 5,
};

describe("operational health checks", () => {
  beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  afterAll(async () => { await database.$disconnect(); });

  it("reports liveness without credentials or a database request", async () => {
    const probe = vi.spyOn(database, "$transaction").mockRejectedValue(new Error("offline"));
    const response = await request(createApp({ config, database })).get("/health/live").expect(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports readiness only after a real PostgreSQL query", async () => {
    const probe = vi.spyOn(database, "$transaction");
    const response = await request(createApp({ config, database })).get("/health/ready").expect(200);
    expect(response.body).toEqual({ status: "ready" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("returns generic 503 and recovers on the next successful probe without exposing errors", async () => {
    const secret = "postgresql://private-password@private-host/internal-database";
    vi.spyOn(database, "$transaction").mockRejectedValueOnce(new Error(secret));
    const app = createApp({ config, database });
    const failed = await request(app).get("/health/ready").expect(503);
    expect(failed.body).toEqual({ status: "unavailable" });
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(secret);
    await request(app).get("/health/ready").expect(200);
  });

  it("returns 503 when PostgreSQL actually rejects its connection", async () => {
    const unavailableUrl = new URL(databaseUrl);
    unavailableUrl.pathname = "/gestor_hito9_missing_database_test";
    const unavailableDatabase = createPrismaClient(unavailableUrl.toString());
    try {
      const app = createApp({ config, database: unavailableDatabase });
      const response = await request(app).get("/health/ready").expect(503);
      expect(response.body).toEqual({ status: "unavailable" });
      await request(app).get("/health/live").expect(200);
    } finally {
      await unavailableDatabase.$disconnect();
    }
  });

  it("bounds stalled probes and shares one pending query until it settles", async () => {
    vi.useFakeTimers();
    let finishProbe!: () => void;
    const pending = new Promise<void>((resolve) => { finishProbe = resolve; });
    const transaction = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const check = createReadinessCheck({ $transaction: transaction } as unknown as DatabaseClient);
    const first = check();
    const concurrent = check();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await first).toBe(false);
    expect(await concurrent).toBe(false);
    expect(transaction).toHaveBeenCalledOnce();
    const waiting = check();
    finishProbe();
    expect(await waiting).toBe(true);
    expect(await check()).toBe(true);
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
