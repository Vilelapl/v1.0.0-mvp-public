import { Router } from "express";

import { authenticatedUserId } from "../../lib/authenticated-identity.js";
import { emptyBodySchema, emptyQuerySchema } from "../../lib/http-schemas.js";
import { authenticateWeb } from "../../middleware/authenticateWeb.js";
import { validate } from "../../middleware/validate.js";
import type { AuthService } from "../auth/auth.service.js";
import type { CategoriesRepository } from "./categories.repository.js";

export function createCategoriesRouter(input: {
  repository: CategoriesRepository; authService: AuthService; sessionCookieName: string;
}): Router {
  const router = Router();
  router.get("/", authenticateWeb(input.authService, input.sessionCookieName),
    validate({ body: emptyBodySchema, query: emptyQuerySchema }),
    async (request, response) => {
      const data = await input.repository.listByUser(authenticatedUserId(request));
      response.setHeader("Cache-Control", "no-store");
      response.json({ data });
    });
  return router;
}
