import type { RequestHandler } from "express";

import { authenticatedDevice, authenticatedUserId } from "../../lib/authenticated-identity.js";
import { getValidatedBody, getValidatedParams, getValidatedQuery } from "../../middleware/validate.js";
import type { CreateManualInput, DeviceSyncInput, ListTransactionsQuery, UpdateTransactionInput } from "./transactions.schemas.js";
import type { TransactionsService } from "./transactions.service.js";

export function createTransactionsController(service: TransactionsService): {
  sync: RequestHandler; list: RequestHandler; detail: RequestHandler;
  createManual: RequestHandler; update: RequestHandler;
} {
  return {
    sync: async (request, response) => {
      const data = await service.sync(authenticatedDevice(request), getValidatedBody<DeviceSyncInput>(response));
      response.status(data.syncResult === "created" ? 201 : 200).json({ data });
    },
    list: async (request, response) => {
      response.json(await service.list(authenticatedUserId(request), getValidatedQuery<ListTransactionsQuery>(response)));
    },
    detail: async (request, response) => {
      const { id } = getValidatedParams<{ id: string }>(response);
      response.json({ data: await service.detail(authenticatedUserId(request), id) });
    },
    createManual: async (request, response) => {
      const data = await service.createManual(authenticatedUserId(request), getValidatedBody<CreateManualInput>(response));
      response.status(201).json({ data });
    },
    update: async (request, response) => {
      const { id } = getValidatedParams<{ id: string }>(response);
      const data = await service.update(authenticatedUserId(request), id, getValidatedBody<UpdateTransactionInput>(response));
      response.json({ data });
    },
  };
}
