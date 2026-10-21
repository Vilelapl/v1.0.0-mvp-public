import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { Environment } from "../src/config/env.js";
import { hashPassword } from "../src/lib/password.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import {
  generateSessionToken,
  hashSessionToken,
} from "../src/lib/session-token.js";
import { readTestDatabaseUrl } from "./test-database.js";

const WEB_ORIGIN = "http://localhost:5173";
const SESSION_COOKIE_NAME = "gf_session";
const OWNER_EMAIL = "owner@example.com";
const OWNER_PASSWORD = "integration-test-password";

const databaseUrl = readTestDatabaseUrl();
const database = createPrismaClient(databaseUrl);
const config: Environment = {
  nodeEnv: "test",
  port: 3_000,
  databaseUrl,
  webOrigin: WEB_ORIGIN,
  sessionCookieName: SESSION_COOKIE_NAME,
  sessionTtlMinutes: 720,
  pairingCodeTtlMinutes: 5,
};

type ResponseWithHeaders = {
  headers: Record<string, string | string[] | undefined>;
};

function setCookieHeaders(response: ResponseWithHeaders): string[] {
  const header = response.headers["set-cookie"];
  if (Array.isArray(header)) {
    return header;
  }
  return header ? [header] : [];
}

function sessionCookie(response: ResponseWithHeaders): string {
  const header = setCookieHeaders(response)[0];
  if (!header) {
    throw new Error("Expected a session cookie in the response.");
  }
  const cookie = header.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Expected a non-empty session cookie.");
  }
  return cookie;
}

function tokenFromCookie(cookie: string): string {
  return cookie.slice(cookie.indexOf("=") + 1);
}

describe("web authentication API", () => {
  let app: Express;
  let ownerId: string;
  let ownerPasswordHash: string;

  beforeAll(async () => {
    ownerPasswordHash = await hashPassword(OWNER_PASSWORD);
  });

  beforeEach(async () => {
    await database.user.deleteMany();
    const owner = await database.user.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: ownerPasswordHash,
      },
      select: { id: true },
    });
    ownerId = owner.id;
    app = createApp({ config, database });
  });

  afterAll(async () => {
    await database.user.deleteMany();
    await database.$disconnect();
  });

  async function login(
    email = OWNER_EMAIL,
    password = OWNER_PASSWORD,
    targetApp = app,
    origin = WEB_ORIGIN,
  ) {
    return request(targetApp)
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email, password });
  }

  it("logs in, sends a secure-by-policy cookie and stores only its hash", async () => {
    const response = await login("  OWNER@EXAMPLE.COM  ");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      data: { id: ownerId, email: OWNER_EMAIL },
    });

    const cookieHeaders = setCookieHeaders(response);
    expect(cookieHeaders).toHaveLength(1);
    expect(cookieHeaders[0]).toContain("HttpOnly");
    expect(cookieHeaders[0]).toContain("SameSite=Strict");
    expect(cookieHeaders[0]).toContain("Path=/");
    expect(cookieHeaders[0]).toContain("Expires=");

    const cookie = sessionCookie(response);
    const token = tokenFromCookie(cookie);
    const sessions = await database.webSession.findMany();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.userId).toBe(ownerId);
    expect(sessions[0]?.tokenHash).toBe(hashSessionToken(token));
    expect(sessions[0]?.tokenHash).not.toBe(token);
    expect(sessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("sets Secure on the session cookie in production", async () => {
    const productionOrigin = "https://finance.example.com";
    const productionApp = createApp({
      config: {
        ...config,
        nodeEnv: "production",
        webOrigin: productionOrigin,
      },
      database,
    });

    const response = await login(
      OWNER_EMAIL,
      OWNER_PASSWORD,
      productionApp,
      productionOrigin,
    );

    expect(response.status).toBe(200);
    expect(setCookieHeaders(response)[0]).toContain("Secure");
  });

  it("uses the same generic response for an unknown email and a wrong password", async () => {
    const unknownEmail = await login("unknown@example.com", OWNER_PASSWORD);
    const wrongPassword = await login(OWNER_EMAIL, "wrong-password");

    for (const response of [unknownEmail, wrongPassword]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toMatchObject({
        code: "AUTH_REQUIRED",
        message: "Credenciales inválidas",
        details: [],
      });
      expect(response.body.error.requestId).toEqual(expect.any(String));
    }

    expect(await database.webSession.count()).toBe(0);
  });

  it("returns the public owner identity for a valid cookie", async () => {
    const cookie = sessionCookie(await login());
    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toEqual({
      data: { id: ownerId, email: OWNER_EMAIL },
    });
  });

  it("rejects a missing or malformed cookie", async () => {
    const withoutCookie = await request(app).get("/api/v1/auth/me");
    const malformedCookie = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE_NAME}=invalid`);

    for (const response of [withoutCookie, malformedCookie]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("AUTH_REQUIRED");
    }
  });

  it("rejects an expired session", async () => {
    const token = generateSessionToken();
    await database.webSession.create({
      data: {
        userId: ownerId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects a revoked session", async () => {
    const token = generateSessionToken();
    await database.webSession.create({
      data: {
        userId: ownerId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `${SESSION_COOKIE_NAME}=${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("revokes the current session, clears the cookie and prevents reuse", async () => {
    const cookie = sessionCookie(await login());
    const token = tokenFromCookie(cookie);

    const logoutResponse = await request(app)
      .post("/api/v1/auth/logout")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie);

    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers["cache-control"]).toBe("no-store");
    expect(setCookieHeaders(logoutResponse)[0]).toContain(
      "Expires=Thu, 01 Jan 1970",
    );

    const storedSession = await database.webSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    expect(storedSession?.revokedAt).toBeInstanceOf(Date);

    const reusedSession = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookie);
    expect(reusedSession.status).toBe(401);
  });

  it("requires the configured Origin for logout", async () => {
    const cookie = sessionCookie(await login());
    const response = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("returns the common validation error for invalid and unknown fields", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .set("X-Request-Id", "validation-test-request")
      .send({ email: "invalid", password: "", unexpected: true });

    expect(response.status).toBe(400);
    expect(response.headers["x-request-id"]).toBe("validation-test-request");
    expect(response.body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "La solicitud contiene datos inválidos",
      requestId: "validation-test-request",
    });
    expect(response.body.error.details).toEqual(expect.any(Array));
    expect(response.body.error.details.length).toBeGreaterThan(0);
  });

  it("rate limits excessive login attempts", async () => {
    const limitedApp = createApp({
      config,
      database,
      loginRateLimit: { maxAttempts: 2, windowMs: 60_000 },
    });

    await login(OWNER_EMAIL, "wrong-password", limitedApp);
    await login(OWNER_EMAIL, "wrong-password", limitedApp);
    const response = await login(
      OWNER_EMAIL,
      "wrong-password",
      limitedApp,
    );

    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("60");
    expect(response.body.error).toMatchObject({
      code: "RATE_LIMITED",
      details: [],
    });
  });
});
