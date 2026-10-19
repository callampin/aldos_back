import type { ErrorHandler, NotFoundHandler } from 'hono';
import type { Hook } from '@hono/zod-validator';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';

/**
 * Error de negocio controlado. Permite responder con el contrato uniforme:
 * `{ ok: false, error: { code, message, details } }`
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: ContentfulStatusCode;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status: ContentfulStatusCode = 400,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Traduce un código HTTP a un código de error de la API. */
function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
  }
}

/**
 * Manejador global de errores. Nunca filtra stack traces ni detalles técnicos
 * al cliente: la respuesta siempre trae un mensaje claro en español.
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    console.error(`[AppError] ${err.code}: ${err.message}`);
    return c.json(
      {
        ok: false as const,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details === undefined ? {} : { details: err.details }),
        },
      },
      err.status,
    );
  }

  if (err instanceof HTTPException) {
    const status = err.status;
    return c.json(
      {
        ok: false as const,
        error: {
          code: codeFromStatus(status),
          message: err.message || 'No se pudo completar la solicitud.',
        },
      },
      status,
    );
  }

  console.error('[UnhandledError]', err);
  return c.json(
    {
      ok: false as const,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Ocurrió un error inesperado. Intenta nuevamente en unos minutos.',
      },
    },
    500,
  );
};

/** Respuesta uniforme para rutas inexistentes. */
export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    {
      ok: false as const,
      error: {
        code: 'NOT_FOUND',
        message: 'La dirección solicitada no existe.',
      },
    },
    404,
  );

/**
 * Hook para `@hono/zod-validator`: convierte los errores de validación al contrato
 * uniforme de la API, con mensajes en español y detalle por campo.
 *
 * Uso: `app.post('/ruta', zValidator('json', schema, validationHook), handler)`
 *
 * El `env` se deja como `any` a propósito: el hook sirve para cualquier app Hono,
 * sin acoplarse a un binding en particular (Hono exige que el `Env` del hook
 * coincida exactamente con el de la app).
 */
export const validationHook: Hook<unknown, any, string> = (result, c) => {
  if (result.success) return;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(cuerpo)',
    message: issue.message,
  }));

  return c.json(
    {
      ok: false as const,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos ingresados.',
        details,
      },
    },
    422,
  );
};
