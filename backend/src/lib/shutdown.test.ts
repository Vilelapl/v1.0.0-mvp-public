import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "./prisma.js";
import { closeBackend } from "./shutdown.js";

describe("backend shutdown", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it("closes HTTP before disconnecting Prisma and clears its deadline", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const server = {
      close: (callback: () => void) => { order.push("http"); callback(); },
      closeAllConnections: vi.fn(),
    };
    const database = { $disconnect: async () => { order.push("database"); } };
    await closeBackend(server as unknown as Server, database as unknown as DatabaseClient);
    expect(order).toEqual(["http", "database"]);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["http", "database"])("forces termination if %s does not close within ten seconds", async (stalled) => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const server = {
      close: (callback: () => void) => {
        if (stalled === "http") void pending.then(callback);
        else callback();
      },
      closeAllConnections: vi.fn(),
    };
    const database = { $disconnect: () => stalled === "database" ? pending : Promise.resolve() };
    const shutdown = closeBackend(server as unknown as Server, database as unknown as DatabaseClient);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
    finish();
    await shutdown;
  });
});
