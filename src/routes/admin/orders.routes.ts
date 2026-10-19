import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import type { AppEnv } from '../../middlewares/auth.middleware';
import { AppError, validationHook } from '../../middlewares/error.middleware';
import { changeOrderStatus, getAdminOrder, listAdminOrders } from '../../services/order.service';
import { buildStoreToCustomerWhatsAppUrl } from '../../services/notification.service';
import { runInBackground, type BackgroundContextLike } from '../../utils/background';
import {
  adminOrderQuerySchema,
  orderStatusUpdateSchema,
} from '../../validators/order.schema';
import { idParamSchema } from '../../validators/product.schema';

/**
 * Pedidos y despachos del panel de Estrella (RF-08, HU-03).
 * Todas las rutas están protegidas por `requireAdmin` (ver `src/index.ts`).
 *
 * El listado se devuelve como **arreglo** en `data` porque así lo consume el frontend.
 */
export const adminOrderRoutes = new Hono<AppEnv>();

/** `GET /api/v1/admin/orders` — pedidos ordenados por urgencia (lo de hoy primero). */
adminOrderRoutes.get('/', zValidator('query', adminOrderQuerySchema, validationHook), async (c) => {
  const filters = c.req.valid('query');
  const db = createDb(c.env.DB);

  const orders = await listAdminOrders(db, filters);

  return c.json({ ok: true as const, data: orders, meta: { total: orders.length } });
});

/** `GET /api/v1/admin/orders/:id` — ficha completa + enlace de WhatsApp del cliente. */
adminOrderRoutes.get('/:id', zValidator('param', idParamSchema, validationHook), async (c) => {
  const { id } = c.req.valid('param');
  const db = createDb(c.env.DB);

  const order = await getAdminOrder(db, id);

  if (!order) {
    throw new AppError('ORDER_NOT_FOUND', 'No encontramos ese pedido.', 404);
  }

  const whatsappUrl = buildStoreToCustomerWhatsAppUrl(c.env.STORE_WHATSAPP, {
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    trackingCode: order.trackingCode,
    items: order.items,
  });

  // Lo que Estrella necesita para pegar en la caja: remitente y destinatario.
  const dispatchLabel = {
    from: {
      storeName: 'Aldos Motos',
      whatsapp: c.env.STORE_WHATSAPP,
      email: c.env.FRONTEND_URL,
    },
    to: {
      name: order.customerName,
      rut: order.customerRut,
      phone: order.customerPhone,
      addressLine: order.addressLine,
      addressReference: order.addressReference,
      comuna: order.comuna,
      regionName: order.regionName,
      deliveryMethod: order.deliveryMethod,
    },
    order: {
      orderNumber: order.orderNumber,
      trackingCode: order.trackingCode,
      purchasedAt: order.createdAt,
      items: order.items,
    },
  };

  return c.json({ ok: true as const, data: { order, whatsappUrl, dispatchLabel } });
});

/**
 * `PATCH /api/v1/admin/orders/:id/status` — cambia el estado del pedido.
 *
 * - `PAID`: confirma el pago (típico de transferencias) y dispara los avisos.
 * - `SHIPPED`: guarda courier y número de seguimiento, y avisa al comprador.
 * - `CANCELLED`: **devuelve el stock** al inventario.
 */
adminOrderRoutes.patch(
  '/:id/status',
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', orderStatusUpdateSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    const result = await changeOrderStatus(db, id, body, {
      env: c.env,
      frontendUrl: c.env.FRONTEND_URL,
      deliver: (promise) => runInBackground(c as unknown as BackgroundContextLike, promise),
    });

    return c.json({
      ok: true as const,
      data: {
        order: result.order,
        whatsappUrl: result.whatsappUrl,
        stockRestored: result.stockRestored,
        paymentConfirmed: result.paymentConfirmed,
        message: buildStatusMessage(result.order.status, result.stockRestored, result.paymentConfirmed),
      },
    });
  },
);

/** Mensaje en español para mostrar en el panel después de cambiar el estado. */
function buildStatusMessage(
  status: string,
  stockRestored: number,
  paymentConfirmed: boolean,
): string {
  switch (status) {
    case 'PAID':
      return paymentConfirmed
        ? 'Pago confirmado. Le avisamos al cliente y te llegó el detalle para despachar.'
        : 'El pedido queda como pagado.';
    case 'SHIPPED':
      return 'Pedido marcado como despachado. Le avisamos al cliente por correo.';
    case 'DELIVERED':
      return 'Pedido marcado como entregado.';
    case 'CANCELLED':
      return stockRestored > 0
        ? `Pedido cancelado. Devolvimos ${stockRestored} unidad(es) al inventario.`
        : 'Pedido cancelado.';
    default:
      return 'Estado del pedido actualizado.';
  }
}
