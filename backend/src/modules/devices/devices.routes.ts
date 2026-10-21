import { Router } from "express";

import { authenticateWeb } from "../../middleware/authenticateWeb.js";
import { requireTrustedOrigin } from "../../middleware/origin.js";
import { createRateLimit, type RateLimitOptions } from "../../middleware/rateLimit.js";
import { validate } from "../../middleware/validate.js";
import type { AuthService } from "../auth/auth.service.js";
import { createDevicesController } from "./devices.controller.js";
import {
  deviceIdParamsSchema,
  emptyBodySchema,
  emptyQuerySchema,
  pairBodySchema,
} from "./devices.schemas.js";
import type { DevicesService } from "./devices.service.js";

export const DEFAULT_PAIRING_RATE_LIMIT: RateLimitOptions = {
  maxAttempts: 5,
  windowMs: 5 * 60 * 1000,
};

export function createDevicesRouter(input: {
  devicesService: DevicesService;
  authService: AuthService;
  sessionCookieName: string;
  webOrigin: string;
  pairingRateLimit?: RateLimitOptions;
}): Router {
  const router = Router();
  const controller = createDevicesController(input.devicesService);
  const authenticate = authenticateWeb(input.authService, input.sessionCookieName);
  const trustedOrigin = requireTrustedOrigin(input.webOrigin);

  router.post(
    "/pair",
    createRateLimit(
      input.pairingRateLimit ?? DEFAULT_PAIRING_RATE_LIMIT,
      "Demasiados intentos de emparejamiento",
    ),
    validate({ body: pairBodySchema, query: emptyQuerySchema }),
    controller.pair,
  );
  router.post(
    "/pairing-codes",
    authenticate,
    trustedOrigin,
    validate({ body: emptyBodySchema, query: emptyQuerySchema }),
    controller.createPairingCode,
  );
  router.get(
    "/",
    authenticate,
    validate({ body: emptyBodySchema, query: emptyQuerySchema }),
    controller.list,
  );
  router.delete(
    "/:id",
    authenticate,
    trustedOrigin,
    validate({
      params: deviceIdParamsSchema,
      body: emptyBodySchema,
      query: emptyQuerySchema,
    }),
    controller.revoke,
  );

  return router;
}
