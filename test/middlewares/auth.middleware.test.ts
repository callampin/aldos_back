import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE,
  requireAdmin,
  type AppEnv,
} from '../../src/middlewares/auth.middleware';
import { errorHandler } from '../../src/middlewares/error.middleware';
import type { Env } from '../../src/types/bindings';

const JWT_SECRET = 'secreto-solo-para-pruebas';

/** Entorno mínimo: estas pruebas no tocan la base de datos. */
const env = { JWT_SECRET } as unknown as Env;

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use('*', requireAdmin);
  app.get('/protegido', (c) => c.json({ ok: true as const, admin: c.get('admin') }));
  app.onError(errorHandler);
  return app;
}

async function makeToken(
  payload: Record<string, unknown>,
  secret: string = JWT_SECRET,
): Promise<string> {
  return sign(payload, secret);
}

describe('Middleware requireAdmin (protección del panel)', () => {
  it('responde 401 con el contrato uniforme cuando no hay sesión', async () => {
    const response = await buildApp().request('/protegido', {}, env);
    const body = (await response.json()) as { ok: boolean; error: { code: string; message: string } };

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('sesión');
  });

  it('acepta el token por header Authorization: Bearer', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({
      sub: 1,
      email: 'contacto@aldosmotos.cl',
      name: 'Estrella',
      iat: now,
      exp: now + 600,
    });

    const response = await buildApp().request(
      '/protegido',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    const body = (await response.json()) as { ok: boolean; admin: { email: string; name: string } };

    expect(response.status).toBe(200);
    expect(body.admin.email).toBe('contacto@aldosmotos.cl');
    expect(body.admin.name).toBe('Estrella');
  });

  it('acepta el token por la cookie de sesión', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ sub: 7, email: 'contacto@aldosmotos.cl', exp: now + 600 });

    const response = await buildApp().request(
      '/protegido',
      { headers: { Cookie: `${ADMIN_SESSION_COOKIE}=${token}` } },
      env,
    );

    expect(response.status).toBe(200);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ sub: 1, email: 'contacto@aldosmotos.cl', exp: now + 600 }, 'otro-secreto');

    const response = await buildApp().request(
      '/protegido',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rechaza un token vencido', async () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    const token = await makeToken({ sub: 1, email: 'contacto@aldosmotos.cl', iat: past, exp: past + 60 });

    const response = await buildApp().request(
      '/protegido',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );

    expect(response.status).toBe(401);
  });

  it('rechaza un token válido pero sin identificador de administrador', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ email: 'contacto@aldosmotos.cl', exp: now + 600 });

    const response = await buildApp().request(
      '/protegido',
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );

    expect(response.status).toBe(401);
  });

  it('ignora un token basura', async () => {
    const response = await buildApp().request(
      '/protegido',
      { headers: { Authorization: 'Bearer no-es-un-jwt' } },
      env,
    );

    expect(response.status).toBe(401);
  });
});
