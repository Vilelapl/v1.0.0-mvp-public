import type { Request } from "express";

import { AppError } from "./api-error.js";

export function authenticatedUserId(request: Request): string {
  if (!request.webAuth) {
    throw new AppError("INTERNAL_ERROR", 500, "Ocurrió un error interno");
  }
  return request.webAuth.userId;
}

export function authenticatedDevice(request: Request): Express.AuthenticatedDeviceIdentity {
  if (!request.deviceAuth) {
    throw new AppError("INTERNAL_ERROR", 500, "Ocurrió un error interno");
  }
  return request.deviceAuth;
}
