import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm';

import type { Database } from '../db';
import { orderItems, orders, shippingRates } from '../db/schema';
import { AppError } from '../middlewares/error.middleware';
import type { Env } from '../types/bindings';
import { generateRandomToken } from '../utils/crypto';
import type { CheckoutInput } from '../validators/order.schema';
import {
  decrementProductStock,
  loadOrderableProducts,
  reserveStockForItems,
  restoreProductStock,
  type OrderableProduct,
} from './inventory.service';
import {
  buildStoreToCustomerWhatsAppUrl,
  notifyStoreAboutPaidOrder,
  notifyStoreAboutPendingOrder,
  resolveStoreRecipients,
  sendCustomerReceiptEmail,
  sendCustomerShippedEmail,
  sendCustomerTransferInstructionsEmail,
  type OrderEmailData,
  type OrderEmailItem,
} from './notification.service';
import { KhipuApiError, KhipuNotConfiguredError, createKhipuPayment, isKhipuConfigured } from './payment-khipu.service';
import { readStoreSettings } from './settings.service';

/**
 * Pedidos del cliente (RF-04, RF-05, RF-14).
 *
 * El stock se descuenta con la condición `stock >= cantidad` dentro del propio `UPDATE`
 * (ver `decrementProductStock`), así que no se puede vender lo que no hay. Si algo falla
 * a medias, lo ya descontado se devuelve al inventario antes de responder el error.
 */

/** Alfabeto del código de seguimiento: sin letras ni números que se confundan al dictarlos. */
const TRACKING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Código público corto y no predecible, con el prefijo de la tienda. */
export function generateTrackingCode(): string {
  const random = generateRandomToken(8);
  let code = '';

  for (let index = 0; index < 8; index += 1) {
    const charCode = random.charCodeAt(index) || 0;
    code += TRACKING_ALPHABET[charCode % TRACKING_ALPHABET.length];
  }

  return `ALD-${code}`;
}

/** Número de pedido legible para Estrella y el cliente. Ej: `ALD-2026-0001`. */
export function formatOrderNumber(sequence: number, year: number): string {
  return `ALD-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Configuración global de la tienda (`store_settings`) como objeto plano. */
// Se movió a `settings.service.ts`; se deja re-exportada por compatibilidad.
export { readStoreSettings } from './settings.service';

function isSettingEnabled(settings: Record<string, string>, key: string): boolean {
  const value = settings[key];
  return value === undefined ? true : value === 'true';
}

/** Ordena las líneas del carrito y junta las cantidades del mismo repuesto. */
function mergeItems(items: CheckoutInput['items']): Array<{ productId: number; quantity: number }> {
  const merged = new Map<number, number>();

  for (const item of items) {
    merged.set(item.productId, (merged.get(item.productId) ?? 0) + item.quantity);
  }

  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export interface OrderLine {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  unitPriceClp: number;
  lineTotalClp: number;
}

export interface CreatedOrder {
  orderNumber: string;
  trackingCode: string;
  subtotalClp: number;
  shippingCostClp: number;
  totalClp: number;
  paymentMethod: 'KHIPU' | 'BANK_TRANSFER';
  paymentStatus: string;
  orderStatus: string;
  items: OrderLine[];
  /** Enlace de pago de Khipu (null si Khipu no está configurado o falló). */
  paymentUrl: string | null;
  /** Explicación para el comprador cuando el enlace de pago no se pudo generar. */
  paymentMessage: string | null;
  /** Datos de transferencia cuando el comprador eligió transferencia bancaria. */
  bankTransfer: Record<string, string | null> | null;
}

/** Contexto que necesita el checkout para cobrar y notificar. */
export interface CreateOrderContext {
  env: Env;
  /** Origen público del Worker: se usa como `notify_url` de Khipu. */
  publicApiUrl: string;
  /** Origen del frontend: se usa en `return_url` / `cancel_url` y en los correos. */
  frontendUrl: string;
  /** Envía los correos en segundo plano (no bloquean la respuesta). */
  deliver: (promise: Promise<unknown>) => void;
}

/** Datos del pedido que necesitan los correos (sirve para el checkout y para el webhook). */
interface OrderNotificationSource {
  orderNumber: string;
  trackingCode: string;
  customerName: string;
  customerRut: string | null;
  customerEmail: string;
  customerPhone: string;
  deliveryMethod: string;
  regionName: string;
  comuna: string;
  addressLine: string;
  addressReference: string | null;
  customerNotes: string | null;
  subtotalClp: number;
  shippingCostClp: number;
  totalClp: number;
  paymentMethod: string;
}

/** Arma el contenido del correo (enlaces de seguimiento y de WhatsApp incluidos). */
function buildOrderEmailData(
  env: Env,
  frontendUrl: string,
  order: OrderNotificationSource,
  items: OrderEmailItem[],
): OrderEmailData {
  const trackingUrl = `${frontendUrl.replace(/\/+$/, '')}/seguimiento?code=${encodeURIComponent(
    order.trackingCode,
  )}`;

  const customerWhatsAppUrl = buildStoreToCustomerWhatsAppUrl(env.STORE_WHATSAPP, {
    customerName: order.customerName,
    orderNumber: order.orderNumber,
    trackingCode: order.trackingCode,
    items,
  });

  return { ...order, items, trackingUrl, customerWhatsAppUrl };
}

/**
 * Crea el pedido, descuenta el stock y devuelve los datos que necesita el comprador.
 *
 * Cualquier problema de stock se responde con `409` y el detalle exacto del repuesto
 * que quedó corto, sin dejar el carrito a medias.
 */
export async function createOrder(
  db: Database,
  input: CheckoutInput,
  context: CreateOrderContext,
): Promise<CreatedOrder> {
  const settings = await readStoreSettings(db);

  if (input.paymentMethod === 'KHIPU' && !isSettingEnabled(settings, 'allow_khipu')) {
    throw new AppError(
      'PAYMENT_METHOD_DISABLED',
      'El pago en línea no está disponible en este momento. Elige transferencia bancaria.',
      400,
    );
  }

  if (input.paymentMethod === 'BANK_TRANSFER' && !isSettingEnabled(settings, 'allow_manual_transfer')) {
    throw new AppError(
      'PAYMENT_METHOD_DISABLED',
      'La transferencia bancaria no está disponible en este momento. Elige pago en línea.',
      400,
    );
  }

  const [rate] = await db
    .select({
      regionCode: shippingRates.regionCode,
      regionName: shippingRates.regionName,
      baseCostClp: shippingRates.baseCostClp,
      isActive: shippingRates.isActive,
    })
    .from(shippingRates)
    .where(eq(shippingRates.regionCode, input.regionCode))
    .limit(1);

  if (!rate || !rate.isActive) {
    throw new AppError(
      'REGION_NOT_FOUND',
      'No pudimos calcular el envío para esa región. Revisa la región elegida.',
      400,
    );
  }

  const lines = mergeItems(input.items);
  const productIds = lines.map((line) => line.productId);
  const products = await loadOrderableProducts(db, productIds);
  const productById = new Map<number, OrderableProduct>(products.map((product) => [product.id, product]));

  // --- Validación previa: nada de tocar stock si el carrito tiene problemas ---
  for (const line of lines) {
    const product = productById.get(line.productId);

    if (!product || !product.isActive) {
      throw new AppError(
        'PRODUCT_NOT_AVAILABLE',
        'Uno de los repuestos de tu carrito ya no está disponible. Revisa tu carrito.',
        409,
        [{ productId: line.productId, reason: 'NOT_AVAILABLE' }],
      );
    }

    if (product.saleMode !== 'DIRECT') {
      throw new AppError(
        'PRODUCT_WHATSAPP_ONLY',
        `${product.name} se cotiza por WhatsApp (es una pieza especial). Escríbenos y te atendemos.`,
        409,
        [{ productId: product.id, sku: product.sku, reason: 'WHATSAPP_ONLY' }],
      );
    }

    if (product.stock < line.quantity) {
      throw new AppError(
        'INSUFFICIENT_STOCK',
        `${product.name}: quedan ${product.stock} unidad(es) y pediste ${line.quantity}. Ajusta tu carrito para continuar.`,
        409,
        [
          {
            productId: product.id,
            sku: product.sku,
            name: product.name,
            requested: line.quantity,
            available: product.stock,
          },
        ],
      );
    }
  }

  const subtotalClp = lines.reduce((total, line) => {
    const product = productById.get(line.productId);
    return total + (product?.priceClp ?? 0) * line.quantity;
  }, 0);

  const shippingCostClp = input.deliveryMethod === 'PICKUP' ? 0 : rate.baseCostClp;
  const totalClp = subtotalClp + shippingCostClp;

  // --- Descuento atómico del stock, con compensación si algo queda corto ---
  const reserved = await reserveStockForItems(db, lines);

  if (!reserved.ok) {
    const product = productById.get(reserved.productId);

    throw new AppError(
      'INSUFFICIENT_STOCK',
      `${product?.name ?? 'Uno de los repuestos'} ya no tiene stock suficiente: quedan ${reserved.available} unidad(es). Revisa tu carrito y vuelve a intentarlo.`,
      409,
      [
        {
          productId: reserved.productId,
          sku: product?.sku ?? null,
          requested: reserved.quantity,
          available: reserved.available,
        },
      ],
    );
  }

  /** Lo descontado, para poder devolverlo si falla la creación del pedido. */
  const discounted: Array<{ productId: number; quantity: number }> = lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
  }));

  const itemLines: OrderLine[] = lines.map((line) => {
    const product = productById.get(line.productId);
    const unitPriceClp = product?.priceClp ?? 0;

    return {
      productId: line.productId,
      sku: product?.sku ?? '',
      name: product?.name ?? '',
      quantity: line.quantity,
      unitPriceClp,
      lineTotalClp: unitPriceClp * line.quantity,
    };
  });

  const year = new Date().getFullYear();
  const trackingCode = generateTrackingCode();

  let saved: CreatedOrder | null = null;
  let notificationSource: OrderNotificationSource | null = null;

  // Hasta 3 intentos: solo se repite si el número de pedido o el código se repitieron.
  for (let attempt = 0; attempt < 3 && saved === null; attempt += 1) {
    const orderNumber = await nextOrderNumber(db, year);
    const code = attempt === 0 ? trackingCode : generateTrackingCode();

    try {
      await db.batch([
        db.insert(orders).values({
          orderNumber,
          trackingCode: code,
          customerName: input.customerName,
          customerRut: input.customerRut,
          customerEmail: input.customerEmail,
          customerPhone: input.customerPhone,
          deliveryMethod: input.deliveryMethod,
          regionCode: rate.regionCode,
          regionName: rate.regionName,
          comuna: input.comuna,
          addressLine: input.addressLine?.trim() || 'Retiro en taller',
          addressReference: input.addressReference,
          customerNotes: input.customerNotes,
          subtotalClp,
          shippingCostClp,
          totalClp,
          paymentMethod: input.paymentMethod,
          paymentStatus: 'PENDING',
          orderStatus: 'PENDING',
          stockDeducted: true,
        }),
        ...itemLines.map((line) =>
          db.insert(orderItems).values({
            orderId: sql`(SELECT id FROM orders WHERE order_number = ${orderNumber})`,
            productId: line.productId,
            skuSnapshot: line.sku,
            nameSnapshot: line.name,
            unitPriceClp: line.unitPriceClp,
            quantity: line.quantity,
            lineTotalClp: line.lineTotalClp,
          }),
        ),
      ] as unknown as [any, ...any[]]);

      saved = {
        orderNumber,
        trackingCode: code,
        subtotalClp,
        shippingCostClp,
        totalClp,
        paymentMethod: input.paymentMethod,
        paymentStatus: 'PENDING',
        orderStatus: 'PENDING',
        items: itemLines,
        paymentUrl: null,
        paymentMessage: null,
        bankTransfer:
          input.paymentMethod === 'BANK_TRANSFER' ? parseBankTransfer(settings['bank_transfer_details']) : null,
      };

      notificationSource = {
        orderNumber,
        trackingCode: code,
        customerName: input.customerName,
        customerRut: input.customerRut,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        deliveryMethod: input.deliveryMethod,
        regionName: rate.regionName,
        comuna: input.comuna,
        addressLine: input.addressLine?.trim() || 'Retiro en taller',
        addressReference: input.addressReference,
        customerNotes: input.customerNotes,
        subtotalClp,
        shippingCostClp,
        totalClp,
        paymentMethod: input.paymentMethod,
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        // Error inesperado: se devuelve el stock descontado antes de avisar.
        for (const done of discounted.reverse()) {
          await restoreProductStock(db, done.productId, done.quantity);
        }
        throw error;
      }
    }
  }

  if (saved === null) {
    for (const done of discounted.reverse()) {
      await restoreProductStock(db, done.productId, done.quantity);
    }
    throw new AppError(
      'ORDER_CREATE_FAILED',
      'No pudimos registrar tu pedido. Intenta nuevamente en unos minutos.',
      500,
    );
  }

  const emailItems: OrderEmailItem[] = itemLines.map((line) => ({
    sku: line.sku,
    name: line.name,
    quantity: line.quantity,
    unitPriceClp: line.unitPriceClp,
    lineTotalClp: line.lineTotalClp,
  }));

  const source = notificationSource;
  if (source === null) {
    // No debería ocurrir: `saved` y `notificationSource` se asignan juntos.
    throw new AppError(
      'ORDER_CREATE_FAILED',
      'No pudimos registrar tu pedido. Intenta nuevamente en unos minutos.',
      500,
    );
  }

  const emailData = buildOrderEmailData(context.env, context.frontendUrl, source, emailItems);
  const storeRecipients = resolveStoreRecipients(settings);

  if (input.paymentMethod === 'KHIPU') {
    await attachKhipuPayment(db, {
      context,
      source,
      items: emailItems,
      emailData,
      storeRecipients,
      saved,
      description: itemLines.map((line) => `${line.quantity}x ${line.name}`).join(', '),
    });
  } else {
    // Transferencia bancaria: el comprador recibe los datos de la cuenta y Estrella
    // queda avisada de que hay un pedido esperando el comprobante.
    const bankTransfer = saved.bankTransfer ?? {};

    context.deliver(
      Promise.all([
        sendCustomerTransferInstructionsEmail(context.env, emailData, bankTransfer),
        notifyStoreAboutPendingOrder(
          context.env,
          emailData,
          storeRecipients,
          'Pendiente: confirmar la transferencia cuando llegue el comprobante del cliente.',
        ),
      ]),
    );
  }

  return saved;
}

/**
 * Crea el cobro en Khipu y devuelve el enlace de pago.
 *
 * El pedido **ya está guardado** y el stock reservado cuando se llama a esta función, así
 * que un problema con Khipu no deja al cliente sin pedido: se devuelve el pedido con
 * `paymentUrl: null` y se avisa a Estrella para que mande el enlace a mano (ver H-17).
 */
async function attachKhipuPayment(
  db: Database,
  {
    context,
    source,
    emailData,
    storeRecipients,
    saved,
    description,
  }: {
    context: CreateOrderContext;
    source: OrderNotificationSource;
    items: OrderEmailItem[];
    emailData: OrderEmailData;
    storeRecipients: string[];
    saved: CreatedOrder;
    description: string;
  },
): Promise<void> {
  if (!isKhipuConfigured(context.env)) {
    saved.paymentMessage =
      'El pago en línea no está disponible ahora. Te contactaremos para coordinar el pago.';
    console.warn('[khipu] KHIPU_API_KEY no configurada; el pedido quedó pendiente de pago.');

    // El cliente eligió pagar en línea: Estrella igual tiene que enterarse del pedido,
    // porque nadie lo va a confirmar solo.
    context.deliver(
      notifyStoreAboutPendingOrder(
        context.env,
        emailData,
        storeRecipients,
        'Atención: el cliente eligió pago en línea (Khipu), pero la pasarela no está configurada. Hay que contactarlo para coordinar el pago.',
      ),
    );

    return;
  }

  try {
    const payment = await createKhipuPayment(context.env, {
      amountClp: saved.totalClp,
      orderNumber: saved.orderNumber,
      subject: `Pedido ${saved.orderNumber} — Aldos Motos`,
      body: `Compra en Aldos Motos: ${description}`.slice(0, 5000),
      notifyUrl: `${context.publicApiUrl.replace(/\/+$/, '')}/api/v1/public/webhooks/khipu`,
      returnUrl: `${context.frontendUrl.replace(/\/+$/, '')}/checkout/confirmacion?order=${encodeURIComponent(
        saved.orderNumber,
      )}&code=${encodeURIComponent(saved.trackingCode)}&method=KHIPU&total=${saved.totalClp}&name=${encodeURIComponent(
        source.customerName,
      )}`,
      cancelUrl: `${context.frontendUrl.replace(/\/+$/, '')}/checkout?pago=cancelado`,
      payerName: source.customerName,
      payerEmail: source.customerEmail,
    });

    saved.paymentUrl = payment.paymentUrl;

    await db
      .update(orders)
      .set({ paymentExternalId: payment.paymentId, updatedAt: new Date() })
      .where(eq(orders.orderNumber, saved.orderNumber));
  } catch (error) {
    const detail =
      error instanceof KhipuNotConfiguredError
        ? 'Khipu no está configurado'
        : error instanceof KhipuApiError
          ? `Khipu respondió ${error.status}: ${error.detail.slice(0, 200)}`
          : String(error);

    console.error(`[khipu] No se pudo crear el cobro del pedido ${saved.orderNumber}: ${detail}`);

    saved.paymentMessage =
      'No pudimos generar el enlace de pago en este momento. Te contactaremos para coordinar cómo pagar.';

    context.deliver(
      notifyStoreAboutPendingOrder(
        context.env,
        emailData,
        storeRecipients,
        'Atención: el enlace de pago de Khipu NO se pudo generar. Hay que contactar al cliente para coordinar el pago.',
      ),
    );
  }
}

/** Siguiente número de pedido del año. El unique de `order_number` protege ante carreras. */
async function nextOrderNumber(db: Database, year: number): Promise<string> {
  const [row] = await db
    .select({ last: sql<string | null>`max(${orders.orderNumber})` })
    .from(orders)
    .where(like(orders.orderNumber, `ALD-${year}-%`));

  const parsed = row?.last ? Number.parseInt(row.last.slice(-4), 10) : 0;
  return formatOrderNumber(Number.isFinite(parsed) ? parsed + 1 : 1, year);
}

function isDuplicateKeyError(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) break;
    const message = current instanceof Error ? current.message : String(current);
    if (message.includes('UNIQUE')) return true;
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }

  return false;
}

/** Los datos de transferencia se guardan como JSON en `store_settings`. */
function parseBankTransfer(value: string | undefined): Record<string, string | null> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result: Record<string, string | null> = {};

    for (const [key, raw] of Object.entries(parsed)) {
      result[key] = raw === null || raw === undefined ? null : String(raw);
    }

    return result;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seguimiento público (RF-14)
// ---------------------------------------------------------------------------

export interface TrackingItem {
  sku: string;
  name: string;
  quantity: number;
}

export interface OrderTracking {
  orderNumber: string;
  status: string;
  customerName: string;
  regionName: string;
  comuna: string;
  courierName: string | null;
  courierTrackingNumber: string | null;
  totalClp: number;
  createdAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: TrackingItem[];
}

function toIso(value: Date | null): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * Consulta pública del estado de un pedido por su código (RF-14).
 *
 * A propósito **no** devuelve dirección, teléfono ni RUT del cliente: el código viaja por
 * WhatsApp y no queremos que esos datos queden expuestos en un enlace (RNF-05).
 */
export async function getOrderTracking(
  db: Database,
  trackingCode: string,
): Promise<OrderTracking | null> {
  const code = trackingCode.trim().toUpperCase();

  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.orderStatus,
      customerName: orders.customerName,
      regionName: orders.regionName,
      comuna: orders.comuna,
      courierName: orders.courierName,
      courierTrackingNumber: orders.courierTrackingNumber,
      totalClp: orders.totalClp,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      shippedAt: orders.shippedAt,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.trackingCode, code))
    .limit(1);

  if (!order) return null;

  const items = await db
    .select({ sku: orderItems.skuSnapshot, name: orderItems.nameSnapshot, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id));

  return {
    orderNumber: order.orderNumber,
    status: order.orderStatus,
    customerName: order.customerName,
    regionName: order.regionName,
    comuna: order.comuna,
    courierName: order.courierName,
    courierTrackingNumber: order.courierTrackingNumber,
    totalClp: order.totalClp,
    createdAt: toIso(order.createdAt),
    paidAt: toIso(order.paidAt),
    shippedAt: toIso(order.shippedAt),
    deliveredAt: toIso(order.deliveredAt),
    items,
  };
}

/** Últimos pedidos de un correo (útil para soporte desde el panel). */
export async function listOrdersByEmail(db: Database, email: string, limit = 10) {
  return db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      trackingCode: orders.trackingCode,
      orderStatus: orders.orderStatus,
      paymentStatus: orders.paymentStatus,
      totalClp: orders.totalClp,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.customerEmail, email))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Confirmación de pago (webhook de Khipu)
// ---------------------------------------------------------------------------

export interface MarkOrderPaidInput {
  /** Número de pedido que Khipu devuelve en `transaction_id`. */
  orderNumber: string;
  /** `payment_id` de Khipu. */
  paymentId: string | null;
  /** Monto pagado, para comparar con el total del pedido. */
  amountClp: number | null;
  paidAt: Date;
}

export interface MarkOrderPaidContext {
  env: Env;
  frontendUrl: string;
  deliver: (promise: Promise<unknown>) => void;
}

export type MarkOrderPaidStatus = 'paid' | 'already_paid' | 'not_found' | 'amount_mismatch';

export interface MarkOrderPaidResult {
  status: MarkOrderPaidStatus;
  orderNumber: string;
  message: string;
}

/**
 * Marca un pedido como pagado y dispara los avisos (comprador + Estrella).
 *
 * Es **idempotente**: si ya estaba pagado no vuelve a notificar (Khipu reintenta la
 * notificación hasta por dos días si no recibe un 200). Sólo se confía en el aviso
 * después de validar la firma del webhook y de comparar el monto con el total del pedido.
 */
export async function markOrderPaid(
  db: Database,
  input: MarkOrderPaidInput,
  context: MarkOrderPaidContext,
): Promise<MarkOrderPaidResult> {
  const [order] = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      trackingCode: orders.trackingCode,
      orderStatus: orders.orderStatus,
      paymentStatus: orders.paymentStatus,
      paymentExternalId: orders.paymentExternalId,
      customerName: orders.customerName,
      customerRut: orders.customerRut,
      customerEmail: orders.customerEmail,
      customerPhone: orders.customerPhone,
      deliveryMethod: orders.deliveryMethod,
      regionName: orders.regionName,
      comuna: orders.comuna,
      addressLine: orders.addressLine,
      addressReference: orders.addressReference,
      customerNotes: orders.customerNotes,
      subtotalClp: orders.subtotalClp,
      shippingCostClp: orders.shippingCostClp,
      totalClp: orders.totalClp,
      paymentMethod: orders.paymentMethod,
    })
    .from(orders)
    .where(eq(orders.orderNumber, input.orderNumber))
    .limit(1);

  if (!order) {
    return {
      status: 'not_found',
      orderNumber: input.orderNumber,
      message: `No existe un pedido con el número ${input.orderNumber}.`,
    };
  }

  if (order.paymentStatus === 'PAID') {
    return {
      status: 'already_paid',
      orderNumber: order.orderNumber,
      message: 'El pedido ya estaba marcado como pagado.',
    };
  }

  if (input.amountClp !== null && Math.round(input.amountClp) !== order.totalClp) {
    console.error(
      `[khipu] El monto notificado (${input.amountClp}) no coincide con el total del pedido ${order.orderNumber} (${order.totalClp}).`,
    );

    return {
      status: 'amount_mismatch',
      orderNumber: order.orderNumber,
      message: 'El monto notificado no coincide con el total del pedido.',
    };
  }

  await db
    .update(orders)
    .set({
      paymentStatus: 'PAID',
      // No se retrocede un pedido ya despachado o entregado.
      orderStatus: order.orderStatus === 'PENDING' ? 'PAID' : order.orderStatus,
      paymentExternalId: input.paymentId ?? order.paymentExternalId,
      paidAt: input.paidAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  const items = await db
    .select({
      productId: orderItems.productId,
      sku: orderItems.skuSnapshot,
      name: orderItems.nameSnapshot,
      quantity: orderItems.quantity,
      unitPriceClp: orderItems.unitPriceClp,
      lineTotalClp: orderItems.lineTotalClp,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.id));

  // Stock que queda en bodega, para que Estrella sepa dónde está cada repuesto.
  const stockById = new Map<number, number>();
  const products = await loadOrderableProducts(
    db,
    items.map((item) => item.productId),
  );
  for (const product of products) stockById.set(product.id, product.stock);

  const emailItems: OrderEmailItem[] = items.map((item) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPriceClp: item.unitPriceClp,
    lineTotalClp: item.lineTotalClp,
    stockLeft: stockById.get(item.productId) ?? null,
  }));

  const settings = await readStoreSettings(db);
  const emailData = buildOrderEmailData(
    context.env,
    context.frontendUrl,
    {
      orderNumber: order.orderNumber,
      trackingCode: order.trackingCode,
      customerName: order.customerName,
      customerRut: order.customerRut,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      deliveryMethod: order.deliveryMethod,
      regionName: order.regionName,
      comuna: order.comuna,
      addressLine: order.addressLine,
      addressReference: order.addressReference,
      customerNotes: order.customerNotes,
      subtotalClp: order.subtotalClp,
      shippingCostClp: order.shippingCostClp,
      totalClp: order.totalClp,
      paymentMethod: order.paymentMethod,
    },
    emailItems,
  );

  // El comprobante al comprador y el aviso a Estrella salen en segundo plano.
  context.deliver(
    Promise.all([
      sendCustomerReceiptEmail(context.env, emailData),
      notifyStoreAboutPaidOrder(context.env, emailData, resolveStoreRecipients(settings)),
    ]),
  );

  return {
    status: 'paid',
    orderNumber: order.orderNumber,
    message: 'Pedido marcado como pagado.',
  };
}

// ---------------------------------------------------------------------------
// Panel de Estrella: pedidos y despachos (RF-08, HU-03)
// ---------------------------------------------------------------------------

export interface AdminOrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceClp: number;
  lineTotalClp: number;
}

/** Pedido tal como lo consume el panel (nombres alineados con el frontend). */
export interface AdminOrder {
  id: number;
  orderNumber: string;
  trackingCode: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerRut: string | null;
  deliveryMethod: string;
  regionCode: string;
  regionName: string;
  comuna: string;
  addressLine: string;
  addressReference: string | null;
  /** Notas del cliente (`customer_notes` en la base). */
  notes: string | null;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  orderStatus: string;
  courierName: string | null;
  courierTrackingNumber: string | null;
  subtotalClp: number;
  shippingCostClp: number;
  totalClp: number;
  stockDeducted: boolean;
  createdAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  items: AdminOrderItem[];
}

export interface AdminOrderFilters {
  status?: 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentStatus?: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  q?: string;
  limit?: number;
}

const adminOrderColumns = {
  id: orders.id,
  orderNumber: orders.orderNumber,
  trackingCode: orders.trackingCode,
  customerName: orders.customerName,
  customerPhone: orders.customerPhone,
  customerEmail: orders.customerEmail,
  customerRut: orders.customerRut,
  deliveryMethod: orders.deliveryMethod,
  regionCode: orders.regionCode,
  regionName: orders.regionName,
  comuna: orders.comuna,
  addressLine: orders.addressLine,
  addressReference: orders.addressReference,
  customerNotes: orders.customerNotes,
  paymentMethod: orders.paymentMethod,
  paymentStatus: orders.paymentStatus,
  orderStatus: orders.orderStatus,
  courierName: orders.courierName,
  courierTrackingNumber: orders.courierTrackingNumber,
  subtotalClp: orders.subtotalClp,
  shippingCostClp: orders.shippingCostClp,
  totalClp: orders.totalClp,
  stockDeducted: orders.stockDeducted,
  createdAt: orders.createdAt,
  paidAt: orders.paidAt,
  shippedAt: orders.shippedAt,
  deliveredAt: orders.deliveredAt,
};

type AdminOrderRow = {
  [K in keyof typeof adminOrderColumns]: K extends
    | 'createdAt'
    | 'paidAt'
    | 'shippedAt'
    | 'deliveredAt'
    ? Date | null
    : unknown;
};

function toAdminOrder(row: Record<string, unknown>, items: AdminOrderItem[]): AdminOrder {
  const iso = (value: unknown): string | null =>
    value instanceof Date ? value.toISOString() : null;

  return {
    id: Number(row['id']),
    orderNumber: String(row['orderNumber']),
    trackingCode: String(row['trackingCode']),
    customerName: String(row['customerName']),
    customerPhone: String(row['customerPhone']),
    customerEmail: String(row['customerEmail']),
    customerRut: (row['customerRut'] as string | null) ?? null,
    deliveryMethod: String(row['deliveryMethod']),
    regionCode: String(row['regionCode']),
    regionName: String(row['regionName']),
    comuna: String(row['comuna']),
    addressLine: String(row['addressLine']),
    addressReference: (row['addressReference'] as string | null) ?? null,
    notes: (row['customerNotes'] as string | null) ?? null,
    paymentMethod: String(row['paymentMethod']),
    paymentStatus: String(row['paymentStatus']),
    status: String(row['orderStatus']),
    orderStatus: String(row['orderStatus']),
    courierName: (row['courierName'] as string | null) ?? null,
    courierTrackingNumber: (row['courierTrackingNumber'] as string | null) ?? null,
    subtotalClp: Number(row['subtotalClp']),
    shippingCostClp: Number(row['shippingCostClp']),
    totalClp: Number(row['totalClp']),
    stockDeducted: row['stockDeducted'] === true,
    createdAt: iso(row['createdAt']),
    paidAt: iso(row['paidAt']),
    shippedAt: iso(row['shippedAt']),
    deliveredAt: iso(row['deliveredAt']),
    items,
  };
}

/** Carga los ítems de varios pedidos sin hacer una consulta por pedido. */
async function loadItemsByOrder(
  db: Database,
  orderIds: number[],
): Promise<Map<number, AdminOrderItem[]>> {
  const result = new Map<number, AdminOrderItem[]>();
  if (orderIds.length === 0) return result;

  for (let index = 0; index < orderIds.length; index += 80) {
    const group = orderIds.slice(index, index + 80);
    const rows = await db
      .select({
        orderId: orderItems.orderId,
        sku: orderItems.skuSnapshot,
        name: orderItems.nameSnapshot,
        quantity: orderItems.quantity,
        unitPriceClp: orderItems.unitPriceClp,
        lineTotalClp: orderItems.lineTotalClp,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, group))
      .orderBy(asc(orderItems.id));

    for (const row of rows) {
      const list = result.get(row.orderId) ?? [];
      list.push({
        sku: row.sku,
        name: row.name,
        quantity: row.quantity,
        unitPriceClp: row.unitPriceClp,
        lineTotalClp: row.lineTotalClp,
      });
      result.set(row.orderId, list);
    }
  }

  return result;
}

/**
 * Lista los pedidos del panel, ordenados por urgencia operativa
 * (primero lo que hay que despachar hoy) como pide `AGENTS.md` §5.2.
 */
export async function listAdminOrders(
  db: Database,
  filters: AdminOrderFilters = {},
): Promise<AdminOrder[]> {
  const conditions = [];

  if (filters.status) conditions.push(eq(orders.orderStatus, filters.status));
  if (filters.paymentStatus) conditions.push(eq(orders.paymentStatus, filters.paymentStatus));

  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, ' ').trim()}%`;
    const search = or(
      like(orders.orderNumber, pattern),
      like(orders.customerName, pattern),
      like(orders.customerEmail, pattern),
      like(orders.customerPhone, pattern),
      like(orders.trackingCode, pattern),
    );
    if (search) conditions.push(search);
  }

  const priority = sql`CASE
    WHEN ${orders.orderStatus} = 'PAID' THEN 0
    WHEN ${orders.orderStatus} = 'PENDING' AND ${orders.paymentMethod} = 'BANK_TRANSFER' THEN 1
    WHEN ${orders.orderStatus} = 'PENDING' THEN 2
    WHEN ${orders.orderStatus} = 'SHIPPED' THEN 3
    WHEN ${orders.orderStatus} = 'DELIVERED' THEN 4
    ELSE 5
  END`;

  const rows = await db
    .select(adminOrderColumns)
    .from(orders)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(priority, desc(orders.createdAt), desc(orders.id))
    .limit(filters.limit ?? 200);

  const itemsByOrder = await loadItemsByOrder(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => toAdminOrder(row as unknown as Record<string, unknown>, itemsByOrder.get(row.id) ?? []));
}

/** Ficha completa de un pedido para el panel (incluye los ítems). */
export async function getAdminOrder(db: Database, orderId: number): Promise<AdminOrder | null> {
  const [row] = await db.select(adminOrderColumns).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!row) return null;

  const itemsByOrder = await loadItemsByOrder(db, [row.id]);

  return toAdminOrder(row as unknown as Record<string, unknown>, itemsByOrder.get(row.id) ?? []);
}

/** Devuelve al inventario todo lo que el pedido había descontado (una sola vez). */
export async function restoreOrderStock(db: Database, orderId: number): Promise<number> {
  const items = await db
    .select({ productId: orderItems.productId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  let restored = 0;
  for (const item of items) {
    await restoreProductStock(db, item.productId, item.quantity);
    restored += item.quantity;
  }

  return restored;
}

export interface ChangeOrderStatusInput {
  status: 'PENDING' | 'PAID' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  courierName?: string | null;
  courierTrackingNumber?: string | null;
}

export interface ChangeOrderStatusContext {
  env: Env;
  frontendUrl: string;
  deliver: (promise: Promise<unknown>) => void;
}

export interface ChangeOrderStatusResult {
  order: AdminOrder;
  /** Enlace de WhatsApp con el comprador, listo para el botón de 1 clic del panel. */
  whatsappUrl: string | null;
  /** Unidades devueltas al inventario (solo al cancelar). */
  stockRestored: number;
  /** Si el cambio confirmó el pago (transferencia verificada por Estrella). */
  paymentConfirmed: boolean;
}

/**
 * Cambia el estado de un pedido desde el panel (RF-08).
 *
 * - Al pasar a **`PAID`** (por ejemplo, cuando Estrella confirma una transferencia) se
 *   marca el pago como recibido y se disparan los mismos avisos que el webhook de Khipu.
 * - Al pasar a **`SHIPPED`** se guardan el courier y el número de seguimiento, y se le
 *   avisa al comprador por correo (además se devuelve el enlace de WhatsApp para que
 *   Estrella le mande el número de seguimiento en 1 clic).
 * - Al pasar a **`CANCELLED`** se **devuelve el stock** de los ítems (una sola vez, con
 *   la bandera `stock_deducted`).
 */
export async function changeOrderStatus(
  db: Database,
  orderId: number,
  input: ChangeOrderStatusInput,
  context: ChangeOrderStatusContext,
): Promise<ChangeOrderStatusResult> {
  const [row] = await db
    .select(adminOrderColumns)
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!row) {
    throw new AppError('ORDER_NOT_FOUND', 'No encontramos ese pedido.', 404);
  }

  const itemsByOrder = await loadItemsByOrder(db, [row.id]);
  const items = itemsByOrder.get(row.id) ?? [];
  const now = new Date();

  const changes: Record<string, unknown> = { orderStatus: input.status, updatedAt: now };
  let paymentConfirmed = false;
  let stockRestored = 0;

  if (input.status === 'PAID' && row.paymentStatus !== 'PAID') {
    changes['paymentStatus'] = 'PAID';
    changes['paidAt'] = row.paidAt ?? now;
    paymentConfirmed = true;
  }

  if (input.status === 'PAID' && row.paidAt === null) {
    changes['paidAt'] = now;
  }

  if (input.status === 'SHIPPED') {
    changes['courierName'] = input.courierName?.trim() || row.courierName;
    changes['courierTrackingNumber'] =
      input.courierTrackingNumber?.trim() || row.courierTrackingNumber;
    if (row.shippedAt === null) changes['shippedAt'] = now;
  }

  if (input.status === 'DELIVERED' && row.deliveredAt === null) {
    changes['deliveredAt'] = now;
  }

  if (input.status === 'CANCELLED' && row.stockDeducted === true) {
    stockRestored = await restoreOrderStock(db, row.id);
    changes['stockDeducted'] = false;
  }

  await db.update(orders).set(changes).where(eq(orders.id, row.id));

  const updated = await getAdminOrder(db, row.id);
  if (updated === null) {
    throw new AppError('ORDER_NOT_FOUND', 'No encontramos ese pedido.', 404);
  }

  const emailItems: OrderEmailItem[] = items.map((item) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    unitPriceClp: item.unitPriceClp,
    lineTotalClp: item.lineTotalClp,
  }));

  const emailData = buildOrderEmailData(
    context.env,
    context.frontendUrl,
    {
      orderNumber: updated.orderNumber,
      trackingCode: updated.trackingCode,
      customerName: updated.customerName,
      customerRut: updated.customerRut,
      customerEmail: updated.customerEmail,
      customerPhone: updated.customerPhone,
      deliveryMethod: updated.deliveryMethod,
      regionName: updated.regionName,
      comuna: updated.comuna,
      addressLine: updated.addressLine,
      addressReference: updated.addressReference,
      customerNotes: updated.notes,
      subtotalClp: updated.subtotalClp,
      shippingCostClp: updated.shippingCostClp,
      totalClp: updated.totalClp,
      paymentMethod: updated.paymentMethod,
    },
    emailItems,
  );

  // Avisos: al confirmar el pago se repiten los del webhook; al despachar, el del courier.
  if (paymentConfirmed) {
    const settings = await readStoreSettings(db);
    context.deliver(
      Promise.all([
        sendCustomerReceiptEmail(context.env, emailData),
        notifyStoreAboutPaidOrder(context.env, emailData, resolveStoreRecipients(settings)),
      ]),
    );
  }

  if (input.status === 'SHIPPED') {
    context.deliver(
      sendCustomerShippedEmail(context.env, {
        ...emailData,
        items: emailItems,
        courierName: updated.courierName,
        courierTrackingNumber: updated.courierTrackingNumber,
      }),
    );
  }

  return {
    order: updated,
    whatsappUrl: emailData.customerWhatsAppUrl,
    stockRestored,
    paymentConfirmed,
  };
}
