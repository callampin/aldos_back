import type { Context, MiddlewareHandler } from 'hono';

/**
 * Protección básica contra fuerza bruta y abuso (login, recuperación de contraseña,
 * checkout y avisos de stock).
 *
 * **Cómo funciona:** cuenta las solicitudes por IP dentro de una ventana de tiempo
 * fija, en memoria del isolate. Al superar el límite responde `429 RATE_LIMITED`
 * con el contrato uniforme de la API y el header `Retry-After`.
 *
 * **Decisión de diseño (ver `PLAN.md`, "Paso 6-A" y `NOTAS.md` H-12):** se usa memoria
 * del isolate y no Cloudflare KV ni Durable Objects. Razones: costo $0 (KV ya cobra
 * escrituras y Durable Objects agrega complejidad y latencia) y porque el objetivo es
 * frenar el abuso casual, no un ataque distribuido. Limitación conocida: cada isolate
 * tiene su propio contador y los datos se pierden al reciclarse, así que el límite real
 * por IP puede ser algo mayor que el configurado. Si algún día hace falta un límite
 * global exacto, hay que migrar a Durable Objects.
 */

export interface RateLimitOptions {
  /** Nombre del grupo de rutas: separa los contadores (ej. `login`). */
  name: string;
  /** Máximo de solicitudes permitidas dentro de la ventana. */
  limit: number;
  /** Largo de la ventana en segundos. */
  windowSeconds: number;
}

interface Bucket {
  count: number;
  /** Timestamp en milisegundos en que se reinicia la ventana. */
  resetAt: number;
}

/** Tope de combinaciones IP+ruta en memoria, para no crecer sin control. */
const MAX_TRACKED_KEYS = 5_000;

const buckets = new Map<string, Bucket>();

function clientIp(c: Context): string {
  // Cloudflare siempre inyecta CF-Connecting-IP.
  const connectingIp = c.req.header('CF-Connecting-IP');
  if (connectingIp) return connectingIp;

  const forwarded = c.req.header('X-Forwarded-For');
  const first = forwarded?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'desconocida';
}

/** Libera espacio: primero las ventanas vencidas y, si aún no alcanza, la más antigua. */
function makeRoom(now: number): void {
  if (buckets.size < MAX_TRACKED_KEYS) return;

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
    if (buckets.size < MAX_TRACKED_KEYS) return;
  }

  // El Map respeta el orden de inserción, así que la primera clave es la más antigua.
  const oldest = buckets.keys().next().value;
  if (oldest !== undefined) buckets.delete(oldest);
}

/**
 * Crea el middleware de límite de solicitudes.
 *
 * Uso: `app.post('/login', rateLimit({ name: 'login', limit: 10, windowSeconds: 300 }), handler)`
 */
export function rateLimit({
  name,
  limit,
  windowSeconds,
}: RateLimitOptions): MiddlewareHandler<any> {
  return async (c, next) => {
    const now = Date.now();
    const key = `${name}:${clientIp(c)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      makeRoom(now);
      buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return next();
    }

    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfterSeconds));

      return c.json(
        {
          ok: false as const,
          error: {
            code: 'RATE_LIMITED',
            message: `Demasiados intentos seguidos. Espera ${Math.ceil(
              retryAfterSeconds / 60,
            )} minuto(s) y vuelve a intentarlo. Si es urgente, escríbenos por WhatsApp.`,
          },
        },
        429,
      );
    }

    bucket.count += 1;
    return next();
  };
}

/** Vacía los contadores en memoria. Pensado para pruebas y para reinicios operativos. */
export function clearRateLimitStore(): void {
  buckets.clear();
}
