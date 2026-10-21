import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export const requestId: RequestHandler = (request, response, next) => {
  const suppliedRequestId = request.get("x-request-id")?.trim();

  request.requestId =
    suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId)
      ? suppliedRequestId
      : randomUUID();

  response.setHeader("X-Request-Id", request.requestId);
  next();
};
