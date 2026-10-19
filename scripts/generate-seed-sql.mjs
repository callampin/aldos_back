/**
 * Genera `drizzle/seed/0001_seed.sql` a partir de `src/db/seed.ts`.
 *
 * Por qué un script de Node aparte (ver NOTAS.md H-09):
 * - Necesita escribir un archivo y acceder a `node:fs`, cosas que el Worker no puede hacer.
 * - Node 22 ejecuta TypeScript nativo (type stripping) y su WebCrypto permite calcular
 *   el hash PBKDF2 de la contraseña de Estrella con la MISMA función que usará el Worker.
 *
 * Uso: `node scripts/generate-seed-sql.mjs`  (o `pnpm db:seed:generate`)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ADMIN, buildSeedSql } from '../src/db/seed.ts';
import { hashPassword } from '../src/utils/crypto.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../drizzle/seed/0001_seed.sql');

const adminPasswordHash = await hashPassword(DEFAULT_ADMIN.password);
const sql = buildSeedSql({ adminPasswordHash });

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, sql, 'utf8');

const statements = sql.split(';').filter((chunk) => chunk.trim().length > 0).length;
console.log(`✔ Semilla generada: ${outputPath}`);
console.log(`  - Admin: ${DEFAULT_ADMIN.email} (contraseña de desarrollo: ${DEFAULT_ADMIN.password})`);
console.log(`  - Sentencias SQL: ${statements}`);
