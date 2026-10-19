/**
 * Tipos del entorno de pruebas.
 *
 * `@cloudflare/vitest-plugin` publica las declaraciones de `cloudflare:test` en el subpath
 * `@cloudflare/vitest-plugin/types` (ya no basta con poner el paquete en `compilerOptions.types`,
 * ver `NOTAS.md` H-02).
 *
 * Además se extiende `Cloudflare.Env` (lo que devuelve `env` de `cloudflare:workers`) con los
 * bindings reales del Worker, que es la forma recomendada por Cloudflare.
 */
import '@cloudflare/vitest-plugin/types';
import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Base de datos D1 (la misma que usa el Worker). */
      DB: D1Database;
      /** Bucket R2 de las fotos. */
      BUCKET: R2Bucket;
      /** Migraciones de Drizzle, inyectadas por `vitest.config.ts`. */
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
