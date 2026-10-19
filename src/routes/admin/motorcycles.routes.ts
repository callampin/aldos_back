import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import type { AppEnv } from '../../middlewares/auth.middleware';
import { AppError, validationHook } from '../../middlewares/error.middleware';
import {
  countProductsForMotorcycle,
  createMotorcycle,
  deleteMotorcycle,
  listAdminMotorcycles,
  updateMotorcycle,
} from '../../services/inventory.service';
import {
  idParamSchema,
  motorcycleCreateSchema,
  motorcycleUpdateSchema,
} from '../../validators/product.schema';

/**
 * Mantenedor de motos compatibles del panel (HU-01).
 * Es la lista que alimenta el selector "¿Qué moto tienes?" del catálogo.
 */
export const adminMotorcycleRoutes = new Hono<AppEnv>();

/** `GET /api/v1/admin/motorcycles` — todas las motos registradas. */
adminMotorcycleRoutes.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const items = await listAdminMotorcycles(db);

  return c.json({ ok: true as const, data: items, meta: { total: items.length } });
});

/** `POST /api/v1/admin/motorcycles` — agregar una moto. */
adminMotorcycleRoutes.post(
  '/',
  zValidator('json', motorcycleCreateSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    const { id } = await createMotorcycle(db, body);

    return c.json({ ok: true as const, data: { id } }, 201);
  },
);

/** `PUT /api/v1/admin/motorcycles/:id` — corregir marca, modelo, línea o años. */
adminMotorcycleRoutes.put(
  '/:id',
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', motorcycleUpdateSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    await updateMotorcycle(db, id, body);

    return c.json({ ok: true as const, data: { id } });
  },
);

/** `DELETE /api/v1/admin/motorcycles/:id` — quitar del mantenedor (también de los productos). */
adminMotorcycleRoutes.delete(
  '/:id',
  zValidator('param', idParamSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = createDb(c.env.DB);

    const associated = await countProductsForMotorcycle(db, id);

    await deleteMotorcycle(db, id);

    return c.json({
      ok: true as const,
      data: {
        id,
        message:
          associated > 0
            ? `Moto eliminada. También se quitó de ${associated} repuesto(s) compatible(s).`
            : 'Moto eliminada del mantenedor.',
      },
    });
  },
);
