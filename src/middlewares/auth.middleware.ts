import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';

import { AppError } from './error.middleware';
import type { Env } from '../types/bindings';

/** Nombre de la cookie de sesión del panel de Estrella. */
export const ADMIN_SESSION_COOKIE = 'aldos_admin_session';

/** Datos del administrador autenticado, disponibles en `c.get('admin')`. */
export interface AdminSession {
  id: number;
  email: string;
  name: string;
  /** Timestamp Unix (segundos) en que expira la sesión. */
  expiresAt: number;
}

/** Variables disponibles en el contexto de las rutas del panel. */
export interface AuthVariables {
  admin: AdminSession;
}

/** Entorno de la aplicación Hono (bindings + variables de autenticación). */
export type AppEnv = { Bindings: Env; Variables: AuthVariables };

/** Obtiene el token desde el header `Authorization: Bearer` o desde la cookie `HttpOnly`. */
function extractToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token.length > 0) return token;
  }

  return getCookie(c, ADMIN_SESSION_COOKIE) ?? null;
}

/** Error estándar cuando falta la sesión. */
function unauthorized(message: string, code = 'UNAUTHORIZED'): AppError {
  return new AppError(code, message, 401);
}

/**
 * Middleware que exige una sesión válida del panel de Estrella.
 *
 * Se aplica en `src/index.ts` a todo `/api/v1/admin/*` (salvo el paquete de
 * autenticación) y de forma explícita en las rutas que necesitan los datos del
 * administrador. Si el token no viene, está vencido o fue firmado con otro secreto,
 * responde `401` con el contrato uniforme de la API.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractToken(c);

  if (token === null) {
    throw unauthorized('Tu sesión no está iniciada. Ingresa con tu correo y contraseña.');
  }

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token, c.env.JWT_SECRET, 'HS256');
  } catch {
    throw unauthorized('Tu sesión venció o no es válida. Vuelve a ingresar.', 'SESSION_EXPIRED');
  }

  const id = Number(payload['sub']);
  const email = payload['email'];
  if (!Number.isInteger(id) || typeof email !== 'string' || email.length === 0) {
    throw unauthorized('Tu sesión no es válida. Vuelve a ingresar.');
  }

  const name = payload['name'];
  c.set('admin', {
    id,
    email,
    name: typeof name === 'string' ? name : '',
    expiresAt: Number(payload['exp'] ?? 0),
  });

  await next();
};
