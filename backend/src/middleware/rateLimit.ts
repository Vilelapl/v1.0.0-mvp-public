import type { RequestHandler } from "express";

import { AppError } from "../lib/api-error.js";

export type RateLimitOptions = {
  maxAttempts: number;
  windowMs: number;
};

type AttemptWindow = {
  count: number;
  resetsAt: number;
};

export function createRateLimit(
  options: RateLimitOptions,
  message: string,
): RequestHandler {
  const attempts = new Map<string, AttemptWindow>();
  let requestCount = 0;

  return (request, response, next) => {
    const now = Date.now();
    const key = request.ip || request.socket.remoteAddress || "unknown";
    const current = attempts.get(key);
    const attemptWindow =
      current && current.resetsAt > now
        ? current
        : { count: 0, resetsAt: now + options.windowMs };

    requestCount += 1;
    if (requestCount % 100 === 0) {
      for (const [storedKey, storedWindow] of attempts) {
        if (storedWindow.resetsAt <= now) {
          attempts.delete(storedKey);
        }
      }
    }

    if (attemptWindow.count >= options.maxAttempts) {
      response.setHeader(
        "Retry-After",
        String(Math.max(1, Math.ceil((attemptWindow.resetsAt - now) / 1000))),
      );
      next(new AppError("RATE_LIMITED", 429, message));
      return;
    }

    attemptWindow.count += 1;
    attempts.set(key, attemptWindow);
    next();
  };
}
