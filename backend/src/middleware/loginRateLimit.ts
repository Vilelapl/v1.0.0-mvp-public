import { createRateLimit, type RateLimitOptions } from "./rateLimit.js";

export type LoginRateLimitOptions = RateLimitOptions;

export const DEFAULT_LOGIN_RATE_LIMIT: LoginRateLimitOptions = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
};

export function createLoginRateLimit(
  options: LoginRateLimitOptions = DEFAULT_LOGIN_RATE_LIMIT,
) {
  return createRateLimit(options, "Demasiados intentos de inicio de sesión");
}
