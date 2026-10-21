import { randomUUID } from "node:crypto";

import express, { type Express } from "express";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { Environment } from "../src/config/env.js";
import * as credentials from "../src/lib/credentials.js";
import { hashPassword } from "../src/lib/password.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { authenticateDevice } from "../src/middleware/authenticateDevice.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { requestId } from "../src/middleware/requestId.js";
import { DevicesRepository } from "../src/modules/devices/devices.repository.js";
import { DevicesService, LAST_SEEN_INTERVAL_MS } from "../src/modules/devices/devices.service.js";
import { readTestDatabaseUrl } from "./test-database.js";

const databaseUrl = readTestDatabaseUrl();
const database = createPrismaClient(databaseUrl);
const pool = new Pool({ connectionString: databaseUrl });
const repository = new DevicesRepository(database);
const config: Environment = {
  nodeEnv: "test",
  port: 3000,
  databaseUrl,
  webOrigin: "http://localhost:5173",
  sessionCookieName: "gf_session",
  sessionTtlMinutes: 720,
  pairingCodeTtlMinutes: 5,
};
const OWNER_PASSWORD = "pairing-integration-password";
const OWNER_EMAIL = "pairing-owner@example.com";
const UNKNOWN_CODE = "AAAAAAAAAA";

describe("pairing and devices API with PostgreSQL", () => {
  let app: Express;
  let probe: Express;
  let ownerId: string;
  let otherId: string;
  let ownerCookie: string;
  let otherCookie: string;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hashPassword(OWNER_PASSWORD);
  });

  async function createSession(userId: string) {
    const token = credentials.generateOpaqueToken();
    await database.webSession.create({ data: {
      userId,
      tokenHash: credentials.hashSecret(token),
      expiresAt: new Date(Date.now() + 60_000),
    } });
    return `${config.sessionCookieName}=${token}`;
  }

  beforeEach(async () => {
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    const owner = await database.user.create({ data: { email: OWNER_EMAIL, passwordHash } });
    const other = await database.user.create({ data: { email: "other@example.com", passwordHash } });
    ownerId = owner.id;
    otherId = other.id;
    ownerCookie = await createSession(ownerId);
    otherCookie = await createSession(otherId);
    app = createApp({ config, database });

    // This route exists only in tests; no financial or debug endpoint is shipped.
    probe = express();
    probe.use(requestId);
    probe.use(express.json());
    probe.post("/device", authenticateDevice(new DevicesService(repository, 5)), (req, res) => {
      res.json({ data: req.deviceAuth });
    });
    probe.use(errorHandler);
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await database.transaction.deleteMany();
    await database.user.deleteMany();
    await database.$disconnect();
    await pool.end();
  });

  function createCode(cookie = ownerCookie, target = app) {
    return request(target).post("/api/v1/devices/pairing-codes")
      .set("Cookie", cookie).set("Origin", config.webOrigin);
  }

  function pair(code: string, deviceName = "Mi teléfono", target = app) {
    return request(target).post("/api/v1/devices/pair").send({ code, deviceName });
  }

  function revoke(id: string, cookie = ownerCookie) {
    return request(app).delete(`/api/v1/devices/${id}`)
      .set("Cookie", cookie).set("Origin", config.webOrigin);
  }

  function authenticate(token: string) {
    return request(probe).post("/device").set("Authorization", `Bearer ${token}`);
  }

  async function pairedDevice(cookie = ownerCookie) {
    const issued = await createCode(cookie).expect(201);
    const paired = await pair(issued.body.data.code).expect(201);
    return paired.body.data as { deviceId: string; deviceToken: string };
  }

  it("issues a random code once, storing only its hash, configured expiry and null consumption", async () => {
    const customApp = createApp({ config: { ...config, pairingCodeTtlMinutes: 2 }, database });
    const before = Date.now();
    const response = await createCode(ownerCookie, customApp).expect(201);
    const { code, expiresAt } = response.body.data as { code: string; expiresAt: string };
    expect(Object.keys(response.body.data).sort()).toEqual(["code", "expiresAt"]);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/u);
    expect(new Date(expiresAt).getTime()).toBeGreaterThanOrEqual(before + 120_000);
    expect(new Date(expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 120_000);
    expect(response.headers["cache-control"]).toBe("no-store");
    const stored = await database.pairingCode.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ userId: ownerId, codeHash: credentials.hashSecret(code), consumedAt: null });
    expect(stored[0]?.expiresAt.toISOString()).toBe(expiresAt);
    expect(JSON.stringify(stored)).not.toContain(code);
    const second = await createCode().expect(201);
    expect(second.body.data.code).not.toBe(code);
  });

  it("requires a web session for creation, listing and revocation", async () => {
    const responses = await Promise.all([
      request(app).post("/api/v1/devices/pairing-codes").set("Origin", config.webOrigin),
      request(app).get("/api/v1/devices"),
      request(app).delete(`/api/v1/devices/${randomUUID()}`).set("Origin", config.webOrigin),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTH_REQUIRED");
    }
    expect(await database.pairingCode.count()).toBe(0);
  });

  it("requires trusted Origin for cookie mutations and allows DELETE in CORS preflight", async () => {
    const { deviceId } = await pairedDevice();
    for (const origin of [undefined, "https://untrusted.example"]) {
      const creation = request(app).post("/api/v1/devices/pairing-codes").set("Cookie", ownerCookie);
      const deletion = request(app).delete(`/api/v1/devices/${deviceId}`).set("Cookie", ownerCookie);
      if (origin) {
        creation.set("Origin", origin);
        deletion.set("Origin", origin);
      }
      for (const response of await Promise.all([creation, deletion])) {
        expect(response.status).toBe(403);
      }
    }
    expect(await database.pairingCode.count()).toBe(1);
    expect((await database.device.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt).toBeNull();
    const preflight = await request(app).options(`/api/v1/devices/${deviceId}`)
      .set("Origin", config.webOrigin).set("Access-Control-Request-Method", "DELETE").expect(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("DELETE");
  });

  it("pairs without a cookie or Origin, consumes the code and stores only the token hash", async () => {
    const issued = await createCode().expect(201);
    const code: string = issued.body.data.code;
    const manualInput = ` ${code.slice(0, 5).toLowerCase()}-${code.slice(5).toLowerCase()} `;
    const response = await pair(manualInput, "  Mi Android  ").expect(201);
    const { deviceId, deviceToken } = response.body.data;
    expect(Object.keys(response.body.data).sort()).toEqual(["deviceId", "deviceToken"]);
    expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(response.headers["cache-control"]).toBe("no-store");
    const device = await database.device.findUniqueOrThrow({ where: { id: deviceId } });
    expect(device).toMatchObject({ userId: ownerId, name: "Mi Android", tokenHash: credentials.hashSecret(deviceToken), revokedAt: null, lastSeenAt: null });
    expect(JSON.stringify(device)).not.toContain(deviceToken);
    const storedCode = await database.pairingCode.findUniqueOrThrow({ where: { codeHash: credentials.hashSecret(code) } });
    expect(storedCode.consumedAt).toBeInstanceOf(Date);
    expect((await pair(code)).status).toBe(400);
    expect(await database.device.count()).toBe(1);
  });

  it("returns the same generic error for unknown, expired and consumed codes", async () => {
    const expired = await createCode().expect(201);
    const consumed = await createCode().expect(201);
    await database.pairingCode.update({ where: { codeHash: credentials.hashSecret(expired.body.data.code) }, data: { expiresAt: new Date(Date.now() - 1) } });
    await pair(consumed.body.data.code).expect(201);
    for (const code of [UNKNOWN_CODE, expired.body.data.code, consumed.body.data.code]) {
      const response = await pair(code).set("X-Request-Id", "invalid-pairing");
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: {
        code: "VALIDATION_ERROR", message: "Código de emparejamiento inválido", details: [], requestId: "invalid-pairing",
      } });
    }
    expect(await database.device.count()).toBe(1);
    expect((await database.pairingCode.findUniqueOrThrow({ where: { codeHash: credentials.hashSecret(expired.body.data.code) } })).consumedAt).toBeNull();
  });

  it.each([
    {}, { code: UNKNOWN_CODE }, { code: UNKNOWN_CODE, deviceName: "   " },
    { code: UNKNOWN_CODE, deviceName: "x".repeat(101) },
    { code: "bad", deviceName: "Android" }, { code: 123, deviceName: "Android" },
    { code: UNKNOWN_CODE, deviceName: "Android", userId: "client-owner" },
    { code: UNKNOWN_CODE, deviceName: "Android", deviceId: "client-device" },
  ])("rejects invalid or unknown pairing fields: %j", async (body) => {
    const response = await request(app).post("/api/v1/devices/pair").send(body).expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await database.device.count()).toBe(0);
  });

  it("rejects client userId in bodies and queries and validates the device UUID", async () => {
    const { deviceId } = await pairedDevice();
    const responses = await Promise.all([
      createCode().send({ userId: otherId }),
      createCode().query({ userId: otherId }),
      request(app).get("/api/v1/devices").set("Cookie", ownerCookie).query({ userId: otherId }),
      revoke(deviceId).query({ userId: otherId }),
      revoke(deviceId).send({ userId: otherId }),
      revoke("invalid-uuid"),
      pair(UNKNOWN_CODE).query({ userId: otherId }),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
    }
    expect((await database.device.findUniqueOrThrow({ where: { id: deviceId } })).revokedAt).toBeNull();
  });

  it("allows exactly one pairing when both HTTP requests are blocked on the same PostgreSQL row", async () => {
    const issued = await createCode().expect(201);
    const code: string = issued.body.data.code;
    const stored = await database.pairingCode.findUniqueOrThrow({ where: { codeHash: credentials.hashSecret(code) } });
    const blocker = await pool.connect();
    let pending: Promise<request.Response[]> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM pairing_codes WHERE id = $1 FOR UPDATE", [stored.id]);
      pending = Promise.all([pair(code, "Android A").then((r) => r), pair(code, "Android B").then((r) => r)]);
      // Prove actual overlap in PostgreSQL before releasing the row lock.
      const deadline = Date.now() + 3_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND query LIKE '%UPDATE%pairing_codes%'`,
        );
        waiting = result.rows[0]?.count ?? 0;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(2);
      await blocker.query("COMMIT");
      const responses = await pending;
      expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
      expect(await database.device.count({ where: { userId: ownerId } })).toBe(1);
      expect(await database.pairingCode.count({ where: { id: stored.id, consumedAt: { not: null } } })).toBe(1);
      expect(responses.find((r) => r.status === 400)?.body.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });

  it("rolls back code consumption when device insertion fails and hides the database error", async () => {
    const existing = await pairedDevice();
    const issued = await createCode().expect(201);
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    // Force a real PostgreSQL uniqueness violation on token_hash.
    const generation = vi.spyOn(credentials, "generateOpaqueToken").mockReturnValue(existing.deviceToken);
    const response = await pair(issued.body.data.code).set("X-Request-Id", "rollback-test").expect(500);
    generation.mockRestore();
    expect(response.body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Ocurrió un error interno", details: [], requestId: "rollback-test" } });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(existing.deviceToken);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(credentials.hashSecret(existing.deviceToken));
    const stored = await database.pairingCode.findUniqueOrThrow({ where: { codeHash: credentials.hashSecret(issued.body.data.code) } });
    expect(stored.consumedAt).toBeNull();
    expect(await database.device.count()).toBe(1);
    await pair(issued.body.data.code).expect(201);
    expect(await database.device.count()).toBe(2);
  });

  it("lists only the authenticated user's public fields, including revoked devices", async () => {
    const own = await pairedDevice();
    const other = await pairedDevice(otherCookie);
    await revoke(own.deviceId).expect(204);
    for (const [cookie, id] of [[ownerCookie, own.deviceId], [otherCookie, other.deviceId]] as const) {
      const response = await request(app).get("/api/v1/devices").set("Cookie", cookie).expect(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(id);
      expect(Object.keys(response.body.data[0]).sort()).toEqual(["createdAt", "id", "lastSeenAt", "name", "revokedAt"]);
      expect(JSON.stringify(response.body)).not.toContain(own.deviceToken);
      expect(JSON.stringify(response.body)).not.toContain(other.deviceToken);
    }
  });

  it("cannot revoke another user's device, returning the same 404 as an unknown UUID", async () => {
    const other = await pairedDevice(otherCookie);
    const unknown = await revoke(randomUUID()).set("X-Request-Id", "isolation").expect(404);
    const forbidden = await revoke(other.deviceId).set("X-Request-Id", "isolation").expect(404);
    expect(forbidden.body).toEqual(unknown.body);
    expect((await database.device.findUniqueOrThrow({ where: { id: other.deviceId } })).revokedAt).toBeNull();
    await authenticate(other.deviceToken).expect(200);
  });

  it("soft revokes idempotently, preserves related history and immediately rejects the token", async () => {
    const device = await pairedDevice();
    const transaction = await database.transaction.create({ data: {
      userId: ownerId, deviceId: device.deviceId, clientTransactionId: randomUUID(),
      amount: "10.00", currency: "PEN", occurredAt: new Date(), type: "expense",
      source: "yape_notification", processingStatus: "automatic",
    } });
    await authenticate(device.deviceToken).expect(200);
    await revoke(device.deviceId).expect(204);
    const first = await database.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(first.revokedAt).toBeInstanceOf(Date);
    await authenticate(device.deviceToken).expect(401);
    await revoke(device.deviceId).expect(204);
    expect(await database.device.findUniqueOrThrow({ where: { id: device.deviceId } })).toEqual(first);
    expect(await database.transaction.findUniqueOrThrow({ where: { id: transaction.id } })).toEqual(transaction);
  });

  it("authenticates only the bearer credential and attaches its authoritative typed identity", async () => {
    const { deviceId, deviceToken } = await pairedDevice();
    const response = await authenticate(deviceToken).query({ userId: otherId, deviceId: randomUUID() })
      .set("Cookie", otherCookie).send({ userId: otherId, deviceId: randomUUID() }).expect(200);
    expect(response.body).toEqual({ data: { userId: ownerId, deviceId } });
    await request(probe).post("/device").set("Authorization", `bearer ${deviceToken}`).expect(200);
    await request(probe).post("/device").set("Cookie", ownerCookie).expect(401);
    await authenticate(ownerCookie.split("=")[1]!).expect(401);
    await request(app).get("/api/v1/devices").set("Authorization", `Bearer ${deviceToken}`).expect(401);
  });

  it("rejects missing, malformed, unknown and revoked bearer tokens with the same 401", async () => {
    const device = await pairedDevice();
    await revoke(device.deviceId).expect(204);
    for (const header of [undefined, "Bearer", "Basic abc", "Bearer short", `Bearer ${"x".repeat(44)}`, `Bearer ${device.deviceToken} extra`, `Bearer ${device.deviceToken},${device.deviceToken}`, `Bearer ${credentials.generateOpaqueToken()}`, `Bearer ${device.deviceToken}`]) {
      const attempt = request(probe).post("/device").set("X-Request-Id", "invalid-bearer");
      if (header) attempt.set("Authorization", header);
      const response = await attempt.expect(401);
      expect(response.body).toEqual({ error: { code: "AUTH_REQUIRED", message: "Autenticación requerida", details: [], requestId: "invalid-bearer" } });
    }
    expect((await database.device.findUniqueOrThrow({ where: { id: device.deviceId } })).lastSeenAt).toBeNull();
  });

  it("updates lastSeenAt on first use and after five minutes, with no writes between", async () => {
    const device = await pairedDevice();
    await authenticate(device.deviceToken).expect(200);
    const first = await database.device.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(first.lastSeenAt).toBeInstanceOf(Date);
    const version = await pool.query("SELECT xmin::text AS version FROM devices WHERE id = $1", [device.deviceId]);
    await authenticate(device.deviceToken).expect(200);
    expect((await pool.query("SELECT xmin::text AS version FROM devices WHERE id = $1", [device.deviceId])).rows).toEqual(version.rows);
    const past = new Date(Date.now() - LAST_SEEN_INTERVAL_MS - 1_000);
    await database.device.update({ where: { id: device.deviceId }, data: { lastSeenAt: past } });
    await authenticate(device.deviceToken).expect(200);
    expect((await database.device.findUniqueOrThrow({ where: { id: device.deviceId } })).lastSeenAt!.getTime()).toBeGreaterThan(past.getTime());
  });

  it("limits concurrent lastSeenAt updates with a database predicate", async () => {
    const device = await pairedDevice();
    const now = new Date();
    const cutoff = new Date(now.getTime() - LAST_SEEN_INTERVAL_MS);
    const writes = await Promise.all([
      repository.touchLastSeen(ownerId, device.deviceId, now, cutoff),
      repository.touchLastSeen(ownerId, device.deviceId, now, cutoff),
    ]);
    expect(writes.reduce((sum, result) => sum + result.count, 0)).toBe(1);
  });

  it("rate limits public pairing by IP, counts invalid payloads and ignores spoofed forwarding headers", async () => {
    const limited = createApp({ config, database, pairingRateLimit: { maxAttempts: 2, windowMs: 60_000 } });
    await request(limited).post("/api/v1/devices/pair").send({}).expect(400);
    await pair(UNKNOWN_CODE, "Android", limited).set("X-Forwarded-For", "192.0.2.1").expect(400);
    const response = await pair(UNKNOWN_CODE, "Android", limited).set("X-Forwarded-For", "192.0.2.2").expect(429);
    expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
    expect(response.body.error.code).toBe("RATE_LIMITED");
    // Login has an independent counter despite sharing the implementation.
    await request(limited).post("/api/v1/auth/login").set("Origin", config.webOrigin)
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
  });

  it("allows pairing again after the rate limit window expires", async () => {
    const limited = createApp({ config, database, pairingRateLimit: { maxAttempts: 1, windowMs: 60_000 } });
    const clock = vi.spyOn(Date, "now");
    const now = Date.now();
    clock.mockReturnValue(now);
    await request(limited).post("/api/v1/devices/pair").send({}).expect(400);
    await request(limited).post("/api/v1/devices/pair").send({}).expect(429);
    clock.mockReturnValue(now + 60_001);
    await request(limited).post("/api/v1/devices/pair").send({}).expect(400);
  });

  it("completes login → issue → pair → list → authenticate → revoke → 401 without logging secrets", async () => {
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    const login = await request(app).post("/api/v1/auth/login").set("Origin", config.webOrigin)
      .send({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const header = login.headers["set-cookie"];
    const cookie = (Array.isArray(header) ? header[0] : header)?.split(";")[0];
    expect(cookie).toBeTruthy();
    const issued = await createCode(cookie!).expect(201);
    const paired = await pair(issued.body.data.code).expect(201);
    await request(app).get("/api/v1/devices").set("Cookie", cookie!).expect(200);
    await authenticate(paired.body.data.deviceToken).expect(200);
    await revoke(paired.body.data.deviceId, cookie!).expect(204);
    await authenticate(paired.body.data.deviceToken).expect(401);
    const serialized = JSON.stringify(logs.mock.calls);
    for (const secret of [cookie!, cookie!.split("=")[1]!, OWNER_PASSWORD, issued.body.data.code, paired.body.data.deviceToken, credentials.hashSecret(paired.body.data.deviceToken), credentials.hashSecret(issued.body.data.code)]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
