import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { orderItems, orders, products } from '../../src/db/schema';
import { changeOrderStatus, createOrder, markOrderPaid } from '../../src/services/order.service';
import {
  checkoutInput,
  ensureRegion,
  getDb,
  insertProduct,
  orderContext,
  paymentContext,
  resetDatabase,
} from './helpers';

/**
 * Ciclo completo de un pedido: checkout → pago (webhook) → despacho → cancelación
 * con devolución de stock (RF-05, RF-08, RF-14).
 */
async function orderIdByNumber(orderNumber: string): Promise<number> {
  const [row] = await getDb()
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber));

  if (!row) throw new Error(`No se encontró el pedido ${orderNumber}.`);
  return row.id;
}

async function stockOf(productId: number): Promise<number | undefined> {
  const [row] = await getDb()
    .select({ stock: products.stock })
    .from(products)
    .where(eq(products.id, productId));
  return row?.stock;
}

describe('Ciclo completo del pedido', () => {
  beforeEach(resetDatabase);
  it('checkout → pago → despacho → cancelación con reversión de stock', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 3, priceClp: 89_990 });

    // 1. Checkout (descuenta el stock y reserva)
    const created = await createOrder(
      db,
      checkoutInput({ items: [{ productId: product.id, quantity: 1 }] }),
      orderContext,
    );

    expect(created.paymentStatus).toBe('PENDING');
    expect(created.orderStatus).toBe('PENDING');
    expect(await stockOf(product.id)).toBe(2);

    const orderId = await orderIdByNumber(created.orderNumber);
    const items = await db
      .select({ sku: orderItems.skuSnapshot, quantity: orderItems.quantity, total: orderItems.lineTotalClp })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sku: product.sku, quantity: 1, total: 89_990 });

    // 2. Pago confirmado por el webhook de Khipu
    const paid = await markOrderPaid(
      db,
      {
        orderNumber: created.orderNumber,
        paymentId: 'zfxnocsow6mz',
        amountClp: created.totalClp,
        paidAt: new Date(),
      },
      paymentContext,
    );

    expect(paid.status).toBe('paid');

    const [afterPayment] = await db
      .select({
        paymentStatus: orders.paymentStatus,
        orderStatus: orders.orderStatus,
        paidAt: orders.paidAt,
        paymentExternalId: orders.paymentExternalId,
      })
      .from(orders)
      .where(eq(orders.id, orderId));

    expect(afterPayment?.paymentStatus).toBe('PAID');
    expect(afterPayment?.orderStatus).toBe('PAID');
    expect(afterPayment?.paidAt).toBeInstanceOf(Date);
    expect(afterPayment?.paymentExternalId).toBe('zfxnocsow6mz');

    // 3. Khipu reintenta la notificación: no se reprocesa
    const repeated = await markOrderPaid(
      db,
      { orderNumber: created.orderNumber, paymentId: 'zfxnocsow6mz', amountClp: created.totalClp, paidAt: new Date() },
      paymentContext,
    );
    expect(repeated.status).toBe('already_paid');

    // 4. Despacho con courier y número de seguimiento
    const shipped = await changeOrderStatus(
      db,
      orderId,
      { status: 'SHIPPED', courierName: 'Chilexpress', courierTrackingNumber: 'CHX-123456' },
      paymentContext,
    );

    expect(shipped.order.status).toBe('SHIPPED');
    expect(shipped.order.courierName).toBe('Chilexpress');
    expect(shipped.order.courierTrackingNumber).toBe('CHX-123456');
    expect(shipped.order.shippedAt).not.toBeNull();

    // 5. Cancelación: el stock vuelve al inventario (una sola vez)
    const cancelled = await changeOrderStatus(db, orderId, { status: 'CANCELLED' }, paymentContext);

    expect(cancelled.stockRestored).toBe(1);
    expect(cancelled.order.stockDeducted).toBe(false);
    expect(await stockOf(product.id)).toBe(3);

    const cancelledAgain = await changeOrderStatus(db, orderId, { status: 'CANCELLED' }, paymentContext);
    expect(cancelledAgain.stockRestored).toBe(0);
    expect(await stockOf(product.id)).toBe(3);
  });

  it('no marca como pagado si el monto no coincide', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 2, priceClp: 50_000 });

    const created = await createOrder(
      db,
      checkoutInput({ items: [{ productId: product.id, quantity: 1 }] }),
      orderContext,
    );

    const result = await markOrderPaid(
      db,
      { orderNumber: created.orderNumber, paymentId: 'pago-malo', amountClp: 1, paidAt: new Date() },
      paymentContext,
    );

    expect(result.status).toBe('amount_mismatch');

    const [row] = await db
      .select({ paymentStatus: orders.paymentStatus, orderStatus: orders.orderStatus })
      .from(orders)
      .where(eq(orders.orderNumber, created.orderNumber));

    expect(row?.paymentStatus).toBe('PENDING');
    expect(row?.orderStatus).toBe('PENDING');
  });

  it('devuelve 404 lógico cuando el pedido no existe', async () => {
    const db = getDb();

    const result = await markOrderPaid(
      db,
      { orderNumber: 'ALD-2099-9999', paymentId: null, amountClp: null, paidAt: new Date() },
      paymentContext,
    );

    expect(result.status).toBe('not_found');
  });

  it('Estrella puede confirmar una transferencia desde el panel', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 1, priceClp: 30_000 });

    const created = await createOrder(
      db,
      checkoutInput({
        paymentMethod: 'BANK_TRANSFER',
        items: [{ productId: product.id, quantity: 1 }],
      }),
      orderContext,
    );

    const orderId = await orderIdByNumber(created.orderNumber);
    const confirmed = await changeOrderStatus(db, orderId, { status: 'PAID' }, paymentContext);

    expect(confirmed.paymentConfirmed).toBe(true);
    expect(confirmed.order.paymentStatus).toBe('PAID');
    expect(confirmed.order.paidAt).not.toBeNull();
    // El enlace de WhatsApp para avisarle al cliente se arma solo.
    expect(confirmed.whatsappUrl).toContain('https://wa.me/56900000000');
  });
});
