import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import { validationHook } from '../../middlewares/error.middleware';
import { rateLimit } from '../../middlewares/rate-limit.middleware';
import { getOrderTracking } from '../../services/order.service';
import type { Env } from '../../types/bindings';
import { trackingCodeParamSchema } from '../../validators/order.schema';

/**
 * Seguimiento público de pedidos (RF-14): el cliente consulta el estado con el código
 * que le entregamos al comprar, sin crear cuenta.
 */
export const publicTrackingRoutes = new Hono<{ Bindings: Env }>();

/** `GET /api/v1/public/orders/track/:trackingCode` */
publicTrackingRoutes.get(
  '/orders/track/:trackingCode',
  rateLimit({ name: 'tracking', limit: 40, windowSeconds: 900 }),
  zValidator('param', trackingCodeParamSchema, validationHook),
  async (c) => {
    const { trackingCode } = c.req.valid('param');
    const db = createDb(c.env.DB);

    const order = await getOrderTracking(db, trackingCode);

    if (!order) {
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'ORDER_NOT_FOUND',
            message: 'No encontramos ningún pedido con ese código. Revísalo y vuelve a intentarlo.',
          },
        },
        404,
      );
    }

    return c.json({ ok: true as const, data: order });
  },
);
