import { env } from 'cloudflare:workers';

import { createDb, type Database } from '../../src/db';
import { orderItems, orders, productCompatibility, productImages, products, shippingRates } from '../../src/db/schema';
import type { CreateOrderContext } from '../../src/services/order.service';
import type { Env } from '../../src/types/bindings';
import type { CheckoutInput } from '../../src/validators/order.schema';

/**
 * Ayudas compartidas por los tests de integración.
 *
 * Estos tests corren sobre el runtime de Workers con una **base D1 real** (las mismas
 * migraciones que producción, aplicadas por `test/setup.ts`). El almacenamiento es
 * aislado por test, así que cada prueba prepara sus propios datos.
 */

export function getDb(): Database {
  return createDb(env.DB);
}

/** Entorno con los secretos y variables que necesitan los servicios. */
export const testEnv = {
  ...env,
  JWT_SECRET: 'secreto-solo-para-pruebas',
  KHIPU_API_KEY: '',
  KHIPU_WEBHOOK_SECRET: 'secreto-webhook-de-pruebas',
  RESEND_API_KEY: '',
  STORE_WHATSAPP: '+56900000000',
  FRONTEND_URL: 'http://localhost:4321',
} as unknown as Env;

/** Contexto de checkout para los tests: sin envíos reales de correo. */
export const orderContext: CreateOrderContext = {
  env: testEnv,
  publicApiUrl: 'http://localhost:8787',
  frontendUrl: 'http://localhost:4321',
  deliver: () => {
    /* No se envían correos en los tests. */
  },
};

/** Contexto para el webhook / cambio de estado. */
export const paymentContext = {
  env: testEnv,
  frontendUrl: 'http://localhost:4321',
  deliver: () => {
    /* No se envían correos en los tests. */
  },
};

let sequence = 0;

function uniqueSuffix(): string {
  sequence += 1;
  return `${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface InsertedProduct {
  id: number;
  sku: string;
  name: string;
}

/** Inserta un repuesto para la prueba. */
export async function insertProduct(
  overrides: Partial<{
    stock: number;
    priceClp: number;
    saleMode: 'DIRECT' | 'WHATSAPP_ONLY';
    isActive: boolean;
    lowStockThreshold: number;
  }> = {},
): Promise<InsertedProduct> {
  const suffix = uniqueSuffix();
  const sku = `TEST-${suffix}`;

  const [row] = await getDb()
    .insert(products)
    .values({
      sku,
      name: `Repuesto de prueba ${suffix}`,
      slug: `repuesto-de-prueba-${suffix}`,
      priceClp: overrides.priceClp ?? 10_000,
      stock: overrides.stock ?? 3,
      lowStockThreshold: overrides.lowStockThreshold ?? 1,
      saleMode: overrides.saleMode ?? 'DIRECT',
      condition: 'NEW',
      isUniversal: false,
      weightGrams: 500,
      isFeatured: false,
      isActive: overrides.isActive ?? true,
    })
    .returning({ id: products.id, sku: products.sku, name: products.name });

  if (!row) throw new Error('No se pudo insertar el repuesto de prueba.');

  return row;
}

/** Asegura que exista la tarifa de la región (el entorno de pruebas parte sin semilla). */
export async function ensureRegion(regionCode = 'RM', baseCostClp = 3_490): Promise<void> {
  await getDb()
    .insert(shippingRates)
    .values({
      regionCode,
      regionName: 'Región Metropolitana de Santiago',
      baseCostClp,
      isPayableOnDelivery: true,
      estimatedDays: '24 a 48 hrs hábiles',
      courierName: 'Courier de prueba',
      isActive: true,
    })
    .onConflictDoNothing();
}

/** Datos de checkout válidos, para sobreescribir sólo lo que interesa en cada test. */
export function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    customerName: 'Pedro Soto',
    customerRut: null,
    customerEmail: 'pedro@example.cl',
    customerPhone: '+56912345678',
    deliveryMethod: 'PICKUP',
    regionCode: 'RM',
    comuna: 'Maipú',
    addressLine: 'Av. Siempre Viva 123, casa 4',
    addressReference: null,
    customerNotes: null,
    paymentMethod: 'BANK_TRANSFER',
    items: [],
    ...overrides,
  } as CheckoutInput;
}

/**
 * Deja la base limpia antes de cada prueba.
 *
 * El almacenamiento de pruebas **se comparte entre los tests de un mismo archivo**
 * (la aislación de Cloudflare es por archivo, no por test), así que cada prueba
 * arranca desde cero para poder afirmar cosas como "no se creó ningún pedido".
 */
export async function resetDatabase(): Promise<void> {
  const db = getDb();

  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(productCompatibility);
  await db.delete(productImages);
  await db.delete(products);
  await db.delete(shippingRates);
}
