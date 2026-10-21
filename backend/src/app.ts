import express, { type Express } from "express";

import type { Environment } from "./config/env.js";
import type { DatabaseClient } from "./lib/prisma.js";
import { createReadinessCheck } from "./lib/readiness.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import type { LoginRateLimitOptions } from "./middleware/loginRateLimit.js";
import { corsForOrigin } from "./middleware/origin.js";
import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { createAuthRouter } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import type { RateLimitOptions } from "./middleware/rateLimit.js";
import { DevicesRepository } from "./modules/devices/devices.repository.js";
import { createDevicesRouter } from "./modules/devices/devices.routes.js";
import { DevicesService } from "./modules/devices/devices.service.js";
import { CategoriesRepository } from "./modules/categories/categories.repository.js";
import { createCategoriesRouter } from "./modules/categories/categories.routes.js";
import { SummaryRepository } from "./modules/summary/summary.repository.js";
import { createSummaryRouter } from "./modules/summary/summary.routes.js";
import { TransactionsRepository } from "./modules/transactions/transactions.repository.js";
import { createDeviceSyncRouter, createTransactionsRouter } from "./modules/transactions/transactions.routes.js";
import { TransactionsService } from "./modules/transactions/transactions.service.js";

export type CreateAppOptions = {
  config: Environment;
  database: DatabaseClient;
  loginRateLimit?: LoginRateLimitOptions;
  pairingRateLimit?: RateLimitOptions;
};

export function createApp(options: CreateAppOptions): Express {
  const app = express();
  const checkReadiness = createReadinessCheck(options.database);
  const authRepository = new AuthRepository(options.database);
  const authService = new AuthService(
    authRepository,
    options.config.sessionTtlMinutes,
  );
  const devicesService = new DevicesService(
    new DevicesRepository(options.database),
    options.config.pairingCodeTtlMinutes,
  );
  const categoriesRepository = new CategoriesRepository(options.database);
  const transactionsService = new TransactionsService(
    new TransactionsRepository(options.database), categoriesRepository,
  );

  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use(requestId);
  app.use(requestLogger);
  app.use(corsForOrigin(options.config.webOrigin));
  app.use(express.json({ limit: "32kb", strict: true }));
  app.get("/health/live", (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ status: "ok" });
  });
  app.get("/health/ready", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const ready = await checkReadiness();
    response.status(ready ? 200 : 503).json({ status: ready ? "ready" : "unavailable" });
  });
  app.use(
    "/api/v1/auth",
    createAuthRouter({
      authService,
      sessionCookieName: options.config.sessionCookieName,
      secureCookie: options.config.nodeEnv === "production",
      webOrigin: options.config.webOrigin,
      ...(options.loginRateLimit
        ? { loginRateLimit: options.loginRateLimit }
        : {}),
    }),
  );
  app.use(
    "/api/v1/devices",
    createDevicesRouter({
      devicesService,
      authService,
      sessionCookieName: options.config.sessionCookieName,
      webOrigin: options.config.webOrigin,
      ...(options.pairingRateLimit
        ? { pairingRateLimit: options.pairingRateLimit }
        : {}),
    }),
  );
  app.use("/api/v1/device/transactions", createDeviceSyncRouter(transactionsService, devicesService));
  app.use("/api/v1/transactions", createTransactionsRouter({
    service: transactionsService, authService,
    sessionCookieName: options.config.sessionCookieName,
    webOrigin: options.config.webOrigin,
  }));
  app.use("/api/v1/categories", createCategoriesRouter({
    repository: categoriesRepository, authService,
    sessionCookieName: options.config.sessionCookieName,
  }));
  app.use("/api/v1/summary", createSummaryRouter({
    repository: new SummaryRepository(options.database), authService,
    sessionCookieName: options.config.sessionCookieName,
  }));
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
