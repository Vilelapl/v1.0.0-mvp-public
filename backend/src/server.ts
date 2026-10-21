import "dotenv/config";

import type { Server } from "node:http";

import { createApp } from "./app.js";
import {
  EnvironmentConfigurationError,
  loadEnvironment,
} from "./config/env.js";
import { createPrismaClient } from "./lib/prisma.js";
import { closeBackend } from "./lib/shutdown.js";

async function startServer(): Promise<void> {
  const config = loadEnvironment();
  const database = createPrismaClient(config.databaseUrl);
  const app = createApp({ config, database });
  let server: Server;
  let shuttingDown = false;

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    console.info(
      JSON.stringify({ level: "info", event: "server_stopping", reason }),
    );

    try {
      await closeBackend(server, database);
      process.exitCode = exitCode;
    } catch {
      console.error(JSON.stringify({ level: "error", event: "server_shutdown_failed" }));
      process.exit(1);
    }
  };

  server = app.listen(config.port, () => {
    console.info(
      JSON.stringify({
        level: "info",
        event: "server_started",
        port: config.port,
        environment: config.nodeEnv,
      }),
    );
  });

  server.on("error", () => {
    console.error(
      JSON.stringify({ level: "error", event: "server_listen_failed" }),
    );
    void shutdown("server_error", 1);
  });
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch((error: unknown) => {
  if (error instanceof EnvironmentConfigurationError) {
    console.error(error.message);
  } else {
    console.error("Backend startup failed. Verify configuration and database access.");
  }
  process.exitCode = 1;
});
