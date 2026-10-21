import { describe, expect, it } from "vitest";

import {
  EnvironmentConfigurationError,
  loadEnvironment,
} from "./env.js";

const VALID_ENVIRONMENT: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgresql://user:secret@localhost:5432/database",
  WEB_ORIGIN: "http://localhost:5173",
  SESSION_COOKIE_NAME: "gf_session",
  SESSION_TTL_MINUTES: "720",
  PAIRING_CODE_TTL_MINUTES: "5",
};

describe("runtime environment", () => {
  it("parses and types all required runtime values", () => {
    expect(loadEnvironment(VALID_ENVIRONMENT)).toEqual({
      nodeEnv: "development",
      port: 3000,
      databaseUrl: VALID_ENVIRONMENT.DATABASE_URL,
      webOrigin: "http://localhost:5173",
      sessionCookieName: "gf_session",
      sessionTtlMinutes: 720,
      pairingCodeTtlMinutes: 5,
    });
  });

  it.each([undefined, "", "0", "-1", "1.5", "invalid", "10081"])(
    "rejects an invalid pairing TTL: %s",
    (ttl) => {
      expect(() => loadEnvironment({
        ...VALID_ENVIRONMENT,
        PAIRING_CODE_TTL_MINUTES: ttl,
      })).toThrow("PAIRING_CODE_TTL_MINUTES");
    },
  );

  it("reports invalid variable names without exposing their values", () => {
    const invalidEnvironment = {
      ...VALID_ENVIRONMENT,
      DATABASE_URL: "not-a-database-secret-value",
      SESSION_TTL_MINUTES: "0",
    };

    let capturedError: unknown;
    try {
      loadEnvironment(invalidEnvironment);
    } catch (error: unknown) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(EnvironmentConfigurationError);
    expect((capturedError as Error).message).toContain("DATABASE_URL");
    expect((capturedError as Error).message).toContain("SESSION_TTL_MINUTES");
    expect((capturedError as Error).message).not.toContain(
      "not-a-database-secret-value",
    );
  });

  it("rejects HTTP web origins in production", () => {
    expect(() => loadEnvironment({ ...VALID_ENVIRONMENT, NODE_ENV: "production" }))
      .toThrow("WEB_ORIGIN");
  });

  it("accepts a canonical HTTPS web origin in production", () => {
    expect(loadEnvironment({
      ...VALID_ENVIRONMENT, NODE_ENV: "production", WEB_ORIGIN: "https://finance.example.com",
    }).webOrigin).toBe("https://finance.example.com");
  });
});
