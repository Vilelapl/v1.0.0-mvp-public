import { Router } from "express";

import { authenticateWeb } from "../../middleware/authenticateWeb.js";
import {
  createLoginRateLimit,
  type LoginRateLimitOptions,
} from "../../middleware/loginRateLimit.js";
import { requireTrustedOrigin } from "../../middleware/origin.js";
import { validate } from "../../middleware/validate.js";
import { createAuthController } from "./auth.controller.js";
import { loginBodySchema } from "./auth.schema.js";
import type { AuthService } from "./auth.service.js";

export function createAuthRouter(input: {
  authService: AuthService;
  sessionCookieName: string;
  secureCookie: boolean;
  webOrigin: string;
  loginRateLimit?: LoginRateLimitOptions;
}): Router {
  const router = Router();
  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });
  const controller = createAuthController(input.authService, {
    cookieName: input.sessionCookieName,
    secure: input.secureCookie,
  });
  const authenticate = authenticateWeb(
    input.authService,
    input.sessionCookieName,
  );
  const trustedOrigin = requireTrustedOrigin(input.webOrigin);
  const loginRateLimit = input.loginRateLimit
    ? createLoginRateLimit(input.loginRateLimit)
    : createLoginRateLimit();

  router.post(
    "/login",
    trustedOrigin,
    loginRateLimit,
    validate({ body: loginBodySchema }),
    controller.login,
  );
  router.get("/me", authenticate, controller.me);
  router.post("/logout", authenticate, trustedOrigin, controller.logout);

  return router;
}
