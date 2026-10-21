import type { RequestHandler } from "express";

import { authenticationRequired } from "../lib/api-error.js";
import { readCookie } from "../lib/session-cookie.js";
import type { AuthService } from "../modules/auth/auth.service.js";

export function authenticateWeb(
  authService: AuthService,
  sessionCookieName: string,
): RequestHandler {
  return async (request, _response, next) => {
    const token = readCookie(request.get("cookie"), sessionCookieName);

    if (!token) {
      next(authenticationRequired());
      return;
    }

    const identity = await authService.authenticate(token);
    if (!identity) {
      next(authenticationRequired());
      return;
    }

    request.webAuth = identity;
    next();
  };
}
