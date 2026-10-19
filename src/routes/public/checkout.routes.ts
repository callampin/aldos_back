import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import { validationHook } from '../../middlewares/error.middleware';
import { rateLimit } from '../../middlewares/rate-limit.middleware';
import { createOrder } from '../../services/order.service';
import type { Env } from '../../types/bindings';
import { runInBackground, type BackgroundContextLike } from '../../utils/background';
import { checkoutSchema } from '../../validators/order.schema';

/**
 * Checkout público (RF-04, RF-05).
 *
 * El descuento de stock es atómico: la condición `stock >= cantidad` va dentro del
 * propio `UPDATE` de D1, así que es imposible vender más de lo que hay.
 */
export const publicCheckoutRoutes = new Hono<{ Bindings: Env }>();

/** `POST /api/v1/public/checkout` — crea el pedido, reserva el stock y cobra. */
publicCheckoutRoutes.post(
  '/checkout',
  rateLimit({ name: 'checkout', limit: 20, windowSeconds: 900 }),
  zValidator('json', checkoutSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);
    const origin = new URL(c.req.url).origin;

    const order = await createOrder(db, body, {
      env: c.env,
      publicApiUrl: origin,
      frontendUrl: c.env.FRONTEND_URL,
      // Los correos salen después de responder (no hacen esperar al comprador).
      deliver: (promise) => runInBackground(c as unknown as BackgroundContextLike, promise),
    });

    return c.json({ ok: true as const, data: order }, 201);
  },
);
