import { zValidator } from '@hono/zod-validator';
import { and, eq, gt } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { sign } from 'hono/jwt';
import { createDb } from '../../db';
import { admins } from '../../db/schema';
import {
  ADMIN_SESSION_COOKIE,
  requireAdmin,
  type AppEnv,
} from '../../middlewares/auth.middleware';
import { AppError, validationHook } from '../../middlewares/error.middleware';
import { rateLimit } from '../../middlewares/rate-limit.middleware';
import { buildPasswordResetEmail, sendTransactionalEmail } from '../../services/notification.service';
import { generateRandomToken, hashPassword, signHmacSha256, verifyPassword } from '../../utils/crypto';
import { runInBackground, type BackgroundContextLike } from '../../utils/background';
import { forgotPasswordSchema, loginSchema, resetPasswordSchema } from '../../validators/auth.schema';

/**
 * Autenticación del panel de Estrella.
 *
 * - La sesión se entrega como **cookie `HttpOnly`** (mecanismo principal).
 * - En desarrollo local (HTTP, no HTTPS) además se devuelve el token en el cuerpo,
 *   para poder usarlo como `Authorization: Bearer` (ver `NOTAS.md` H-12).
 * - Los errores de credenciales son siempre genéricos: nunca se revela si el correo existe.
 */
export const adminAuthRoutes = new Hono<AppEnv>();

/** Duración de la sesión del panel: 12 horas. */
const SESSION_TTL_SECONDS = 60 * 60 * 12;
/** Duración del enlace de recuperación de contraseña: 1 hora. */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * Hash ficticio (salt y hash en cero) con el formato correcto. Se usa para hacer el
 * trabajo de PBKDF2 incluso cuando el correo no existe, y así no filtrar por tiempo
 * de respuesta si una cuenta está registrada.
 */
const DUMMY_PASSWORD_HASH =
  'pbkdf2-sha256$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function isSecureRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

function setSessionCookie(context: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(context, ADMIN_SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(context.req.url),
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** `POST /api/v1/admin/auth/login` */
adminAuthRoutes.post(
  '/login',
  rateLimit({ name: 'admin-login', limit: 10, windowSeconds: 300 }),
  zValidator('json', loginSchema, validationHook),
  async (c) => {
    const { email, password } = c.req.valid('json');
    const db = createDb(c.env.DB);

    const [admin] = await db
      .select({
        id: admins.id,
        email: admins.email,
        name: admins.name,
        passwordHash: admins.passwordHash,
      })
      .from(admins)
      .where(eq(admins.email, email))
      .limit(1);

    const passwordMatches = await verifyPassword(
      password,
      admin?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!admin || !passwordMatches) {
      throw new AppError('INVALID_CREDENTIALS', 'El correo o la contraseña no son correctos.', 401);
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + SESSION_TTL_SECONDS;
    const token = await sign(
      {
        sub: admin.id,
        email: admin.email,
        name: admin.name,
        pwd: admin.passwordHash.slice(-16),
        iat: now,
        exp: expiresAt,
      },
      c.env.JWT_SECRET,
    );

    setSessionCookie(c, token);

    return c.json({
      ok: true as const,
      data: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        expiresAt,
        // Solo en desarrollo local (HTTP); en producción la sesión va solo en la cookie.
        ...(isSecureRequest(c.req.url) ? {} : { token }),
      },
    });
  },
);

/** `POST /api/v1/admin/auth/logout` */
adminAuthRoutes.post('/logout', (c) => {
  deleteCookie(c, ADMIN_SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true as const, data: { message: 'Tu sesión se cerró correctamente.' } });
});

/** `GET /api/v1/admin/auth/me` */
adminAuthRoutes.get('/me', requireAdmin, async (c) => {
  const session = c.get('admin');
  const db = createDb(c.env.DB);

  const [admin] = await db
    .select({ id: admins.id, email: admins.email, name: admins.name })
    .from(admins)
    .where(eq(admins.id, session.id))
    .limit(1);

  if (!admin) {
    throw new AppError('UNAUTHORIZED', 'Tu sesión no es válida. Vuelve a ingresar.', 401);
  }

  return c.json({
    ok: true as const,
    data: { admin, expiresAt: session.expiresAt },
  });
});

/** `POST /api/v1/admin/auth/forgot-password` */
adminAuthRoutes.post(
  '/forgot-password',
  rateLimit({ name: 'admin-forgot-password', limit: 5, windowSeconds: 900 }),
  zValidator('json', forgotPasswordSchema, validationHook),
  async (c) => {
    const { email } = c.req.valid('json');
    const db = createDb(c.env.DB);

    const [admin] = await db
      .select({ id: admins.id, email: admins.email, name: admins.name })
      .from(admins)
      .where(eq(admins.email, email))
      .limit(1);

    if (admin) {
      const token = generateRandomToken(32);
      // Se guarda solo el hash del token (con clave), nunca el token en claro.
      const tokenHash = await signHmacSha256(c.env.JWT_SECRET, token, 'hex');
      const expiresAt = new Date((Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECONDS) * 1000);

      await db
        .update(admins)
        .set({ resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt, updatedAt: new Date() })
        .where(eq(admins.id, admin.id));

      const resetUrl = `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/admin/login?recuperar=1&token=${token}`;
      const mail = buildPasswordResetEmail({
        adminName: admin.name,
        resetUrl,
        expiresMinutes: Math.round(RESET_TOKEN_TTL_SECONDS / 60),
      });

      // El correo se envía en segundo plano para no hacer esperar a quien lo pidió.
      runInBackground(
        c as unknown as BackgroundContextLike,
        sendTransactionalEmail(c.env, { to: admin.email, ...mail }).then((sent) => {
          if (!sent) {
            // Sin proveedor de correo (desarrollo local): se deja el enlace en el log.
            console.warn(`[auth] Enlace de recuperación para ${admin.email}: ${resetUrl}`);
          }
        }),
      );
    }

    // Respuesta siempre igual: no se revela si el correo está registrado.
    return c.json({
      ok: true as const,
      data: {
        message:
          'Si el correo está registrado, te enviamos las instrucciones para recuperar tu contraseña.',
      },
    });
  },
);

/** `POST /api/v1/admin/auth/reset-password` */
adminAuthRoutes.post(
  '/reset-password',
  rateLimit({ name: 'admin-reset-password', limit: 10, windowSeconds: 900 }),
  zValidator('json', resetPasswordSchema, validationHook),
  async (c) => {
    const { token, password } = c.req.valid('json');
    const db = createDb(c.env.DB);

    const tokenHash = await signHmacSha256(c.env.JWT_SECRET, token, 'hex');

    const [admin] = await db
      .select({ id: admins.id })
      .from(admins)
      .where(and(eq(admins.resetTokenHash, tokenHash), gt(admins.resetTokenExpiresAt, new Date())))
      .limit(1);

    if (!admin) {
      throw new AppError(
        'INVALID_RESET_TOKEN',
        'El enlace para cambiar la contraseña venció o no es válido. Pide uno nuevo.',
        400,
      );
    }

    const passwordHash = await hashPassword(password);

    await db
      .update(admins)
      .set({
        passwordHash,
        resetTokenHash: null,
        resetTokenExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(admins.id, admin.id));

    return c.json({
      ok: true as const,
      data: { message: 'Tu contraseña quedó actualizada. Ya puedes ingresar.' },
    });
  },
);
