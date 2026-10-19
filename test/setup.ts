import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

/**
 * Prepara la base D1 del entorno de pruebas: aplica las migraciones de Drizzle
 * (las mismas que usa producción) antes de correr cualquier test.
 */
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
