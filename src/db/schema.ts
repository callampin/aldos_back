import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema relacional completo del backend (Cloudflare D1 / SQLite).
 *
 * Reglas de negocio aplicadas a nivel de esquema:
 * - Todo monto de dinero es un entero en pesos chilenos (`INTEGER`, nunca REAL/FLOAT).
 * - Los booleanos se guardan como `INTEGER` 0/1 (`{ mode: 'boolean' }`).
 * - Las fechas se guardan como timestamp Unix en segundos (`{ mode: 'timestamp' }`),
 *   con `unixepoch()` como valor por defecto en la propia base de datos.
 */

const nowDefault = sql`(unixepoch())`;

/** Momento exacto (timestamp Unix en segundos) por defecto = ahora. */
const createdAt = () =>
  integer('created_at', { mode: 'timestamp' }).notNull().default(nowDefault);

/** Momento de última modificación (timestamp Unix en segundos) por defecto = ahora. */
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp' }).notNull().default(nowDefault);

// ---------------------------------------------------------------------------
// 4.1 admins — Usuarios administradores (Estrella)
// ---------------------------------------------------------------------------
export const admins = sqliteTable('admins', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  resetTokenHash: text('reset_token_hash'),
  resetTokenExpiresAt: integer('reset_token_expires_at', { mode: 'timestamp' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// 4.2 categories — Categorías de repuestos
// ---------------------------------------------------------------------------
export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

// ---------------------------------------------------------------------------
// 4.3 motorcycles — Catálogo de motos para compatibilidad (RF-01, RF-02)
// ---------------------------------------------------------------------------
export const motorcycles = sqliteTable(
  'motorcycles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    brand: text('brand').notNull(),
    model: text('model').notNull(),
    line: text('line', { enum: ['XR_CLASSIC', 'ENDURO', 'CROSS', 'MULTI'] }).notNull(),
    yearFrom: integer('year_from'),
    yearTo: integer('year_to'),
  },
  (t) => [index('idx_motorcycles_brand_model').on(t.brand, t.model)],
);

// ---------------------------------------------------------------------------
// 4.4 products — Catálogo principal de productos (RF-01, RF-07, RF-09)
// ---------------------------------------------------------------------------
export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Clave principal para la carga masiva de Estrella y referencia con Defontana. */
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    /** Optimizado para SEO (RNF-08). */
    slug: text('slug').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    description: text('description'),
    /** Código de parte original del fabricante (muy buscado en líneas XR y Enduro). */
    oemPartNumber: text('oem_part_number'),
    /** Precio en pesos chilenos, entero sin decimales. */
    priceClp: integer('price_clp').notNull(),
    stock: integer('stock').notNull().default(0),
    /** Umbral para las alertas de bajo stock del panel de Estrella. */
    lowStockThreshold: integer('low_stock_threshold').notNull().default(1),
    /** `DIRECT` = comprable en el carrito · `WHATSAPP_ONLY` = solo cotización por WhatsApp. */
    saleMode: text('sale_mode', { enum: ['DIRECT', 'WHATSAPP_ONLY'] })
      .notNull()
      .default('DIRECT'),
    /** `NEW` = nuevo · `USED` = usado (mitigación del riesgo R-01). */
    condition: text('condition', { enum: ['NEW', 'USED'] }).notNull().default('NEW'),
    /** 1 si sirve para cualquier moto (aceite, antiparras, etc.). */
    isUniversal: integer('is_universal', { mode: 'boolean' }).notNull().default(false),
    /** Peso de referencia para el cálculo de envío. */
    weightGrams: integer('weight_grams').default(500),
    isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('idx_products_sku').on(t.sku),
    uniqueIndex('idx_products_slug').on(t.slug),
    index('idx_products_category_active').on(t.categoryId, t.isActive),
    index('idx_products_oem').on(t.oemPartNumber),
  ],
);

// ---------------------------------------------------------------------------
// 4.5 product_images — Imágenes almacenadas en Cloudflare R2
// ---------------------------------------------------------------------------
export const productImages = sqliteTable(
  'product_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /** Ej: `products/104/main-1710000.webp` */
    r2Key: text('r2_key').notNull(),
    /** URL pública (dominio R2 o proxy del Worker con caché CDN). */
    url: text('url').notNull(),
    altText: text('alt_text'),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('idx_product_images_product').on(t.productId)],
);

// ---------------------------------------------------------------------------
// 4.6 product_compatibility — Relación N:M producto ↔ moto (HU-01)
// ---------------------------------------------------------------------------
export const productCompatibility = sqliteTable(
  'product_compatibility',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    motorcycleId: integer('motorcycle_id')
      .notNull()
      .references(() => motorcycles.id, { onDelete: 'cascade' }),
    yearFromOverride: integer('year_from_override'),
    yearToOverride: integer('year_to_override'),
    /** Notas técnicas de Aldo, ej. "Solo versión japonesa con carburador original". */
    fitmentNotes: text('fitment_notes'),
  },
  (t) => [uniqueIndex('idx_product_compatibility_unique').on(t.productId, t.motorcycleId)],
);

// ---------------------------------------------------------------------------
// 4.7 shipping_rates — Regiones de Chile y tarifas de courier (RF-10)
// ---------------------------------------------------------------------------
export const shippingRates = sqliteTable('shipping_rates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Ej: `RM`, `V`, `VIII`, `XII`, `IPC` (Isla de Pascua / Rapa Nui). */
  regionCode: text('region_code').notNull().unique(),
  regionName: text('region_name').notNull(),
  /** 0 si es retiro en tienda o "por pagar en destino". */
  baseCostClp: integer('base_cost_clp').notNull(),
  /** Permite la opción de envío "por pagar" si Estrella lo configura. */
  isPayableOnDelivery: integer('is_payable_on_delivery', { mode: 'boolean' })
    .notNull()
    .default(false),
  /** Ej: "24 a 48 hrs hábiles — Despacho en el día". */
  estimatedDays: text('estimated_days').notNull(),
  courierName: text('courier_name').notNull().default('Courier Propio / Convenio'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

// ---------------------------------------------------------------------------
// 4.8 orders — Pedidos de clientes (RF-04, RF-05, RF-08, RF-14)
// ---------------------------------------------------------------------------
export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Ej: `ALD-2026-0001` */
    orderNumber: text('order_number').notNull(),
    /** Código público corto y no predecible para el seguimiento (RF-14). Ej: `ALD-8F3K9P`. */
    trackingCode: text('tracking_code').notNull(),
    customerName: text('customer_name').notNull(),
    customerRut: text('customer_rut'),
    customerEmail: text('customer_email').notNull(),
    /** Formato +569XXXXXXXX. */
    customerPhone: text('customer_phone').notNull(),
    deliveryMethod: text('delivery_method', { enum: ['SHIPPING', 'PICKUP'] }).notNull(),
    regionCode: text('region_code').notNull(),
    regionName: text('region_name').notNull(),
    comuna: text('comuna').notNull(),
    addressLine: text('address_line').notNull(),
    /** Depto, block o indicaciones para el courier. */
    addressReference: text('address_reference'),
    customerNotes: text('customer_notes'),
    subtotalClp: integer('subtotal_clp').notNull(),
    shippingCostClp: integer('shipping_cost_clp').notNull(),
    totalClp: integer('total_clp').notNull(),
    paymentMethod: text('payment_method', { enum: ['KHIPU', 'BANK_TRANSFER'] }).notNull(),
    paymentStatus: text('payment_status', { enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] })
      .notNull()
      .default('PENDING'),
    /** ID de cobro de Khipu o N° de operación bancaria. */
    paymentExternalId: text('payment_external_id'),
    /** Comprobante opcional si pagó por transferencia manual. */
    paymentProofUrl: text('payment_proof_url'),
    orderStatus: text('order_status', {
      enum: ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
    })
      .notNull()
      .default('PENDING'),
    courierName: text('courier_name'),
    /** N° de orden de transporte del courier cuando Estrella despacha. */
    courierTrackingNumber: text('courier_tracking_number'),
    /** Bandera de idempotencia: 1 si el descuento de stock ya se aplicó. */
    stockDeducted: integer('stock_deducted', { mode: 'boolean' }).notNull().default(false),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    shippedAt: integer('shipped_at', { mode: 'timestamp' }),
    deliveredAt: integer('delivered_at', { mode: 'timestamp' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('idx_orders_order_number').on(t.orderNumber),
    uniqueIndex('idx_orders_tracking_code').on(t.trackingCode),
    index('idx_orders_status').on(t.orderStatus),
    index('idx_orders_payment_status').on(t.paymentStatus),
  ],
);

// ---------------------------------------------------------------------------
// 4.9 order_items — Snapshot histórico de los ítems del pedido
// ---------------------------------------------------------------------------
export const orderItems = sqliteTable(
  'order_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    skuSnapshot: text('sku_snapshot').notNull(),
    nameSnapshot: text('name_snapshot').notNull(),
    unitPriceClp: integer('unit_price_clp').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotalClp: integer('line_total_clp').notNull(),
  },
  (t) => [index('idx_order_items_order').on(t.orderId)],
);

// ---------------------------------------------------------------------------
// 4.10 stock_alerts — "Avisarme cuando llegue" (mitigación del riesgo R-03)
// ---------------------------------------------------------------------------
export const stockAlerts = sqliteTable(
  'stock_alerts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    customerName: text('customer_name').notNull(),
    /** Email o WhatsApp del cliente interesado. */
    customerContact: text('customer_contact').notNull(),
    isNotified: integer('is_notified', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('idx_stock_alerts_product').on(t.productId)],
);

// ---------------------------------------------------------------------------
// 4.11 store_settings — Configuración global editable por Estrella
// ---------------------------------------------------------------------------
export const storeSettings = sqliteTable('store_settings', {
  /** Ej: `whatsapp_number`, `bank_transfer_details`, `dispatch_cutoff_hour`, ... */
  key: text('key').primaryKey(),
  /** JSON o texto plano. */
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Tipos inferidos para usar en services, validadores y rutas
// ---------------------------------------------------------------------------
export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Motorcycle = typeof motorcycles.$inferSelect;
export type NewMotorcycle = typeof motorcycles.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
export type ProductCompatibility = typeof productCompatibility.$inferSelect;
export type NewProductCompatibility = typeof productCompatibility.$inferInsert;
export type ShippingRate = typeof shippingRates.$inferSelect;
export type NewShippingRate = typeof shippingRates.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
export type StockAlert = typeof stockAlerts.$inferSelect;
export type NewStockAlert = typeof stockAlerts.$inferInsert;
export type StoreSetting = typeof storeSettings.$inferSelect;
export type NewStoreSetting = typeof storeSettings.$inferInsert;

export type SaleMode = NonNullable<Product['saleMode']>;
export type ProductCondition = NonNullable<Product['condition']>;
export type MotorcycleLine = NonNullable<Motorcycle['line']>;
export type OrderStatus = NonNullable<Order['orderStatus']>;
export type PaymentStatus = NonNullable<Order['paymentStatus']>;
export type PaymentMethod = NonNullable<Order['paymentMethod']>;
export type DeliveryMethod = NonNullable<Order['deliveryMethod']>;
