import type { Server } from "node:http";
import type { DatabaseClient } from "./prisma.js";

export async function closeBackend(server: Server, database: DatabaseClient): Promise<void> {
  const forceClose = setTimeout(() => {
    server.closeAllConnections();
    console.error(JSON.stringify({ level: "error", event: "server_shutdown_timeout" }));
    process.exit(1);
  }, 10_000);
  forceClose.unref();

  try {
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
    await database.$disconnect();
  } finally {
    clearTimeout(forceClose);
  }
}
