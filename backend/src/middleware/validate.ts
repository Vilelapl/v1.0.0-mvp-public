import type { RequestHandler, Response } from "express";
import type { ZodType } from "zod";

import { AppError, type ApiErrorDetail } from "../lib/api-error.js";

type ValidationTarget = "body" | "params" | "query";

type ValidationSchemas = Partial<Record<ValidationTarget, ZodType>>;

type ValidatedRequest = Partial<Record<ValidationTarget, unknown>>;

function issueField(target: ValidationTarget, path: readonly PropertyKey[]): string {
  const field = path.map(String).join(".");
  return field.length > 0 ? field : target;
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (request, response, next) => {
    const validated: ValidatedRequest = {};
    const details: ApiErrorDetail[] = [];

    for (const target of ["body", "params", "query"] as const) {
      const schema = schemas[target];
      if (!schema) {
        continue;
      }

      const result = schema.safeParse(request[target]);
      if (result.success) {
        validated[target] = result.data;
        continue;
      }

      details.push(
        ...result.error.issues.map((issue) => ({
          field: issueField(target, issue.path),
          message: issue.message,
        })),
      );
    }

    if (details.length > 0) {
      next(
        new AppError(
          "VALIDATION_ERROR",
          400,
          "La solicitud contiene datos inválidos",
          details,
        ),
      );
      return;
    }

    response.locals.validatedRequest = validated;
    next();
  };
}

export function getValidatedBody<T>(response: Response): T {
  const locals = response.locals as {
    validatedRequest?: ValidatedRequest;
  };

  return locals.validatedRequest?.body as T;
}

export function getValidatedParams<T>(response: Response): T {
  const locals = response.locals as {
    validatedRequest?: ValidatedRequest;
  };

  return locals.validatedRequest?.params as T;
}

export function getValidatedQuery<T>(response: Response): T {
  const locals = response.locals as { validatedRequest?: ValidatedRequest };
  return locals.validatedRequest?.query as T;
}
