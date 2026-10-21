import type { ErrorRequestHandler, RequestHandler } from "express";

import { AppError } from "../lib/api-error.js";
import { requestPathForLog } from "../lib/request-path.js";

function malformedJsonError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "body" in error
  );
}

function payloadTooLargeError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const possibleBodyParserError = error as {
    status?: unknown;
    type?: unknown;
  };
  return (
    possibleBodyParserError.status === 413 ||
    possibleBodyParserError.type === "entity.too.large"
  );
}

export const notFound: RequestHandler = (_request, _response, next) => {
  next(
    new AppError(
      "NOT_FOUND",
      404,
      "Ruta no encontrada",
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  let apiError: AppError;

  if (error instanceof AppError) {
    apiError = error;
  } else if (payloadTooLargeError(error)) {
    apiError = new AppError(
      "VALIDATION_ERROR",
      413,
      "El cuerpo de la solicitud excede el límite permitido",
    );
  } else if (malformedJsonError(error)) {
    apiError = new AppError(
      "VALIDATION_ERROR",
      400,
      "La solicitud contiene JSON inválido",
    );
  } else {
    console.error(
      JSON.stringify({
        level: "error",
        event: "request_failed",
        requestId: request.requestId,
        method: request.method,
        path: requestPathForLog(request),
        errorName:
          error instanceof Error ? error.constructor.name : "UnknownError",
      }),
    );
    apiError = new AppError(
      "INTERNAL_ERROR",
      500,
      "Ocurrió un error interno",
    );
  }

  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      requestId: request.requestId,
    },
  });
};
