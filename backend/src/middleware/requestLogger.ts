import { performance } from "node:perf_hooks";

import type { RequestHandler } from "express";
import { requestPathForLog } from "../lib/request-path.js";

export const requestLogger: RequestHandler = (request, response, next) => {
  const startedAt = performance.now();

  response.on("finish", () => {
    console.info(
      JSON.stringify({
        level: "info",
        event: "request_completed",
        requestId: request.requestId,
        method: request.method,
        path: requestPathForLog(request),
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });

  next();
};
