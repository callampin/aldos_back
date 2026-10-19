import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import {
  batchUpsertProducts,
  createProduct,
  exportCatalogRows,
  getAdminProductById,
  listAdminProducts,
  quickUpdateProduct,
  updateProduct,
  type BatchImportItem,
  type BatchReportEntry,
} from '../../services/inventory.service';
import { validationHook } from '../../middlewares/error.middleware';
import { AppError } from '../../middlewares/error.middleware';
import {
  adminProductQuerySchema,
  batchImportSchema,
  batchRowSchema,
  idParamSchema,
  productCreateSchema,
  productQuickUpdateSchema,
  productUpdateSchema,
} from '../../validators/product.schema';
import type { AppEnv } from '../../middlewares/auth.middleware';

/**
 * Inventario del panel de Estrella (RF-07, HU-04).
 * Todas las rutas están protegidas por `requireAdmin` (ver `src/index.ts`).
 *
 * El listado devuelve un **arreglo** en `data` porque así lo consume el frontend
 * (ver `NOTAS.md` H-13).
 */
export const adminProductRoutes = new Hono<AppEnv>();

/** `GET /api/v1/admin/products` — listado con filtros rápidos. */
adminProductRoutes.get('/', zValidator('query', adminProductQuerySchema, validationHook), async (c) => {
  const query = c.req.valid('query');
  const db = createDb(c.env.DB);

  const items = await listAdminProducts(db, query, { mediaBaseUrl: new URL(c.req.url).origin });

  return c.json({ ok: true as const, data: items, meta: { total: items.length } });
});

/** `GET /api/v1/admin/products/export` — catálogo completo listo para editar en Excel. */
adminProductRoutes.get('/export', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await exportCatalogRows(db);

  return c.json({ ok: true as const, data: rows, meta: { total: rows.length } });
});

/**
 * `POST /api/v1/admin/products/batch-import` — la planilla de Estrella (RF-07 / R-02).
 *
 * Cada fila se valida por separado: las correctas se importan y las malas se informan
 * en `errors`, con el número de fila, para que pueda corregirlas y volver a subir.
 */
adminProductRoutes.post(
  '/batch-import',
  zValidator('json', batchImportSchema, validationHook),
  async (c) => {
    const { rows } = c.req.valid('json');
    const db = createDb(c.env.DB);

    const items: BatchImportItem[] = [];
    const errors: BatchReportEntry[] = [];

    rows.forEach((raw, index) => {
      const result = batchRowSchema.safeParse(raw);
      if (result.success) {
        items.push({ position: index + 1, row: result.data });
        return;
      }

      const source = (raw ?? {}) as Record<string, unknown>;
      const rawSku = source['sku'] ?? source['SKU'];

      errors.push({
        row: index + 1,
        sku: typeof rawSku === 'string' && rawSku.trim().length > 0 ? rawSku.trim() : undefined,
        message: result.error.issues[0]?.message ?? 'La fila no es válida.',
      });
    });

    const report = await batchUpsertProducts(db, items);

    return c.json({
      ok: true as const,
      data: {
        total: rows.length,
        created: report.created,
        updated: report.updated,
        skipped: errors.length,
        errors: [...errors, ...report.errors].sort((a, b) => a.row - b.row),
        warnings: report.warnings.sort((a, b) => a.row - b.row),
      },
    });
  },
);

/** `GET /api/v1/admin/products/:id` — ficha de un producto para editarlo. */
adminProductRoutes.get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
  const { id } = c.req.valid('param');
  const db = createDb(c.env.DB);

  const product = await getAdminProductById(db, id, { mediaBaseUrl: new URL(c.req.url).origin });

  if (!product) {
    throw new AppError('PRODUCT_NOT_FOUND', 'No encontramos ese repuesto.', 404);
  }

  return c.json({ ok: true as const, data: product });
});

/** `POST /api/v1/admin/products` — crear repuesto con sus motos compatibles. */
adminProductRoutes.post('/', zValidator('json', productCreateSchema, validationHook), async (c) => {
  const body = c.req.valid('json');
  const db = createDb(c.env.DB);

  const { id, warnings } = await createProduct(db, body);
  const product = await getAdminProductById(db, id, { mediaBaseUrl: new URL(c.req.url).origin });

  return c.json({ ok: true as const, data: { product, warnings } }, 201);
});

/** `PUT /api/v1/admin/products/:id` — edición completa (solo se cambia lo que llega). */
adminProductRoutes.put(
  '/:id',
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', productUpdateSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    const { warnings } = await updateProduct(db, id, body);
    const product = await getAdminProductById(db, id, { mediaBaseUrl: new URL(c.req.url).origin });

    return c.json({ ok: true as const, data: { product, warnings } });
  },
);

/**
 * `PATCH /api/v1/admin/products/:id/quick-update` — guardado instantáneo de una celda
 * de la tabla de inventario (precio, stock, umbral, modo de venta o visibilidad).
 */
adminProductRoutes.patch(
  '/:id/quick-update',
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', productQuickUpdateSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    await quickUpdateProduct(db, id, body);
    const product = await getAdminProductById(db, id, { mediaBaseUrl: new URL(c.req.url).origin });

    return c.json({ ok: true as const, data: product });
  },
);
