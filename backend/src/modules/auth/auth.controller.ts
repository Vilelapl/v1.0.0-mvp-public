import type { Request, RequestHandler } from "express";

import { AppError } from "../../lib/api-error.js";
import {
  clearSessionCookie,
  setSessionCookie,
  type SessionCookieConfiguration,
} from "../../lib/session-cookie.js";
import { getValidatedBody } from "../../middleware/validate.js";
import type { LoginInput } from "./auth.schema.js";
import type { AuthService } from "./auth.service.js";

function authenticatedIdentity(
  request: Request,
): Express.AuthenticatedWebIdentity {
  if (!request.webAuth) {
    throw new AppError("INTERNAL_ERROR", 500, "Ocurrió un error interno");
  }

  return request.webAuth;
}

export function createAuthController(
  authService: AuthService,
  cookieConfiguration: SessionCookieConfiguration,
): {
  login: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
} {
  return {
    login: async (_request, response) => {
      const input = getValidatedBody<LoginInput>(response);
      const result = await authService.login(input);

      setSessionCookie(
        response,
        cookieConfiguration,
        result.token,
        result.expiresAt,
      );
      response.status(200).json({ data: result.user });
    },

    logout: async (request, response) => {
      const identity = authenticatedIdentity(request);
      await authService.logout(identity.sessionId);
      clearSessionCookie(response, cookieConfiguration);
      response.sendStatus(204);
    },

    me: (request, response) => {
      const identity = authenticatedIdentity(request);
      response.status(200).json({
        data: {
          id: identity.userId,
          email: identity.email,
        },
      });
    },
  };
}
