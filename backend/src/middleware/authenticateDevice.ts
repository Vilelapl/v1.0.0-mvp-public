import type { RequestHandler } from "express";

import { authenticationRequired } from "../lib/api-error.js";
import type { DevicesService } from "../modules/devices/devices.service.js";

export function authenticateDevice(devicesService: DevicesService): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.get("authorization");
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/iu)?.[1];
    const identity = token ? await devicesService.authenticate(token) : null;

    if (!identity) {
      next(authenticationRequired());
      return;
    }

    request.deviceAuth = identity;
    next();
  };
}
