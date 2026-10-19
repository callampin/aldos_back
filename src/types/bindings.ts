/**
 * Tipado del entorno del Worker (bindings de `wrangler.toml` + secretos).
 * Se usa como `Hono<{ Bindings: Env }>` en las rutas y services.
 */
export interface Env {
  // --- Bindings de infraestructura ---
  /** Base de datos Cloudflare D1 (SQLite serverless). */
  DB: D1Database;
  /** Bucket Cloudflare R2 para las fotos de los repuestos. */
  BUCKET: R2Bucket;

  // --- Secretos (NO se declaran en wrangler.toml) ---
  /** Firma de los JWT del panel de Estrella. */
  JWT_SECRET: string;
  /** API key de Khipu API v3. */
  KHIPU_API_KEY: string;
  /** Secreto compartido para validar la firma de los webhooks de Khipu. */
  KHIPU_WEBHOOK_SECRET: string;
  /** API key de Resend para el envío de correos transaccionales. */
  RESEND_API_KEY: string;

  // --- Variables de configuración ---
  /** Número de WhatsApp de la tienda en formato internacional (+569XXXXXXXX). */
  STORE_WHATSAPP: string;
  /** URL pública del frontend (CORS y enlaces en correos). */
  FRONTEND_URL: string;
}
