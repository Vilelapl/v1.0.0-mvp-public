import { randomUUID } from "node:crypto";

import type { Express } from "express";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { createApp } from "../src/app.js";
import type { Environment } from "../src/config/env.js";
import { generateOpaqueToken, hashSecret } from "../src/lib/credentials.js";
import { hashPassword } from "../src/lib/password.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { readTestDatabaseUrl } from "./test-database.js";

const databaseUrl = readTestDatabaseUrl();
const database = createPrismaClient(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const config: Environment = {
  nodeEnv: "test", port: 3000, databaseUrl,
  webOrigin: "http://localhost:5173", sessionCookieName: "gf_session",
  sessionTtlMinutes: 720, pairingCodeTtlMinutes: 5,
};
const OWNER_EMAIL = "transactions-owner@example.com";
const OWNER_PASSWORD = "transactions-integration-password";
const baseFinancial = {
  amount: "24.90", currency: "PEN", occurredAt: "2026-08-31T14:20:00-05:00",
  description: "  Comercio ejemplo  ", type: "expense", account: "  IO Crédito  ",
};
const dtoKeys = ["id", "amount", "currency", "occurredAt", "description", "type", "account",
  "categoryId", "source", "processingStatus", "createdAt", "updatedAt"].sort();

describe("transactions, categories and summary with PostgreSQL", () => {
  let app: Express;
  let ownerId: string;
  let otherId: string;
  let ownerCookie: string;
  let otherCookie: string;
  let deviceId: string;
  let deviceToken: string;
  let ownCategory: string;
  let otherCategory: string;
  let passwordHash: string;

  beforeAll(async () => { passwordHash = await hashPassword(OWNER_PASSWORD); });

  async function session(userId: string) {
    const token = generateOpaqueToken();
    await database.webSession.create({ data: {
      userId, tokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 300_000),
    } });
    return `${config.sessionCookieName}=${token}`;
  }

  async function device(userId: string) {
    const token = generateOpaqueToken();
    const stored = await database.device.create({ data: {
      userId, name: "Dispositivo de prueba", tokenHash: hashSecret(token), lastSeenAt: new Date(),
    } });
    return { id: stored.id, token };
  }

  beforeEach(async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    ownerId = (await database.user.create({ data: { email: OWNER_EMAIL, passwordHash } })).id;
    otherId = (await database.user.create({ data: { email: "other@example.com", passwordHash } })).id;
    ownerCookie = await session(ownerId);
    otherCookie = await session(otherId);
    const ownDevice = await device(ownerId);
    deviceId = ownDevice.id;
    deviceToken = ownDevice.token;
    ownCategory = (await database.category.create({ data: {
      userId: ownerId, name: "Comida", normalizedName: "comida",
    } })).id;
    otherCategory = (await database.category.create({ data: {
      userId: otherId, name: "Privada", normalizedName: "privada",
    } })).id;
    app = createApp({ config, database });
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    await database.$disconnect();
    await pool.end();
  });

  function sync(body: Record<string, unknown> = {}, token = deviceToken) {
    return request(app).post("/api/v1/device/transactions/sync")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...baseFinancial, clientTransactionId: randomUUID(), source: "io_notification", ...body });
  }

  function create(body: Record<string, unknown> = {}, cookie = ownerCookie) {
    return request(app).post("/api/v1/transactions").set("Cookie", cookie)
      .set("Origin", config.webOrigin).send({ ...baseFinancial, ...body });
  }

  function patch(id: string, body: Record<string, unknown>, cookie = ownerCookie) {
    return request(app).patch(`/api/v1/transactions/${id}`).set("Cookie", cookie)
      .set("Origin", config.webOrigin).send(body);
  }

  function list(query: Record<string, string | number> = {}, cookie = ownerCookie) {
    return request(app).get("/api/v1/transactions").set("Cookie", cookie).query(query);
  }

  function summary(query: Record<string, string> = {}, cookie = ownerCookie) {
    return request(app).get("/api/v1/summary").set("Cookie", cookie).query(query);
  }

  function fixture(overrides: Partial<Prisma.TransactionUncheckedCreateInput> = {}) {
    return database.transaction.create({ data: {
      userId: ownerId, amount: "10.00", currency: "PEN", occurredAt: new Date("2026-08-31T19:20:00Z"),
      type: "expense", source: "manual", processingStatus: "manually_created", ...overrides,
    } });
  }

  it.each(["io_notification", "yape_notification", "google_wallet_notification"])(
    "syncs %s using only bearer identity, with automatic status and normalized fields", async (source) => {
      const clientTransactionId = randomUUID();
      const response = await sync({ source, clientTransactionId }).set("Cookie", otherCookie).expect(201);
      expect(response.body).toEqual({ data: {
        transactionId: expect.any(String), clientTransactionId, syncResult: "created",
      } });
      const stored = await database.transaction.findUniqueOrThrow({ where: { id: response.body.data.transactionId } });
      expect(stored).toMatchObject({
        userId: ownerId, deviceId, clientTransactionId, source, processingStatus: "automatic",
        description: "Comercio ejemplo", account: "IO Crédito", currency: "PEN", categoryId: null,
      });
      expect(stored.amount.toFixed(2)).toBe("24.90");
      expect(stored.occurredAt.toISOString()).toBe("2026-08-31T19:20:00.000Z");
      // Do not verify dates solely through Prisma: reciprocal timezone errors
      // in its writer/reader can make a shifted PostgreSQL value look correct.
      const actual = await pool.query<{ epoch_ms: string; amount: string }>(
        "SELECT (extract(epoch FROM occurred_at)*1000)::bigint::text AS epoch_ms, amount::text FROM transactions WHERE id = $1",
        [stored.id],
      );
      expect(actual.rows[0]?.epoch_ms).toBe(String(Date.parse(baseFinancial.occurredAt)));
      expect(actual.rows[0]?.amount).toBe("24.90");
      expect(response.headers["cache-control"]).toBe("no-store");
    },
  );

  it("forces UTC on pool sessions despite URL timezone options, preserving unrelated settings", async () => {
    const url = new URL(databaseUrl);
    url.searchParams.set("options", "-c TimeZone=America/Lima -c application_name=timezone-regression");
    const isolated = createPrismaClient(url.toString());
    try {
      // Concurrent transactions exercise more than a single pooled connection.
      await Promise.all(Array.from({ length: 3 }, () => isolated.$transaction(async (connection) => {
        const settings = await connection.$queryRaw<Array<{ zone: string; application: string }>>`
          SELECT current_setting('TimeZone') AS zone, current_setting('application_name') AS application
        `;
        expect(settings[0]).toEqual({ zone: "UTC", application: "timezone-regression" });
        const expected = new Date("2026-09-11T11:57:53.771-05:00");
        const row = await connection.transaction.create({ data: {
          userId: ownerId, amount: "0.10", currency: "PEN", occurredAt: expected,
          type: "income", source: "manual", processingStatus: "manually_created",
        } });
        const actual = await connection.$queryRaw<Array<{ epoch_ms: string }>>`
          SELECT (extract(epoch FROM occurred_at)*1000)::bigint::text AS epoch_ms
          FROM transactions WHERE id = ${row.id}::uuid
        `;
        expect(actual[0]?.epoch_ms).toBe(String(expected.getTime()));
      })));
    } finally { await isolated.$disconnect(); }
  });

  it("rejects manual source and client metadata in sync bodies or queries", async () => {
    for (const body of [
      { source: "manual" }, { source: "unknown" }, { userId: otherId }, { deviceId: randomUUID() },
      { processingStatus: "manually_created" }, { categoryId: ownCategory }, { id: randomUUID() },
      { createdAt: "2026-08-31T00:00:00Z" }, { updatedAt: "2026-08-31T00:00:00Z" },
    ]) {
      expect((await sync(body).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    }
    await sync().query({ userId: otherId }).expect(400);
    expect(await database.transaction.count()).toBe(0);
  });

  it("rejects missing, malformed, unknown, web and revoked device credentials", async () => {
    for (const token of ["invalid", generateOpaqueToken(), ownerCookie.split("=")[1]!]) {
      expect((await sync({}, token).expect(401)).body.error.code).toBe("AUTH_REQUIRED");
    }
    await request(app).post("/api/v1/device/transactions/sync").set("Cookie", ownerCookie).send(baseFinancial).expect(401);
    await request(app).delete(`/api/v1/devices/${deviceId}`).set("Cookie", ownerCookie)
      .set("Origin", config.webOrigin).expect(204);
    expect((await sync().expect(401)).body.error.code).toBe("AUTH_REQUIRED");
    expect(await database.transaction.count()).toBe(0);
  });

  it("returns the original ID on retries, including after a web edit or from a replacement device", async () => {
    const clientTransactionId = randomUUID();
    const first = await sync({ clientTransactionId }).expect(201);
    const id: string = first.body.data.transactionId;
    const second = await sync({ clientTransactionId, amount: "99.00", description: "Datos diferentes" }).expect(200);
    expect(second.body.data).toEqual({ transactionId: id, clientTransactionId, syncResult: "already_exists" });
    await patch(id, { amount: "0.10", description: "Corrección web" }).expect(200);
    const beforeRetry = await database.transaction.findUniqueOrThrow({ where: { id } });
    const replacement = await device(ownerId);
    expect((await sync({ clientTransactionId }, replacement.token).expect(200)).body.data.transactionId).toBe(id);
    expect(await database.transaction.findUniqueOrThrow({ where: { id } })).toEqual(beforeRetry);
    expect(await database.transaction.count()).toBe(1);
  });

  it("keeps different captures distinct and scopes clientTransactionId uniqueness to userId", async () => {
    const clientTransactionId = randomUUID();
    const own = await sync({ clientTransactionId }).expect(201);
    const distinct = await sync().expect(201);
    const foreign = await device(otherId);
    const other = await sync({ clientTransactionId }, foreign.token).expect(201);
    expect(new Set([own, distinct, other].map((r) => r.body.data.transactionId)).size).toBe(3);
    expect(await database.transaction.count()).toBe(3);
    expect((await sync({ clientTransactionId }, foreign.token).expect(200)).body.data.transactionId)
      .toBe(other.body.data.transactionId);
  });

  it("creates exactly one row when two real HTTP INSERTs overlap in PostgreSQL", async () => {
    const clientTransactionId = randomUUID();
    const blocker = await pool.connect();
    let pending: Promise<request.Response[]> | undefined;
    try {
      await blocker.query("BEGIN");
      // Allow reads, but hold both INSERTs before releasing them together.
      await blocker.query("LOCK TABLE transactions IN SHARE MODE");
      pending = Promise.all([
        sync({ clientTransactionId }).then((r) => r),
        sync({ clientTransactionId }).then((r) => r),
      ]);
      const deadline = Date.now() + 5_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: number }>(`
          SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%INSERT%transactions%'
        `);
        waiting = result.rows[0]?.count ?? 0;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
      await blocker.query("COMMIT");
      const responses = await pending;
      expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(responses.map((r) => r.body.data.syncResult).sort()).toEqual(["already_exists", "created"]);
      expect(new Set(responses.map((r) => r.body.data.transactionId)).size).toBe(1);
      expect(await database.transaction.count({ where: { userId: ownerId, clientTransactionId } })).toBe(1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });

  it.each([
    ["numeric amount", { amount: 24.9 }], ["zero", { amount: "0.00" }],
    ["negative", { amount: "-0.10" }], ["extra decimals", { amount: "1.001" }],
    ["overflow", { amount: "1000000000000.00" }], ["exponent", { amount: "1e2" }],
    ["decimal comma", { amount: "1,20" }], ["null amount", { amount: null }],
    ["lowercase currency", { currency: "pen" }], ["long currency", { currency: "PENX" }],
    ["local timestamp", { occurredAt: "2026-08-31T14:20:00" }],
    ["date only", { occurredAt: "2026-08-31" }], ["invalid day", { occurredAt: "2026-02-30T00:00:00Z" }],
    ["year zero", { occurredAt: "0000-01-01T00:00:00Z" }],
    ["UTC year overflow", { occurredAt: "9999-12-31T23:59:59-05:00" }],
    ["null date", { occurredAt: null }], ["unknown type", { type: "transfer" }],
    ["long description", { description: "x".repeat(301) }], ["long account", { account: "x".repeat(121) }],
    ["empty account", { account: "   " }], ["NUL text", { description: "text\u0000" }],
  ])("validates financial data for both sync and manual creation: %s", async (_name, body) => {
    for (const response of await Promise.all([sync(body), create(body)])) {
      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", requestId: expect.any(String) });
      expect(response.body.error.details.length).toBeGreaterThan(0);
    }
    expect(await database.transaction.count()).toBe(0);
  });

  it("preserves the Decimal(14,2) upper boundary and never infers nullable fields", async () => {
    const captured = await sync({ amount: "999999999999.99", currency: null, description: null, account: null }).expect(201);
    const detail = await request(app).get(`/api/v1/transactions/${captured.body.data.transactionId}`)
      .set("Cookie", ownerCookie).expect(200);
    expect(detail.body.data).toMatchObject({ amount: "999999999999.99", currency: null, description: null, account: null });
    const minimal = await request(app).post("/api/v1/transactions").set("Cookie", ownerCookie).set("Origin", config.webOrigin)
      .send({ amount: "1", currency: null, occurredAt: "2026-08-31T00:00:00Z", type: "income" }).expect(201);
    expect(minimal.body.data).toMatchObject({ amount: "1.00", currency: null, description: null, account: null, categoryId: null });
  });

  it("requires web authentication on all six web operations and does not accept a device token", async () => {
    const id = randomUUID();
    const attempts = [
      request(app).get("/api/v1/transactions"), request(app).get(`/api/v1/transactions/${id}`),
      request(app).post("/api/v1/transactions").set("Origin", config.webOrigin).send(baseFinancial),
      request(app).patch(`/api/v1/transactions/${id}`).set("Origin", config.webOrigin).send({ amount: "1" }),
      request(app).get("/api/v1/categories"), request(app).get("/api/v1/summary"),
    ];
    for (const attempt of attempts) {
      const response = await attempt.set("Authorization", `Bearer ${deviceToken}`).expect(401);
      expect(response.body.error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("returns only public DTO fields with exact money and UTC timestamps", async () => {
    const captured = await sync().expect(201);
    const id: string = captured.body.data.transactionId;
    const detail = await request(app).get(`/api/v1/transactions/${id}`).set("Cookie", ownerCookie).expect(200);
    const listed = await list().expect(200);
    for (const data of [detail.body.data, listed.body.data[0]]) {
      expect(Object.keys(data).sort()).toEqual(dtoKeys);
      expect(data.amount).toBe("24.90");
      expect(data.occurredAt).toBe("2026-08-31T19:20:00.000Z");
      expect(data.createdAt).toMatch(/Z$/u);
      expect(data.updatedAt).toMatch(/Z$/u);
    }
    expect(listed.headers["cache-control"]).toBe("no-store");
  });

  it("paginates with a stable occurredAt DESC, id DESC order and an owner-scoped total", async () => {
    const rows = await Promise.all([
      fixture({ id: "00000000-0000-4000-8000-000000000001" }),
      fixture({ id: "00000000-0000-4000-8000-000000000002" }),
      fixture({ occurredAt: new Date("2026-09-01T00:00:00Z") }),
      fixture({ occurredAt: new Date("2026-08-30T00:00:00Z") }),
    ]);
    const foreign = await fixture({ userId: otherId, occurredAt: new Date("2026-10-01T00:00:00Z") });
    const first = await list({ pageSize: 2 }).expect(200);
    const second = await list({ pageSize: 2, page: 2 }).expect(200);
    expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 4 });
    expect(second.body.meta).toEqual({ page: 2, pageSize: 2, total: 4 });
    expect([...first.body.data, ...second.body.data].map((row: { id: string }) => row.id))
      .toEqual([rows[2]!.id, rows[1]!.id, rows[0]!.id, rows[3]!.id]);
    expect((await list().expect(200)).body.meta).toEqual({ page: 1, pageSize: 20, total: 4 });
    expect((await list({ page: 3, pageSize: 2 }).expect(200)).body.data).toEqual([]);
    expect((await list({ pageSize: 100 }).expect(200)).body.data).toHaveLength(4);
    const other = await list({}, otherCookie).expect(200);
    expect(other.body.data.map((row: { id: string }) => row.id)).toEqual([foreign.id]);
  });

  it("applies every list filter, combines them and treats from as inclusive and to as exclusive", async () => {
    const match = await fixture({ categoryId: ownCategory, account: "Yape", type: "income", occurredAt: new Date("2026-08-31T05:00:00Z") });
    await fixture({ account: "IO", type: "expense", occurredAt: new Date("2026-09-01T05:00:00Z") });
    await fixture({ occurredAt: new Date("2026-08-31T04:59:59.999Z") });
    await fixture({ userId: otherId, categoryId: otherCategory, account: "Yape", type: "income" });
    for (const query of [
      { from: "2026-08-31T00:00:00-05:00", to: "2026-09-01T00:00:00-05:00" },
      { categoryId: ownCategory }, { type: "income" }, { account: "  Yape  " },
      { from: "2026-08-31T05:00:00Z", to: "2026-09-01T05:00:00Z", categoryId: ownCategory, type: "income", account: "Yape" },
    ]) {
      const result = await list(query).expect(200);
      expect(result.body.data.map((row: { id: string }) => row.id)).toEqual([match.id]);
      expect(result.body.meta.total).toBe(1);
    }
    expect((await list({ from: "2026-09-01T05:00:00Z" }).expect(200)).body.meta.total).toBe(1);
    expect((await list({ to: "2026-08-31T05:00:00Z" }).expect(200)).body.meta.total).toBe(1);
    expect((await list({ categoryId: otherCategory }).expect(200)).body.meta.total).toBe(0);
  });

  it("rejects invalid, duplicate and unknown filters and unsafe pagination", async () => {
    for (const query of [
      { page: 0 }, { page: -1 }, { page: "1.5" }, { pageSize: 101 }, { pageSize: 0 },
      { page: "9007199254740993" }, { page: "2147483647", pageSize: 100 },
      { categoryId: "invalid" }, { type: "other" }, { account: " " }, { userId: otherId },
      { from: "2026-08-31" }, { to: "2026-08-31T12:00:00" },
      { from: "2026-09-01T00:00:00Z", to: "2026-08-31T00:00:00Z" },
    ]) {
      expect((await list(query).expect(400)).body.error.code).toBe("VALIDATION_ERROR");
    }
    await request(app).get("/api/v1/transactions?page=1&page=2").set("Cookie", ownerCookie).expect(400);
  });

  it("validates UUIDs and returns identical 404s for a foreign or nonexistent transaction", async () => {
    const foreign = await fixture({ userId: otherId });
    for (const id of [foreign.id, randomUUID()]) {
      const detail = await request(app).get(`/api/v1/transactions/${id}`).set("Cookie", ownerCookie)
        .set("X-Request-Id", "isolation").expect(404);
      const update = await patch(id, { amount: "1" }).set("X-Request-Id", "isolation").expect(404);
      for (const response of [detail, update]) {
        expect(response.body).toEqual({ error: {
          code: "NOT_FOUND", message: "Transacción no encontrada", details: [], requestId: "isolation",
        } });
      }
    }
    await request(app).get("/api/v1/transactions/invalid").set("Cookie", ownerCookie).expect(400);
    await patch("invalid", { amount: "1" }).expect(400);
    expect(await database.transaction.findUniqueOrThrow({ where: { id: foreign.id } })).toEqual(foreign);
  });

  it("creates manual metadata on the server and keeps separate manual rows with null client IDs", async () => {
    const first = await create({ categoryId: ownCategory }).expect(201);
    await create().expect(201);
    const stored = await database.transaction.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(stored).toMatchObject({
      userId: ownerId, source: "manual", processingStatus: "manually_created",
      deviceId: null, clientTransactionId: null, categoryId: ownCategory,
    });
    expect(Object.keys(first.body.data).sort()).toEqual(dtoKeys);
    expect(await database.transaction.count()).toBe(2);
  });

  it("rejects metadata changes and empty patches without changing a transaction", async () => {
    const created = await create().expect(201);
    const id: string = created.body.data.id;
    const stored = await database.transaction.findUniqueOrThrow({ where: { id } });
    for (const body of [
      { id: randomUUID() }, { userId: otherId }, { deviceId }, { clientTransactionId: randomUUID() },
      { source: "io_notification" }, { processingStatus: "automatic" },
      { createdAt: "2026-08-31T00:00:00Z" }, { updatedAt: "2026-08-31T00:00:00Z" },
    ]) {
      await create(body).expect(400);
      await patch(id, body).expect(400);
    }
    await patch(id, {}).expect(400);
    for (const body of [{ amount: null }, { amount: 1 }, { amount: "0.001" }, { type: null }, { occurredAt: null }, { categoryId: "bad" }]) {
      await patch(id, body).expect(400);
    }
    expect(await database.transaction.findUniqueOrThrow({ where: { id } })).toEqual(stored);
    expect(await database.transaction.count()).toBe(1);
  });

  it("marks automatic edits as manually_modified, preserves provenance and never overwrites absent fields", async () => {
    const captured = await sync().expect(201);
    const id: string = captured.body.data.transactionId;
    const before = await database.transaction.findUniqueOrThrow({ where: { id } });
    const edited = await patch(id, {
      amount: "0.20", currency: "USD", occurredAt: "2026-09-01T08:00:00+02:00",
      description: "  Corregida  ", type: "income", account: "  Efectivo  ", categoryId: ownCategory,
    }).expect(200);
    expect(edited.body.data).toMatchObject({
      amount: "0.20", currency: "USD", occurredAt: "2026-09-01T06:00:00.000Z",
      description: "Corregida", type: "income", account: "Efectivo", categoryId: ownCategory,
      source: "io_notification", processingStatus: "manually_modified",
    });
    const after = await database.transaction.findUniqueOrThrow({ where: { id } });
    expect(after).toMatchObject({
      id, userId: before.userId, deviceId: before.deviceId, clientTransactionId: before.clientTransactionId,
      source: before.source, createdAt: before.createdAt,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    const cleared = await patch(id, { currency: null, description: null, account: null, categoryId: null }).expect(200);
    expect(cleared.body.data).toMatchObject({
      amount: "0.20", type: "income", occurredAt: "2026-09-01T06:00:00.000Z",
      currency: null, description: null, account: null, categoryId: null, processingStatus: "manually_modified",
    });
  });

  it("keeps manually_created on manual edits and preserves omitted nullable fields", async () => {
    const created = await create({ categoryId: ownCategory }).expect(201);
    const edited = await patch(created.body.data.id, { description: "Otra" }).expect(200);
    expect(edited.body.data).toMatchObject({
      source: "manual", processingStatus: "manually_created", amount: "24.90", currency: "PEN",
      account: "IO Crédito", categoryId: ownCategory, description: "Otra",
    });
  });

  it("requires Origin for manual writes and includes PATCH in the CORS preflight", async () => {
    const created = await create().expect(201);
    for (const origin of [undefined, "https://untrusted.example"]) {
      const attempts = [
        request(app).post("/api/v1/transactions").set("Cookie", ownerCookie).send(baseFinancial),
        request(app).patch(`/api/v1/transactions/${created.body.data.id}`).set("Cookie", ownerCookie).send({ amount: "1" }),
      ];
      for (const attempt of attempts) {
        if (origin) attempt.set("Origin", origin);
        expect((await attempt.expect(403)).body.error.code).toBe("FORBIDDEN");
      }
    }
    const preflight = await request(app).options(`/api/v1/transactions/${created.body.data.id}`)
      .set("Origin", config.webOrigin).set("Access-Control-Request-Method", "PATCH").expect(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(await database.transaction.count()).toBe(1);
    expect((await database.transaction.findUniqueOrThrow({ where: { id: created.body.data.id } })).amount.toFixed(2)).toBe("24.90");
  });

  it("lists only the owner's public categories and rejects foreign or unknown assignments", async () => {
    const own = await request(app).get("/api/v1/categories").set("Cookie", ownerCookie).expect(200);
    const other = await request(app).get("/api/v1/categories").set("Cookie", otherCookie).expect(200);
    expect(own.body).toEqual({ data: [{ id: ownCategory, name: "Comida" }] });
    expect(other.body).toEqual({ data: [{ id: otherCategory, name: "Privada" }] });
    const created = await create({ categoryId: ownCategory }).expect(201);
    for (const categoryId of [otherCategory, randomUUID()]) {
      for (const response of await Promise.all([create({ categoryId }), patch(created.body.data.id, { categoryId })])) {
        expect(response.status).toBe(400);
        expect(response.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: [{ field: "categoryId", message: "Categoría no válida" }] });
      }
    }
    expect((await database.transaction.findUniqueOrThrow({ where: { id: created.body.data.id } })).categoryId).toBe(ownCategory);
    expect((await patch(created.body.data.id, { categoryId: null }).expect(200)).body.data.categoryId).toBeNull();
    await create({ categoryId: "bad" }).expect(400);
    await request(app).get("/api/v1/categories").set("Cookie", ownerCookie).query({ userId: otherId }).expect(400);
    await request(app).post("/api/v1/categories").set("Cookie", ownerCookie).set("Origin", config.webOrigin).send({ name: "Nueva" }).expect(404);
  });

  it("summarizes each currency separately with exact decimals, signed balance, zero sides and null currency", async () => {
    for (const [currency, type, amount] of [
      ["PEN", "income", "0.10"], ["PEN", "income", "0.20"], ["PEN", "expense", "0.10"],
      ["USD", "income", "100.00"], ["USD", "expense", "140.00"],
      [null, "income", "0.10"], [null, "income", "0.20"],
      ["EUR", "expense", "1.01"],
    ] as const) await fixture({ currency, type, amount });
    await fixture({ userId: otherId, currency: "PEN", amount: "999.99", type: "income" });
    const response = await summary().expect(200);
    expect(response.body).toEqual({ data: [
      { currency: "EUR", income: "0.00", expenses: "1.01", balance: "-1.01" },
      { currency: "PEN", income: "0.30", expenses: "0.10", balance: "0.20" },
      { currency: "USD", income: "100.00", expenses: "140.00", balance: "-40.00" },
      { currency: null, income: "0.30", expenses: "0.00", balance: "0.30" },
    ] });
    expect(JSON.stringify(response.body)).not.toContain("0.30000000000000004");
    expect((await summary({}, otherCookie).expect(200)).body.data).toEqual([
      { currency: "PEN", income: "999.99", expenses: "0.00", balance: "999.99" },
    ]);
  });

  it("preserves exact summary totals beyond the per-transaction Decimal(14,2) limit", async () => {
    await fixture({ type: "income", amount: "999999999999.99" });
    await fixture({ type: "income", amount: "999999999999.99" });
    await fixture({ type: "expense", amount: "0.10" });
    expect((await summary().expect(200)).body.data).toEqual([
      { currency: "PEN", income: "1999999999999.98", expenses: "0.10", balance: "1999999999999.88" },
    ]);
  });

  it("shares temporal boundaries with listing and returns [] for an empty summary", async () => {
    expect((await summary().expect(200)).body).toEqual({ data: [] });
    expect((await list().expect(200)).body).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
    await fixture({ type: "income", amount: "0.10", occurredAt: new Date("2026-08-31T05:00:00Z") });
    await fixture({ type: "income", amount: "0.20", occurredAt: new Date("2026-09-01T05:00:00Z") });
    const range = { from: "2026-08-31T00:00:00-05:00", to: "2026-09-01T00:00:00-05:00" };
    expect((await summary(range).expect(200)).body.data).toEqual([
      { currency: "PEN", income: "0.10", expenses: "0.00", balance: "0.10" },
    ]);
    expect((await list(range).expect(200)).body.meta.total).toBe(1);
    expect((await summary({ from: range.to }).expect(200)).body.data[0].income).toBe("0.20");
    expect((await summary({ to: range.from }).expect(200)).body.data).toEqual([]);
    for (const query of [
      { from: "2026-08-31" }, { to: "2026-08-31T00:00:00" }, { userId: otherId },
      { from: range.to, to: range.from }, { from: range.from, to: range.from }, { type: "unknown" },
    ]) await summary(query).expect(400);
  });

  it("summarizes only the credit account expenses within the 26–25 cycle, across sources and currencies", async () => {
    const range = { from: "2026-08-26T05:00:00.000Z", to: "2026-09-26T05:00:00.000Z" };
    const card = { account: "IO crédito", type: "expense" as const };
    await fixture({ ...card, amount: "0.10", occurredAt: new Date(range.from), source: "io_notification" });
    await fixture({ ...card, amount: "0.20", occurredAt: new Date("2026-09-26T04:59:59.999Z"), source: "google_wallet_notification" });
    await fixture({ ...card, amount: "4.50", currency: "USD" });
    await fixture({ ...card, amount: "1.01", currency: null });
    await fixture({ ...card, amount: "900.00", type: "income" });
    await fixture({ ...card, account: "BCP débito", amount: "800.00" });
    await fixture({ ...card, amount: "700.00", userId: otherId });
    await fixture({ ...card, amount: "600.00", occurredAt: new Date("2026-08-26T04:59:59.999Z") });
    await fixture({ ...card, amount: "500.00", occurredAt: new Date(range.to) });
    const response = await summary({ ...range, ...card }).expect(200);
    expect(response.body.data).toEqual([
      { currency: "PEN", income: "0.00", expenses: "0.30", balance: "-0.30" },
      { currency: "USD", income: "0.00", expenses: "4.50", balance: "-4.50" },
      { currency: null, income: "0.00", expenses: "1.01", balance: "-1.01" },
    ]);
    expect((await list({ ...range, ...card }).expect(200)).body.meta.total).toBe(4);
    expect((await summary({ ...range, ...card }, otherCookie).expect(200)).body.data[0].expenses).toBe("700.00");
    expect((await summary({ account: "IO crédito", type: "income" }).expect(200)).body.data[0].income).toBe("900.00");
  });

  it("includes every credit expense beyond a full API page with exact decimal totals", async () => {
    await database.transaction.createMany({ data: Array.from({ length: 125 }, () => ({
      userId: ownerId, amount: "0.10", currency: "PEN", account: "IO crédito",
      type: "expense", source: "manual", processingStatus: "manually_created",
      occurredAt: new Date("2026-09-10T12:00:00Z"),
    })) });
    const query = { account: "IO crédito", type: "expense" };
    const page = await list({ ...query, pageSize: 100 }).expect(200);
    expect(page.body.data).toHaveLength(100);
    expect(page.body.meta.total).toBe(125);
    expect((await summary(query).expect(200)).body.data).toEqual([
      { currency: "PEN", income: "0.00", expenses: "12.50", balance: "-12.50" },
    ]);
  });

  it("validates optional summary filters and binds account text safely", async () => {
    await fixture({ account: "IO crédito" });
    expect((await summary({ account: "  IO crédito  " }).expect(200)).body.data[0].expenses).toBe("10.00");
    expect((await summary({ account: "' OR 1=1 --" }).expect(200)).body.data).toEqual([]);
    for (const query of [{ account: "" }, { account: "x".repeat(121) }, { account: "bad\u0000" },
      { type: "refund" }, { page: "1" }, { categoryId: ownCategory }]) await summary(query).expect(400);
  });

  it("completes device sync → PostgreSQL → web login → list → summary → manual create → edit without sensitive logs", async () => {
    const captured = await sync({ amount: "0.10", description: "Descripción financiera privada" }).expect(201);
    expect(await database.transaction.count({ where: { id: captured.body.data.transactionId, userId: ownerId } })).toBe(1);
    const login = await request(app).post("/api/v1/auth/login").set("Origin", config.webOrigin)
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const headers = login.headers["set-cookie"];
    const cookie = (Array.isArray(headers) ? headers[0] : headers)?.split(";")[0];
    expect(cookie).toBeTruthy();
    expect((await list({}, cookie!).expect(200)).body.meta.total).toBe(1);
    expect((await summary({}, cookie!).expect(200)).body.data[0].expenses).toBe("0.10");
    const manual = await create({ amount: "0.20", type: "income" }, cookie!).expect(201);
    await patch(manual.body.data.id, { categoryId: ownCategory }, cookie!).expect(200);
    await patch(captured.body.data.transactionId, { description: "Corregida" }, cookie!).expect(200);
    expect((await summary({}, cookie!).expect(200)).body.data[0].balance).toBe("0.10");
    const serialized = JSON.stringify(vi.mocked(console.info).mock.calls);
    for (const secret of [cookie!, deviceToken, hashSecret(deviceToken), OWNER_PASSWORD, passwordHash, databaseUrl, "Descripción financiera privada"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("hides unexpected database failures instead of exposing SQL, credentials or stacks", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(database.transaction, "create").mockRejectedValueOnce(new Error("private SQL and credentials"));
    const response = await sync().set("X-Request-Id", "financial-failure").expect(500);
    expect(response.body).toEqual({ error: {
      code: "INTERNAL_ERROR", message: "Ocurrió un error interno", details: [], requestId: "financial-failure",
    } });
    expect(JSON.stringify(logs.mock.calls)).not.toContain("private SQL and credentials");
    expect(await database.transaction.count()).toBe(0);
  });
});
