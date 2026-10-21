import type { RequestHandler } from "express";

import { AppError } from "../lib/api-error.js";

function forbiddenOrigin(): AppError {
  return new AppError("FORBIDDEN", 403, "Origen no permitido");
}

export function corsForOrigin(webOrigin: string): RequestHandler {
  return (request, response, next) => {
    const origin = request.get("origin");

    if (!origin) {
      if (request.method === "OPTIONS") {
        next(forbiddenOrigin());
        return;
      }

      next();
      return;
    }

    if (origin !== webOrigin) {
      next(forbiddenOrigin());
      return;
    }

    response.vary("Origin");
    response.setHeader("Access-Control-Allow-Origin", webOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");

    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      response.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, X-Request-Id",
      );
      response.sendStatus(204);
      return;
    }

    next();
  };
}

export function requireTrustedOrigin(webOrigin: string): RequestHandler {
  return (request, _response, next) => {
    if (request.get("origin") !== webOrigin) {
      next(forbiddenOrigin());
      return;
    }

    next();
  };
}
