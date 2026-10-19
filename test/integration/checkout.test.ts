import { eq, inArray } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { orderItems, orders, products } from '../../src/db/schema';
import { AppError } from '../../src/middlewares/error.middleware';
import { reserveStockForItems } from '../../src/services/inventory.service';
import { createOrder } from '../../src/services/order.service';
import {
  checkoutInput,
  ensureRegion,
  getDb,
  insertProduct,
  orderContext,
  resetDatabase,
} from './helpers';

/**
 * Concurrencia y descuento atómico de stock (restricción C-05).
 * El objetivo es demostrar que **cero sobreventa** es posible y que el carrito no
 * queda a medias si un repuesto se agota en el camino.
 */
describe('Checkout: stock atómico y sin sobreventa', () => {
  beforeEach(resetDatabase);

  it('de dos compras simultáneas por el último repuesto, gana una sola', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 1 });
    const input = checkoutInput({ items: [{ productId: product.id, quantity: 1 }] });

    const results = await Promise.allSettled([
      createOrder(db, input, orderContext),
      createOrder(db, input, orderContext),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const error = (rejected[0] as PromiseRejectedResult).reason as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('INSUFFICIENT_STOCK');
    expect(error.details).toMatchObject([{ productId: product.id }]);

    // El repuesto queda en 0 y existe **un solo** pedido con **una sola** línea.
    const [after] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, product.id));

    expect(after?.stock).toBe(0);
    expect(await db.select({ id: orders.id }).from(orders)).toHaveLength(1);
    expect(await db.select({ id: orderItems.id }).from(orderItems)).toHaveLength(1);
  });

  it('devuelve al inventario lo ya descontado cuando un ítem posterior no alcanza', async () => {
    const db = getDb();
    const abundant = await insertProduct({ stock: 5 });
    const scarce = await insertProduct({ stock: 0 });

    const result = await reserveStockForItems(db, [
      { productId: abundant.id, quantity: 1 },
      { productId: scarce.id, quantity: 1 },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.productId).toBe(scarce.id);
      expect(result.quantity).toBe(1);
      expect(result.available).toBe(0);
    }

    // La compensación dejó el stock del primer repuesto como estaba.
    const [after] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, abundant.id));

    expect(after?.stock).toBe(5);
  });

  it('reserva todo el carrito cuando hay stock suficiente', async () => {
    const db = getDb();
    const first = await insertProduct({ stock: 3 });
    const second = await insertProduct({ stock: 2 });

    const result = await reserveStockForItems(db, [
      { productId: first.id, quantity: 2 },
      { productId: second.id, quantity: 1 },
    ]);

    expect(result.ok).toBe(true);

    const stocks = await db
      .select({ id: products.id, stock: products.stock })
      .from(products)
      .where(inArray(products.id, [first.id, second.id]))
      .orderBy(products.id);

    expect(stocks).toHaveLength(2);
    expect(stocks.map((row) => row.stock)).toEqual([1, 1]);
  });
});

describe('Checkout: reglas de negocio', () => {
  beforeEach(resetDatabase);

  it('bloquea los repuestos que se cotizan por WhatsApp', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 5, saleMode: 'WHATSAPP_ONLY' });

    const promise = createOrder(
      db,
      checkoutInput({ items: [{ productId: product.id, quantity: 1 }] }),
      orderContext,
    );

    await expect(promise).rejects.toMatchObject({ code: 'PRODUCT_WHATSAPP_ONLY' });

    const [after] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, product.id));

    expect(after?.stock).toBe(5);
    expect(await db.select({ id: orders.id }).from(orders)).toHaveLength(0);
  });

  it('rechaza un repuesto oculto y no toca el stock', async () => {
    await ensureRegion();
    const db = getDb();
    const product = await insertProduct({ stock: 5, isActive: false });

    await expect(
      createOrder(
        db,
        checkoutInput({ items: [{ productId: product.id, quantity: 1 }] }),
        orderContext,
      ),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_AVAILABLE' });

    const [after] = await db
      .select({ stock: products.stock })
      .from(products)
      .where(eq(products.id, product.id));

    expect(after?.stock).toBe(5);
  });

  it('calcula los totales en el servidor (precio de la base y envío de la región)', async () => {
    await ensureRegion('RM', 3_490);
    const db = getDb();
    const product = await insertProduct({ stock: 4, priceClp: 45_990 });

    const order = await createOrder(
      db,
      checkoutInput({
        deliveryMethod: 'SHIPPING',
        addressLine: 'Calle 1 #234',
        items: [{ productId: product.id, quantity: 2 }],
      }),
      orderContext,
    );

    expect(order.subtotalClp).toBe(91_980);
    expect(order.shippingCostClp).toBe(3_490);
    expect(order.totalClp).toBe(95_470);
    expect(order.orderNumber).toMatch(/^ALD-\d{4}-\d{4}$/);
    expect(order.trackingCode).toMatch(/^ALD-[A-Z2-9]{8}$/);
  });

  it('exige una región de envío conocida', async () => {
    const db = getDb();
    const product = await insertProduct({ stock: 1 });

    await expect(
      createOrder(
        db,
        checkoutInput({ regionCode: 'ZZ', items: [{ productId: product.id, quantity: 1 }] }),
        orderContext,
      ),
    ).rejects.toMatchObject({ code: 'REGION_NOT_FOUND' });
  });
});
