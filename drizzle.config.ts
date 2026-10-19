import { defineConfig } from 'drizzle-kit';

/**
 * Configuración de Drizzle Kit.
 * `generate` produce el SQL de migración en `drizzle/migrations/`, carpeta que
 * Wrangler aplica con `wrangler d1 migrations apply` (ver `migrations_dir` en wrangler.toml).
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
});
