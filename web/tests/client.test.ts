import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionExpired } from '../src/api/client';
import { failure, json } from './fixtures';

describe('cliente HTTP', () => {
  it('parsea JSON y usa credentials include sin Content-Type en GET', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(json({ data: { amount: '0.10' } }));
    vi.stubGlobal('fetch', mock);
    expect(await api.get('/transactions')).toEqual({ data: { amount: '0.10' } });
    expect(mock).toHaveBeenCalledWith('/api/v1/transactions', expect.objectContaining({ credentials: 'include', method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' }));
  });
  it.each(['post', 'patch'] as const)('%s transporta dinero como string y configura JSON', async (method) => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(json({ data: {} }));
    vi.stubGlobal('fetch', mock);
    await api[method]('/transactions', { amount: '999999999999.99' });
    expect(mock).toHaveBeenCalledWith('/api/v1/transactions', expect.objectContaining({ method: method.toUpperCase(), body: '{"amount":"999999999999.99"}', headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }));
  });
  it('acepta DELETE y 204 sin parsear JSON', async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', mock);
    await expect(api.delete('/example')).resolves.toBeUndefined();
    expect(mock).toHaveBeenCalledWith('/api/v1/example', expect.objectContaining({ method: 'DELETE' }));
  });
  it('parsea ApiError, detalles y requestId sin revelar mensajes arbitrarios', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'VALIDATION_ERROR', message: 'private stack', details: [{ field: 'amount', message: 'Debe ser positivo' }, null], requestId: 'abc' } }, 400)));
    const error = await api.post('/transactions', {}).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: [{ field: 'amount', message: 'Debe ser positivo' }], requestId: 'abc' });
    expect((error as ApiError).message).not.toContain('private');
  });
  it.each([400, 422, 403, 404, 409, 429, 500])('traduce HTTP %s sin mensajes internos', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure(status)));
    await expect(api.get('/summary')).rejects.toMatchObject({ status });
  });
  it('notifica 401, excepto login, y permite desuscribir', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(failure(401, 'AUTH_REQUIRED'))));
    const listener = vi.fn(); const unsubscribe = onSessionExpired(listener);
    await expect(api.get('/summary')).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
    await expect(api.post('/auth/login', {}, { ignoreUnauthorized: true })).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await expect(api.get('/summary')).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
  });
  it('maneja 401 incluso si el cuerpo no es JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid', { status: 401 })));
    const listener = vi.fn(); const unsubscribe = onSessionExpired(listener);
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledOnce(); unsubscribe();
  });
  it('aborta por timeout y limpia el temporizador', async () => {
    vi.useFakeTimers();
    const mock = vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', mock);
    const result = expect(api.get('/summary', { timeoutMs: 100 })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100); await result;
    expect(mock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('distingue cancelación externa de timeout', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_input, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const controller = new AbortController();
    const result = expect(api.get('/summary', { signal: controller.signal })).rejects.toMatchObject({ code: 'ABORTED' });
    controller.abort(); await result;
  });
  it('distingue fallo de red y éxito no JSON', async () => {
    const mock = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response('not json'));
    vi.stubGlobal('fetch', mock);
    await expect(api.get('/summary')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(api.get('/summary')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
