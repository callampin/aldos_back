/**
 * Datos semilla del catálogo y configuración inicial de la tienda.
 *
 * Este módulo es **puro** (no accede a la base de datos ni al sistema de archivos),
 * para poder ejecutarse tanto dentro de Cloudflare Workers como desde Node.
 * El SQL idempotente se genera con `buildSeedSql()` y se aplica con
 * `pnpm db:seed:local` (ver `scripts/generate-seed-sql.mjs` y `NOTAS.md` H-09).
 *
 * Todas las semillas son idempotentes: se pueden aplicar varias veces sin
 * duplicar filas ni romper referencias.
 */

// ---------------------------------------------------------------------------
// Tipos locales (deliberadamente sin imports relativos: ver NOTAS.md H-09)
// ---------------------------------------------------------------------------
export type SeedMotorcycleLine = 'XR_CLASSIC' | 'ENDURO' | 'CROSS' | 'MULTI';
export type SeedSaleMode = 'DIRECT' | 'WHATSAPP_ONLY';
export type SeedCondition = 'NEW' | 'USED';

export interface SeedShippingRate {
  regionCode: string;
  regionName: string;
  baseCostClp: number;
  isPayableOnDelivery: boolean;
  estimatedDays: string;
  courierName?: string;
}

export interface SeedCategory {
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
}

export interface SeedMotorcycle {
  brand: string;
  model: string;
  line: SeedMotorcycleLine;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface SeedCompatibility {
  brand: string;
  model: string;
  fitmentNotes?: string;
}

export interface SeedProduct {
  sku: string;
  name: string;
  slug: string;
  categorySlug: string;
  description: string;
  oemPartNumber?: string;
  priceClp: number;
  stock: number;
  lowStockThreshold?: number;
  saleMode: SeedSaleMode;
  condition: SeedCondition;
  isUniversal: boolean;
  weightGrams?: number;
  isFeatured?: boolean;
  compatible: SeedCompatibility[];
}

export interface SeedStoreSetting {
  key: string;
  value: string;
}

// ---------------------------------------------------------------------------
// 16 regiones de Chile + zona especial Isla de Pascua / Rapa Nui (RF-10)
// ---------------------------------------------------------------------------
export const SEED_SHIPPING_RATES: readonly SeedShippingRate[] = [
  {
    regionCode: 'XV',
    regionName: 'Región de Arica y Parinacota',
    baseCostClp: 7990,
    isPayableOnDelivery: false,
    estimatedDays: '4 a 6 días hábiles',
  },
  {
    regionCode: 'I',
    regionName: 'Región de Tarapacá',
    baseCostClp: 7990,
    isPayableOnDelivery: false,
    estimatedDays: '4 a 6 días hábiles',
  },
  {
    regionCode: 'II',
    regionName: 'Región de Antofagasta',
    baseCostClp: 7490,
    isPayableOnDelivery: false,
    estimatedDays: '4 a 5 días hábiles',
  },
  {
    regionCode: 'III',
    regionName: 'Región de Atacama',
    baseCostClp: 6490,
    isPayableOnDelivery: false,
    estimatedDays: '3 a 5 días hábiles',
  },
  {
    regionCode: 'IV',
    regionName: 'Región de Coquimbo',
    baseCostClp: 5490,
    isPayableOnDelivery: false,
    estimatedDays: '3 a 4 días hábiles',
  },
  {
    regionCode: 'V',
    regionName: 'Región de Valparaíso',
    baseCostClp: 4290,
    isPayableOnDelivery: false,
    estimatedDays: '2 a 3 días hábiles',
  },
  {
    regionCode: 'RM',
    regionName: 'Región Metropolitana de Santiago',
    baseCostClp: 3490,
    isPayableOnDelivery: true,
    estimatedDays: '24 a 48 hrs hábiles — Despacho en el día',
  },
  {
    regionCode: 'VI',
    regionName: "Región del Libertador General Bernardo O'Higgins",
    baseCostClp: 4290,
    isPayableOnDelivery: false,
    estimatedDays: '2 a 3 días hábiles',
  },
  {
    regionCode: 'VII',
    regionName: 'Región del Maule',
    baseCostClp: 4790,
    isPayableOnDelivery: false,
    estimatedDays: '2 a 4 días hábiles',
  },
  {
    regionCode: 'XVI',
    regionName: 'Región de Ñuble',
    baseCostClp: 4990,
    isPayableOnDelivery: false,
    estimatedDays: '3 a 4 días hábiles',
  },
  {
    regionCode: 'VIII',
    regionName: 'Región del Biobío',
    baseCostClp: 5290,
    isPayableOnDelivery: false,
    estimatedDays: '3 a 4 días hábiles',
  },
  {
    regionCode: 'IX',
    regionName: 'Región de La Araucanía',
    baseCostClp: 5990,
    isPayableOnDelivery: false,
    estimatedDays: '3 a 5 días hábiles',
  },
  {
    regionCode: 'XIV',
    regionName: 'Región de Los Ríos',
    baseCostClp: 6490,
    isPayableOnDelivery: false,
    estimatedDays: '4 a 5 días hábiles',
  },
  {
    regionCode: 'X',
    regionName: 'Región de Los Lagos',
    baseCostClp: 6990,
    isPayableOnDelivery: false,
    estimatedDays: '4 a 6 días hábiles',
  },
  {
    regionCode: 'XI',
    regionName: 'Región de Aysén del General Carlos Ibáñez del Campo',
    baseCostClp: 9490,
    isPayableOnDelivery: false,
    estimatedDays: '5 a 7 días hábiles',
  },
  {
    regionCode: 'XII',
    regionName: 'Región de Magallanes y de la Antártica Chilena',
    baseCostClp: 9490,
    isPayableOnDelivery: false,
    estimatedDays: '5 a 7 días hábiles',
  },
  {
    // Isla de Pascua pertenece a la Región de Valparaíso, pero por logística
    // se tarifica aparte (envío aéreo).
    regionCode: 'IPC',
    regionName: 'Isla de Pascua / Rapa Nui',
    baseCostClp: 18990,
    isPayableOnDelivery: false,
    estimatedDays: '7 a 12 días hábiles — vía aérea',
  },
];

// ---------------------------------------------------------------------------
// Categorías de repuestos del taller
// ---------------------------------------------------------------------------
export const SEED_CATEGORIES: readonly SeedCategory[] = [
  { name: 'Motor', slug: 'motor', description: 'Pistones, cilindros, carburadores, filtros y distribución.', sortOrder: 1 },
  { name: 'Transmisión', slug: 'transmision', description: 'Kits de arrastre, cadenas, piñones y coronas.', sortOrder: 2 },
  { name: 'Frenos', slug: 'frenos', description: 'Pastillas, discos, bombas y mangueras de freno.', sortOrder: 3 },
  { name: 'Suspensión', slug: 'suspension', description: 'Amortiguadores, horquillas, retenes y bujes.', sortOrder: 4 },
  { name: 'Plásticos y Chasis', slug: 'plasticos-y-chasis', description: 'Kits de plásticos, asientos, subchasis y carenados.', sortOrder: 5 },
  { name: 'Eléctrico', slug: 'electrico', description: 'Estatores, reguladores, bobinas, bujías y CDI.', sortOrder: 6 },
  { name: 'Accesorios Enduro', slug: 'accesorios-enduro', description: 'Protectores, manubrios, antiparras y equipamiento de enduro.', sortOrder: 7 },
];

// ---------------------------------------------------------------------------
// Motos emblemáticas del negocio: línea Honda XR (clásicas) + Enduro/Cross
// ---------------------------------------------------------------------------
export const SEED_MOTORCYCLES: readonly SeedMotorcycle[] = [
  { brand: 'Honda', model: 'XR 125L', line: 'XR_CLASSIC', yearFrom: 2003, yearTo: 2015 },
  { brand: 'Honda', model: 'XR 150L', line: 'XR_CLASSIC', yearFrom: 2014, yearTo: 2024 },
  { brand: 'Honda', model: 'XR 190L', line: 'XR_CLASSIC', yearFrom: 2017, yearTo: 2024 },
  { brand: 'Honda', model: 'XR 250 Tornado', line: 'XR_CLASSIC', yearFrom: 2001, yearTo: 2012 },
  { brand: 'Honda', model: 'XR 250R Japonés', line: 'XR_CLASSIC', yearFrom: 1996, yearTo: 2004 },
  { brand: 'Honda', model: 'XR 400R', line: 'XR_CLASSIC', yearFrom: 1996, yearTo: 2004 },
  { brand: 'Honda', model: 'XR 600R', line: 'XR_CLASSIC', yearFrom: 1988, yearTo: 2000 },
  { brand: 'Honda', model: 'XR 650L', line: 'XR_CLASSIC', yearFrom: 1993, yearTo: 2020 },
  { brand: 'Honda', model: 'CRF 250R', line: 'CROSS', yearFrom: 2004, yearTo: 2024 },
  { brand: 'Honda', model: 'CRF 450R', line: 'CROSS', yearFrom: 2002, yearTo: 2024 },
  { brand: 'Honda', model: 'CRF 250X', line: 'ENDURO', yearFrom: 2004, yearTo: 2017 },
  { brand: 'KTM', model: 'EXC 250', line: 'ENDURO', yearFrom: 2008, yearTo: 2024 },
  { brand: 'KTM', model: 'EXC 300', line: 'ENDURO', yearFrom: 2008, yearTo: 2024 },
  { brand: 'Yamaha', model: 'WR 250F', line: 'ENDURO', yearFrom: 2001, yearTo: 2024 },
  { brand: 'Yamaha', model: 'WR 450F', line: 'ENDURO', yearFrom: 2003, yearTo: 2024 },
  { brand: 'Yamaha', model: 'YZ 250', line: 'CROSS', yearFrom: 1996, yearTo: 2024 },
  { brand: 'Husqvarna', model: 'TE 300', line: 'ENDURO', yearFrom: 2014, yearTo: 2024 },
  { brand: 'Husqvarna', model: 'FE 450', line: 'ENDURO', yearFrom: 2014, yearTo: 2024 },
  { brand: 'Beta', model: 'RR 300', line: 'ENDURO', yearFrom: 2013, yearTo: 2024 },
  { brand: 'GasGas', model: 'EC 300', line: 'ENDURO', yearFrom: 2012, yearTo: 2024 },
  { brand: 'Suzuki', model: 'DR 350', line: 'MULTI', yearFrom: 1990, yearTo: 1999 },
];

// ---------------------------------------------------------------------------
// Catálogo inicial de repuestos de prueba (DIRECT y WHATSAPP_ONLY, NEW y USED)
// ---------------------------------------------------------------------------
export const SEED_PRODUCTS: readonly SeedProduct[] = [
  {
    sku: 'XR-PIST-250R-STD',
    name: 'Kit Pistón Original Honda XR 250R STD',
    slug: 'kit-piston-original-honda-xr-250r-std',
    categorySlug: 'motor',
    description:
      'Kit de pistón original medida estándar para Honda XR 250R japonés. Incluye pistón, anillos, pasador y seguros.',
    oemPartNumber: '13101-KCE-670',
    priceClp: 89990,
    stock: 3,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 900,
    isFeatured: true,
    compatible: [
      { brand: 'Honda', model: 'XR 250R Japonés', fitmentNotes: 'Verificar medida de la culata antes de montar.' },
      { brand: 'Honda', model: 'XR 250 Tornado' },
    ],
  },
  {
    sku: 'XR-CAD-250',
    name: 'Cadena de Distribución Honda XR 250',
    slug: 'cadena-de-distribucion-honda-xr-250',
    categorySlug: 'motor',
    description: 'Cadena de distribución reforzada para motores XR 250 de 2 y 4 válvulas.',
    oemPartNumber: '14401-KBZ-003',
    priceClp: 45990,
    stock: 5,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 700,
    compatible: [{ brand: 'Honda', model: 'XR 250 Tornado' }],
  },
  {
    sku: 'XR-FILT-AIRE-250',
    name: 'Filtro de Aire Honda XR 250R',
    slug: 'filtro-de-aire-honda-xr-250r',
    categorySlug: 'motor',
    description: 'Filtro de aire de espuma lavable con prefiltro, para uso en polvo y barro.',
    oemPartNumber: '17213-KCE-670',
    priceClp: 19990,
    stock: 8,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 300,
    compatible: [
      { brand: 'Honda', model: 'XR 250R Japonés' },
      { brand: 'Honda', model: 'XR 400R' },
    ],
  },
  {
    sku: 'XR-KIT-ARR-250',
    name: 'Kit de Arrastre Honda XR 250 Tornado',
    slug: 'kit-de-arrastre-honda-xr-250-tornado',
    categorySlug: 'transmision',
    description: 'Kit de arrastre completo: cadena 520, piñón y corona. Relación original de fábrica.',
    priceClp: 74990,
    stock: 4,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 2600,
    isFeatured: true,
    compatible: [
      { brand: 'Honda', model: 'XR 250 Tornado', fitmentNotes: 'Cadena 520, piñón 13 dientes.' },
      { brand: 'Honda', model: 'XR 250R Japonés' },
    ],
  },
  {
    sku: 'XR-PAST-FRENO-250',
    name: 'Pastillas de Freno Delanteras Honda XR 250',
    slug: 'pastillas-de-freno-delanteras-honda-xr-250',
    categorySlug: 'frenos',
    description: 'Pastillas de freno sinterizadas para uso exigente en enduro y polvo.',
    priceClp: 22990,
    stock: 6,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 300,
    compatible: [
      { brand: 'Honda', model: 'XR 250 Tornado' },
      { brand: 'Honda', model: 'XR 250R Japonés' },
    ],
  },
  {
    sku: 'XR-ESTATOR-650L',
    name: 'Estator Honda XR 650L',
    slug: 'estator-honda-xr-650l',
    categorySlug: 'electrico',
    description: 'Estator original de recambio para XR 650L. Incluye conector y cables.',
    oemPartNumber: '31120-MY6-000',
    priceClp: 159990,
    stock: 2,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 1200,
    compatible: [{ brand: 'Honda', model: 'XR 650L' }],
  },
  {
    sku: 'XR-BUJI-NGK-DPR8E',
    name: 'Bujía NGK DPR8EA-9',
    slug: 'bujia-ngk-dpr8ea-9',
    categorySlug: 'electrico',
    description: 'Bujía NGK de nickel, medida original para motores XR. Se recomienda cambiar cada 8.000 km.',
    oemPartNumber: '98079-5885V',
    priceClp: 5990,
    stock: 30,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 60,
    compatible: [
      { brand: 'Honda', model: 'XR 250 Tornado' },
      { brand: 'Honda', model: 'XR 250R Japonés' },
      { brand: 'Honda', model: 'XR 400R' },
      { brand: 'Honda', model: 'XR 600R' },
    ],
  },
  {
    sku: 'UNI-ACEITE-10W40',
    name: 'Aceite Motul 5100 10W40 Semisintético 1L',
    slug: 'aceite-motul-5100-10w40-semisintetico-1l',
    categorySlug: 'motor',
    description: 'Aceite semisintético 10W40 para motores de 4 tiempos, húmedo de embrague. Sirve para cualquier moto.',
    priceClp: 12990,
    stock: 24,
    lowStockThreshold: 6,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: true,
    weightGrams: 1000,
    compatible: [],
  },
  {
    sku: 'EN-PAST-BREMBO-EXC',
    name: 'Pastillas de Freno Brembo Sinterizadas KTM EXC',
    slug: 'pastillas-de-freno-brembo-sinterizadas-ktm-exc',
    categorySlug: 'frenos',
    description: 'Pastillas Brembo sinterizadas para enduro de alta exigencia. Verificar medida de disco.',
    priceClp: 34990,
    stock: 7,
    saleMode: 'DIRECT',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 320,
    compatible: [
      { brand: 'KTM', model: 'EXC 300' },
      { brand: 'Husqvarna', model: 'TE 300' },
    ],
  },
  {
    sku: 'EN-CARB-KEIHIN-300',
    name: 'Carburador Keihin PWK 38 KTM EXC 300',
    slug: 'carburador-keihin-pwk-38-ktm-exc-300',
    categorySlug: 'motor',
    description:
      'Carburador Keihin PWK 38 mm de alto valor. Requiere validación técnica de Aldo antes de vender (ajuste de aguja y chicles según altitud).',
    priceClp: 319990,
    stock: 2,
    saleMode: 'WHATSAPP_ONLY',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 1500,
    isFeatured: true,
    compatible: [
      { brand: 'KTM', model: 'EXC 300', fitmentNotes: 'Se cotiza con el mecánico: se ajusta la carburación antes de entregar.' },
      { brand: 'KTM', model: 'EXC 250' },
    ],
  },
  {
    sku: 'EN-AMORT-WP-EXC300',
    name: 'Amortiguador Trasero WP KTM EXC 300 (usado reacondicionado)',
    slug: 'amortiguador-trasero-wp-ktm-exc-300-usado',
    categorySlug: 'suspension',
    description:
      'Amortiguador WP usado, reacondicionado y probado por Aldo. Pieza única: se coordina por WhatsApp con el cliente antes de la venta.',
    priceClp: 289990,
    stock: 1,
    saleMode: 'WHATSAPP_ONLY',
    condition: 'USED',
    isUniversal: false,
    weightGrams: 4500,
    compatible: [
      {
        brand: 'KTM',
        model: 'EXC 300',
        fitmentNotes: 'Solo versión con bieletas. Medidas y recorrido verificados por el mecánico.',
      },
    ],
  },
  {
    sku: 'EN-KIT-PLAST-BETA',
    name: 'Kit Plásticos Completo Beta RR 300',
    slug: 'kit-plasticos-completo-beta-rr-300',
    categorySlug: 'plasticos-y-chasis',
    description: 'Kit de plásticos completo con gráficas originales. Se pide por encargo al proveedor.',
    priceClp: 189990,
    stock: 0,
    saleMode: 'WHATSAPP_ONLY',
    condition: 'NEW',
    isUniversal: false,
    weightGrams: 3200,
    compatible: [{ brand: 'Beta', model: 'RR 300' }],
  },
];

// ---------------------------------------------------------------------------
// Configuración global de la tienda (§4.11)
// ---------------------------------------------------------------------------
export const SEED_STORE_SETTINGS: readonly SeedStoreSetting[] = [
  { key: 'whatsapp_number', value: '+56900000000' },
  { key: 'store_email', value: 'contacto@aldosmotos.cl' },
  { key: 'dispatch_cutoff_hour', value: '15' },
  { key: 'allow_khipu', value: 'true' },
  { key: 'allow_manual_transfer', value: 'true' },
  { key: 'hide_out_of_stock', value: 'false' },
  {
    key: 'bank_transfer_details',
    value:
      '{"banco":"Banco de Chile","tipo_cuenta":"Cuenta Corriente","numero":"0000000000","titular":"Aldos Motos SpA","rut":"00000000-0","email":"contacto@aldosmotos.cl"}',
  },
];

/** Cuenta administradora inicial (Estrella). En producción se debe cambiar la contraseña. */
export const DEFAULT_ADMIN = {
  email: 'contacto@aldosmotos.cl',
  name: 'Estrella',
  /** Contraseña solo para desarrollo local. */
  password: 'AldosMotors2026!',
} as const;

// ---------------------------------------------------------------------------
// Generador de SQL idempotente
// ---------------------------------------------------------------------------

/** Escapa un string para SQL (comillas simples duplicadas). */
function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** `NULL` o el número. */
function n(value: number | null | undefined): string {
  return value === null || value === undefined ? 'NULL' : String(value);
}

function bool(value: boolean): string {
  return value ? '1' : '0';
}

export interface BuildSeedSqlOptions {
  /** Hash PBKDF2 ya calculado para `DEFAULT_ADMIN.password`. */
  adminPasswordHash: string;
}

/** Genera el SQL idempotente de toda la semilla, listo para `wrangler d1 execute --file`. */
export function buildSeedSql({ adminPasswordHash }: BuildSeedSqlOptions): string {
  const statements: string[] = [];

  statements.push(
    '-- Semilla generada por `pnpm db:seed:generate` (ver src/db/seed.ts). NO editar a mano.',
    '-- Es idempotente: se puede aplicar varias veces sin duplicar filas.',
  );

  // Regiones y tarifas de envío
  for (const rate of SEED_SHIPPING_RATES) {
    statements.push(`INSERT INTO shipping_rates (region_code, region_name, base_cost_clp, is_payable_on_delivery, estimated_days, courier_name, is_active)
SELECT ${q(rate.regionCode)}, ${q(rate.regionName)}, ${rate.baseCostClp}, ${bool(rate.isPayableOnDelivery)}, ${q(rate.estimatedDays)}, ${q(rate.courierName ?? 'Courier Propio / Convenio')}, 1
WHERE NOT EXISTS (SELECT 1 FROM shipping_rates WHERE region_code = ${q(rate.regionCode)});
UPDATE shipping_rates SET region_name = ${q(rate.regionName)}, base_cost_clp = ${rate.baseCostClp}, is_payable_on_delivery = ${bool(rate.isPayableOnDelivery)}, estimated_days = ${q(rate.estimatedDays)}, courier_name = ${q(rate.courierName ?? 'Courier Propio / Convenio')}, is_active = 1 WHERE region_code = ${q(rate.regionCode)};`);
  }

  // Categorías
  for (const category of SEED_CATEGORIES) {
    statements.push(`INSERT INTO categories (name, slug, description, sort_order, is_active)
VALUES (${q(category.name)}, ${q(category.slug)}, ${q(category.description)}, ${category.sortOrder}, 1)
ON CONFLICT(slug) DO UPDATE SET name = excluded.name, description = excluded.description, sort_order = excluded.sort_order, is_active = 1;`);
  }

  // Motos compatibles
  for (const bike of SEED_MOTORCYCLES) {
    statements.push(`INSERT INTO motorcycles (brand, model, line, year_from, year_to)
SELECT ${q(bike.brand)}, ${q(bike.model)}, ${q(bike.line)}, ${n(bike.yearFrom)}, ${n(bike.yearTo)}
WHERE NOT EXISTS (SELECT 1 FROM motorcycles WHERE brand = ${q(bike.brand)} AND model = ${q(bike.model)});`);
  }

  // Productos
  for (const product of SEED_PRODUCTS) {
    statements.push(`INSERT INTO products (sku, name, slug, category_id, description, oem_part_number, price_clp, stock, low_stock_threshold, sale_mode, condition, is_universal, weight_grams, is_featured, is_active)
VALUES (${q(product.sku)}, ${q(product.name)}, ${q(product.slug)}, (SELECT id FROM categories WHERE slug = ${q(product.categorySlug)}), ${q(product.description)}, ${product.oemPartNumber ? q(product.oemPartNumber) : 'NULL'}, ${product.priceClp}, ${product.stock}, ${product.lowStockThreshold ?? 1}, ${q(product.saleMode)}, ${q(product.condition)}, ${bool(product.isUniversal)}, ${product.weightGrams ?? 500}, ${bool(product.isFeatured ?? false)}, 1)
ON CONFLICT(sku) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  category_id = excluded.category_id,
  description = excluded.description,
  oem_part_number = excluded.oem_part_number,
  price_clp = excluded.price_clp,
  stock = excluded.stock,
  low_stock_threshold = excluded.low_stock_threshold,
  sale_mode = excluded.sale_mode,
  condition = excluded.condition,
  is_universal = excluded.is_universal,
  weight_grams = excluded.weight_grams,
  is_featured = excluded.is_featured,
  is_active = 1,
  updated_at = unixepoch();`);
  }

  // Compatibilidad producto ↔ moto
  for (const product of SEED_PRODUCTS) {
    for (const fit of product.compatible) {
      statements.push(`INSERT OR IGNORE INTO product_compatibility (product_id, motorcycle_id, fitment_notes)
SELECT p.id, m.id, ${fit.fitmentNotes ? q(fit.fitmentNotes) : 'NULL'}
FROM products p, motorcycles m
WHERE p.sku = ${q(product.sku)} AND m.brand = ${q(fit.brand)} AND m.model = ${q(fit.model)};`);
    }
  }

  // Configuración de la tienda
  for (const setting of SEED_STORE_SETTINGS) {
    statements.push(`INSERT INTO store_settings (key, value)
VALUES (${q(setting.key)}, ${q(setting.value)})
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch();`);
  }

  // Cuenta administradora de Estrella
  statements.push(`INSERT INTO admins (email, name, password_hash)
VALUES (${q(DEFAULT_ADMIN.email)}, ${q(DEFAULT_ADMIN.name)}, ${q(adminPasswordHash)})
ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, updated_at = unixepoch();`);

  return `${statements.join('\n\n')}\n`;
}
