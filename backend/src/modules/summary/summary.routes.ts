import { Router } from "express";

import { authenticatedUserId } from "../../lib/authenticated-identity.js";
import { emptyBodySchema } from "../../lib/http-schemas.js";
import { authenticateWeb } from "../../middleware/authenticateWeb.js";
import { getValidatedQuery, validate } from "../../middleware/validate.js";
import type { AuthService } from "../auth/auth.service.js";
import type { SummaryRepository } from "./summary.repository.js";
import { summaryQuerySchema, type SummaryQuery } from "./summary.schemas.js";

export function createSummaryRouter(input: {
  repository: SummaryRepository; authService: AuthService; sessionCookieName: string;
}): Router {
  const router = Router();
  router.get("/", authenticateWeb(input.authService, input.sessionCookieName),
    validate({ body: emptyBodySchema, query: summaryQuerySchema }),
    async (request, response) => {
      const totals = await input.repository.totalsByUser(
        authenticatedUserId(request), getValidatedQuery<SummaryQuery>(response),
      );
      response.setHeader("Cache-Control", "no-store");
      response.json({ data: totals.map((row) => ({
        currency: row.currency,
        income: row.income.toFixed(2),
        expenses: row.expenses.toFixed(2),
        balance: row.balance.toFixed(2),
      })) });
    });
  return router;
}
