import { Router } from "express";

import { emptyBodySchema, emptyQuerySchema, idParamsSchema } from "../../lib/http-schemas.js";
import { authenticateDevice } from "../../middleware/authenticateDevice.js";
import { authenticateWeb } from "../../middleware/authenticateWeb.js";
import { requireTrustedOrigin } from "../../middleware/origin.js";
import { validate } from "../../middleware/validate.js";
import type { AuthService } from "../auth/auth.service.js";
import type { DevicesService } from "../devices/devices.service.js";
import { createTransactionsController } from "./transactions.controller.js";
import { createManualSchema, deviceSyncSchema, listTransactionsSchema, updateTransactionSchema } from "./transactions.schemas.js";
import type { TransactionsService } from "./transactions.service.js";

export function createTransactionsRouter(input: {
  service: TransactionsService; authService: AuthService;
  sessionCookieName: string; webOrigin: string;
}): Router {
  const router = Router();
  const controller = createTransactionsController(input.service);
  router.use(authenticateWeb(input.authService, input.sessionCookieName));
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  const origin = requireTrustedOrigin(input.webOrigin);
  router.get("/", validate({ body: emptyBodySchema, query: listTransactionsSchema }), controller.list);
  router.get("/:id", validate({ params: idParamsSchema, body: emptyBodySchema, query: emptyQuerySchema }), controller.detail);
  router.post("/", origin, validate({ body: createManualSchema, query: emptyQuerySchema }), controller.createManual);
  router.patch("/:id", origin, validate({ params: idParamsSchema, body: updateTransactionSchema, query: emptyQuerySchema }), controller.update);
  return router;
}

export function createDeviceSyncRouter(service: TransactionsService, devicesService: DevicesService): Router {
  const router = Router();
  router.post("/sync", authenticateDevice(devicesService),
    validate({ body: deviceSyncSchema, query: emptyQuerySchema }),
    (_request, response, next) => {
      response.setHeader("Cache-Control", "no-store");
      next();
    }, createTransactionsController(service).sync);
  return router;
}
