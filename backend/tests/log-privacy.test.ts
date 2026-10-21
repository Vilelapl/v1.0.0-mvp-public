import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler, notFound } from "../src/middleware/errorHandler.js";
import { requestId } from "../src/middleware/requestId.js";
import { requestLogger } from "../src/middleware/requestLogger.js";

describe("request log privacy", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("does not log or reflect private data in unmatched paths or query strings", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = express().use(requestId).use(requestLogger).use(notFound).use(errorHandler);
    const secret = "private-card-4444333322221111";
    const response = await request(app).get(`/unknown/${secret}?token=private-token`).expect(404);
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(JSON.stringify(info.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(info.mock.calls)).not.toContain("private-token");
    expect(JSON.parse(String(info.mock.calls[0]?.[0])).path).toBe("[unmatched]");
  });

  it("logs registered route templates on completion and internal failure", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = express().use(requestId).use(requestLogger);
    app.get("/api/v1/transactions/:id", () => { throw new Error("private-database-error"); });
    app.use(errorHandler);
    await request(app).get("/api/v1/transactions/private-value").expect(500);
    for (const calls of [info.mock.calls, errors.mock.calls]) {
      const serialized = JSON.stringify(calls);
      expect(serialized).not.toContain("private-value");
      expect(serialized).not.toContain("private-database-error");
      expect(JSON.parse(String(calls[0]?.[0])).path).toBe("/api/v1/transactions/:id");
    }
  });
});
