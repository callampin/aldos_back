import { drizzle } from 'drizzle-orm/d1';

import type { Env } from '../types/bindings';
import * as schema from './schema';

/**
 * Crea el cliente Drizzle sobre el binding D1 (`env.DB`).
 *
 * Uso en una ruta:
 * ```ts
 * const db = createDb(c.env.DB);
 * const rows = await db.select().from(products);
 * ```
 */
export function createDb(d1: Env['DB']) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;

export * as schema from './schema';
