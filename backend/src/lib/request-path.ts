import type { Request } from "express";

// Route templates are controlled by this application; arbitrary URL segments
// may contain private data and must never be copied into operational logs.
export function requestPathForLog(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === "string" ? `${request.baseUrl}${route.path}` : "[unmatched]";
}
