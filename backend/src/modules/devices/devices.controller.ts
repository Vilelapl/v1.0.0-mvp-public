import type { Request, RequestHandler } from "express";

import { AppError } from "../../lib/api-error.js";
import { getValidatedBody, getValidatedParams } from "../../middleware/validate.js";
import type { DeviceIdParams, PairInput } from "./devices.schemas.js";
import type { DevicesService } from "./devices.service.js";

function authenticatedUserId(request: Request): string {
  if (!request.webAuth) {
    throw new AppError("INTERNAL_ERROR", 500, "Ocurrió un error interno");
  }
  return request.webAuth.userId;
}

export function createDevicesController(service: DevicesService): {
  createPairingCode: RequestHandler;
  pair: RequestHandler;
  list: RequestHandler;
  revoke: RequestHandler;
} {
  return {
    createPairingCode: async (request, response) => {
      const data = await service.createPairingCode(authenticatedUserId(request));
      response.setHeader("Cache-Control", "no-store");
      response.status(201).json({ data });
    },
    pair: async (_request, response) => {
      const data = await service.pair(getValidatedBody<PairInput>(response));
      response.setHeader("Cache-Control", "no-store");
      response.status(201).json({ data });
    },
    list: async (request, response) => {
      const data = await service.list(authenticatedUserId(request));
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ data });
    },
    revoke: async (request, response) => {
      const { id } = getValidatedParams<DeviceIdParams>(response);
      await service.revoke(authenticatedUserId(request), id);
      response.sendStatus(204);
    },
  };
}
