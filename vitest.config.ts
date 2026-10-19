import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

/**
 * Configuración de Vitest sobre el runtime de Cloudflare Workers.
 *
 * Las migraciones de Drizzle se leen acá y se pasan al Worker de pruebas como el binding
 * `TEST_MIGRATIONS`; el archivo `test/setup.ts` las aplica a la base D1 del entorno antes
 * de correr los tests (patrón oficial de la integración de Cloudflare).
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations({ migrationsDir: './drizzle/migrations' });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
    },
  };
});
