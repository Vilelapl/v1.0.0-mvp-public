export type ApiErrorCode = 'VALIDATION_ERROR' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'RATE_LIMITED' | 'INTERNAL_ERROR' | 'NETWORK_ERROR' | 'TIMEOUT'
  | 'ABORTED' | 'INVALID_RESPONSE' | 'HTTP_ERROR';
export interface ErrorDetail { field: string; message: string }

const messages: Record<number, string> = {
  400: 'Revisa los datos e inténtalo de nuevo.',
  422: 'Revisa los datos e inténtalo de nuevo.',
  401: 'Tu sesión ha terminado. Inicia sesión de nuevo.',
  403: 'No tienes acceso a esta operación.',
  404: 'No se encontró el recurso solicitado.',
  409: 'No se pudo guardar por un conflicto. Actualiza e inténtalo de nuevo.',
  429: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.',
};
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: readonly ErrorDetail[] = [],
    public readonly requestId?: string,
  ) { super(message); this.name = 'ApiError'; }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
const knownCodes = new Set<string>([
  'VALIDATION_ERROR', 'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR',
]);
function httpError(status: number, payload: unknown): ApiError {
  const error = record(payload) && record(payload.error) ? payload.error : {};
  const code = typeof error.code === 'string' && knownCodes.has(error.code)
    ? error.code as ApiErrorCode : 'HTTP_ERROR';
  const details = Array.isArray(error.details) ? error.details.filter((value): value is ErrorDetail =>
    record(value) && typeof value.field === 'string' && typeof value.message === 'string') : [];
  // Parse the contract but never display arbitrary server messages or stacks.
  return new ApiError(status, code, messages[status] ?? 'No se pudo completar la solicitud. Inténtalo de nuevo.',
    details, typeof error.requestId === 'string' ? error.requestId : undefined);
}
const sessionListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}
interface Options {
  signal?: AbortSignal;
  timeoutMs?: number;
  ignoreUnauthorized?: boolean;
}
const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/+$/, '');

// The only fetch call in the application. No credentials are stored in JS.
async function request<T>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (response.status === 401 && !options.ignoreUnauthorized) sessionListeners.forEach((listener) => listener());
    if (response.status === 204 && response.ok) return undefined as T;
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) {
      if (controller.signal.aborted) throw error;
      if (!response.ok) throw httpError(response.status, undefined);
      throw new ApiError(response.status, 'INVALID_RESPONSE', 'El servidor devolvió una respuesta no válida.');
    }
    if (!response.ok) throw httpError(response.status, payload);
    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted) throw new ApiError(0, timedOut ? 'TIMEOUT' : 'ABORTED',
      timedOut ? 'La solicitud tardó demasiado. Comprueba la conexión antes de reintentar.' : 'Solicitud cancelada.');
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el servidor. Revisa la conexión.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
export const api = {
  get: <T>(path: string, options?: Options) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: Options) => request<T>('POST', path, body, options),
  patch: <T>(path: string, body: unknown, options?: Options) => request<T>('PATCH', path, body, options),
  delete: <T = void>(path: string, options?: Options) => request<T>('DELETE', path, undefined, options),
};
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Ocurrió un error. Inténtalo de nuevo.';
}
