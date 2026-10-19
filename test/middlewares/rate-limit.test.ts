import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';

import { errorHandler } from '../../src/middlewares/error.middleware';
import { clearRateLimitStore, rateLimit } from '../../src/middlewares/rate-limit.middleware';

function buildApp(limit: number, windowSeconds: number) {
  const app = new Hono();
  app.use('*', rateLimit({ name: 'prueba', limit, windowSeconds }));
  app.get('/recurso', (c) => c.json({ ok: true as const }));
  app.onError(errorHandler);
  return app;
}

function request(app: Hono, ip = '1.2.3.4') {
  return app.request('/recurso', { headers: { 'CF-Connecting-IP': ip } });
}

describe('Middleware rateLimit', () => {
  beforeEach(() => {
    clearRateLimitStore();
  });

  it('permite hasta el límite y luego responde 429 con Retry-After', async () => {
    const app = buildApp(3, 300);

    for (let i = 0; i < 3; i += 1) {
      const response = await request(app);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app);
    const body = (await blocked.json()) as { ok: boolean; error: { code: string; message: string } };

    expect(blocked.status).toBe(429);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toContain('Demasiados intentos');
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('lleva contadores separados por IP', async () => {
    const app = buildApp(1, 300);

    expect((await request(app, '1.1.1.1')).status).toBe(200);
    expect((await request(app, '1.1.1.1')).status).toBe(429);
    // Otra IP no se ve afectada.
    expect((await request(app, '2.2.2.2')).status).toBe(200);
  });

  it('usa X-Forwarded-For cuando no hay CF-Connecting-IP', async () => {
    const app = buildApp(1, 300);

    const first = await app.request('/recurso', {
      headers: { 'X-Forwarded-For': '10.0.0.9, 10.0.0.1' },
    });
    const second = await app.request('/recurso', {
      headers: { 'X-Forwarded-For': '10.0.0.9, 10.0.0.2' },
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  it('libera la ventana cuando pasa el tiempo', async () => {
    const app = buildApp(1, 1);

    expect((await request(app)).status).toBe(200);
    expect((await request(app)).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect((await request(app)).status).toBe(200);
  });
});
