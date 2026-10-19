import { and, asc, desc, eq, exists, gt, gte, inArray, isNull, like, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

import type { Database } from '../db';
import {
  categories,
  motorcycles,
  productCompatibility,
  productImages,
  products,
  shippingRates,
  stockAlerts,
  type MotorcycleLine,
  type ProductCondition,
  type SaleMode,
} from '../db/schema';

/**
 * Consultas del catálogo público (RF-01, RF-02, HU-01).
 *
 * La forma de los datos está alineada con lo que ya consume el frontend
 * (`front/src/lib/catalog.ts`): listas como arreglo + paginación en `meta`,
 * y el detalle como objeto único.
 */

export type CatalogSort = 'newest' | 'price_asc' | 'price_desc';
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface CatalogFilters {
  q?: string;
  categorySlug?: string;
  brand?: string;
  model?: string;
  year?: number;
  line?: MotorcycleLine;
  inStockOnly?: boolean;
  sort: CatalogSort;
  page: number;
  limit: number;
}

export interface CompatibilityEntry {
  brand: string;
  model: string;
  line: MotorcycleLine;
  yearFrom: number | null;
  yearTo: number | null;
  fitmentNotes: string | null;
}

export interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  slug: string;
  priceClp: number;
  stock: number;
  lowStockThreshold: number;
  stockStatus: StockStatus;
  saleMode: SaleMode;
  condition: ProductCondition;
  category: string | null;
  categorySlug: string | null;
  /** Línea de la moto a la que pertenece: se deduce de sus compatibilidades. */
  line: MotorcycleLine | null;
  oemPartNumber: string | null;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  isFeatured: boolean;
  isUniversal: boolean;
  isActive: boolean;
  compatibility: CompatibilityEntry[];
}

export interface MotorcycleModelEntry {
  model: string;
  line: MotorcycleLine;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface MotorcycleBrandEntry {
  brand: string;
  models: MotorcycleModelEntry[];
}

export interface ShippingRateEntry {
  id: number;
  regionCode: string;
  regionName: string;
  baseCostClp: number;
  isPayableOnDelivery: boolean;
  estimatedDays: string;
  courierName: string;
  isActive: boolean;
}

export interface StockAlertInput {
  productId: number;
  customerName: string;
  customerContact: string;
}

/** Orden de prioridad para mostrar la línea de un producto en la tarjeta. */
const LINE_PRIORITY: readonly MotorcycleLine[] = ['XR_CLASSIC', 'ENDURO', 'MULTI', 'CROSS'];

/**
 * Orden de prioridad de marcas para el selector "¿Qué moto tienes?" (H-13):
 * destaca primero Honda (línea clásica XR) y las marcas principales de Enduro.
 */
const BRAND_PRIORITY: readonly string[] = [
  'Honda',
  'KTM',
  'Yamaha',
  'Husqvarna',
  'Suzuki',
  'Kawasaki',
  'Beta',
  'GasGas',
];

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  slug: string;
  priceClp: number;
  stock: number;
  lowStockThreshold: number;
  saleMode: SaleMode;
  condition: ProductCondition;
  description: string | null;
  oemPartNumber: string | null;
  isFeatured: boolean;
  isUniversal: boolean;
  isActive: boolean;
  categoryName: string | null;
  categorySlug: string | null;
};

/** Opciones de lectura: permiten devolver las fotos con URL absoluta. */
export interface CatalogReadOptions {
  /** Origen público del Worker (ej. `https://api.aldosmotos.cl`). Se antepone a las rutas de R2. */
  mediaBaseUrl?: string;
}

/** Columnas comunes del listado y del detalle. */
export const productColumns = {
  id: products.id,
  sku: products.sku,
  name: products.name,
  slug: products.slug,
  priceClp: products.priceClp,
  stock: products.stock,
  lowStockThreshold: products.lowStockThreshold,
  saleMode: products.saleMode,
  condition: products.condition,
  description: products.description,
  oemPartNumber: products.oemPartNumber,
  isFeatured: products.isFeatured,
  isUniversal: products.isUniversal,
  isActive: products.isActive,
  categoryName: categories.name,
  categorySlug: categories.slug,
};

function stockStatusOf(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return 'OUT_OF_STOCK';
  return stock <= threshold ? 'LOW_STOCK' : 'IN_STOCK';
}

/**
 * Convierte el texto buscado en un patrón `LIKE`, sin acentos y en minúsculas
 * (el cliente suele escribir "piston" o "suspension", sin tildes).
 * Se quitan `%`, `_` y `\` para que no se puedan inyectar comodines.
 */
export function likePattern(value: string): string {
  const normalized = normalizeText(value).replace(/[%_\\]/g, ' ').trim();
  return `%${normalized}%`;
}

/** Mapa de acentos a su letra base (SQLite no trae `lower()`/`unaccent` para estos). */
const ACCENT_MAP: ReadonlyArray<readonly [string, string]> = [
  ['á', 'a'],
  ['é', 'e'],
  ['í', 'i'],
  ['ó', 'o'],
  ['ú', 'u'],
  ['ü', 'u'],
  ['ñ', 'n'],
  ['Á', 'a'],
  ['É', 'e'],
  ['Í', 'i'],
  ['Ó', 'o'],
  ['Ú', 'u'],
  ['Ü', 'u'],
  ['Ñ', 'n'],
];

/** Normaliza un texto en JavaScript (mismo criterio que `normalizeColumn` en SQL). */
function normalizeText(value: string): string {
  let normalized = value.toLowerCase();
  for (const [from, to] of ACCENT_MAP) normalized = normalized.split(from).join(to);
  return normalized;
}

/**
 * Aplica `lower()` + reemplazo de acentos a una columna, para poder comparar
 * contra el patrón normalizado. `lower()` de SQLite solo cubre ASCII, así que
 * igual hay que reemplazar las vocales acentuadas en mayúscula.
 */
export function normalizeColumn(column: SQLiteColumn): SQL {
  let expression = sql`lower(${column})`;
  for (const [from, to] of ACCENT_MAP) {
    expression = sql`replace(${expression}, ${from}, ${to})`;
  }
  return expression;
}

function lineOf(compatibility: CompatibilityEntry[], isUniversal: boolean): MotorcycleLine | null {
  const lines = new Set(compatibility.map((entry) => entry.line));
  for (const candidate of LINE_PRIORITY) {
    if (lines.has(candidate)) return candidate;
  }
  return isUniversal ? 'MULTI' : null;
}

/** Carga imágenes y compatibilidades de un conjunto de productos (sin N+1). */
export async function enrichProducts(
  db: Database,
  rows: ProductRow[],
  options: CatalogReadOptions = {},
): Promise<CatalogProduct[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const base = (options.mediaBaseUrl ?? '').replace(/\/+$/, '');

  const compatibilityRows = await db
    .select({
      productId: productCompatibility.productId,
      brand: motorcycles.brand,
      model: motorcycles.model,
      line: motorcycles.line,
      yearFrom: sql<
        number | null
      >`coalesce(${productCompatibility.yearFromOverride}, ${motorcycles.yearFrom})`,
      yearTo: sql<
        number | null
      >`coalesce(${productCompatibility.yearToOverride}, ${motorcycles.yearTo})`,
      fitmentNotes: productCompatibility.fitmentNotes,
    })
    .from(productCompatibility)
    .innerJoin(motorcycles, eq(motorcycles.id, productCompatibility.motorcycleId))
    .where(inArray(productCompatibility.productId, ids))
    .orderBy(asc(motorcycles.brand), asc(motorcycles.model));

  const imageRows = await db
    .select({
      productId: productImages.productId,
      url: productImages.url,
    })
    .from(productImages)
    .where(inArray(productImages.productId, ids))
    .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.id));

  const compatibilityByProduct = new Map<number, CompatibilityEntry[]>();
  for (const row of compatibilityRows) {
    const list = compatibilityByProduct.get(row.productId) ?? [];
    list.push({
      brand: row.brand,
      model: row.model,
      line: row.line,
      yearFrom: row.yearFrom,
      yearTo: row.yearTo,
      fitmentNotes: row.fitmentNotes,
    });
    compatibilityByProduct.set(row.productId, list);
  }

  const imagesByProduct = new Map<number, string[]>();
  for (const row of imageRows) {
    const list = imagesByProduct.get(row.productId) ?? [];
    list.push(row.url.startsWith('/') ? `${base}${row.url}` : row.url);
    imagesByProduct.set(row.productId, list);
  }

  return rows.map((row) => {
    const compatibility = compatibilityByProduct.get(row.id) ?? [];
    const images = imagesByProduct.get(row.id) ?? [];

    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      priceClp: row.priceClp,
      stock: row.stock,
      lowStockThreshold: row.lowStockThreshold,
      stockStatus: stockStatusOf(row.stock, row.lowStockThreshold),
      saleMode: row.saleMode,
      condition: row.condition,
      category: row.categoryName,
      categorySlug: row.categorySlug,
      line: lineOf(compatibility, row.isUniversal),
      oemPartNumber: row.oemPartNumber,
      description: row.description,
      imageUrl: images[0] ?? null,
      images,
      isFeatured: row.isFeatured,
      isUniversal: row.isUniversal,
      isActive: row.isActive,
      compatibility,
    };
  });
}

/**
 * Lista el catálogo público con filtros combinables.
 * Solo devuelve productos activos; el filtro por moto incluye los universales.
 */
export async function listCatalogProducts(
  db: Database,
  filters: CatalogFilters,
  options: CatalogReadOptions = {},
): Promise<{ items: CatalogProduct[]; total: number }> {
  const conditions = [eq(products.isActive, true)];

  if (filters.q) {
    const pattern = likePattern(filters.q);
    const search = or(
      like(normalizeColumn(products.name), pattern),
      like(normalizeColumn(products.sku), pattern),
      like(normalizeColumn(products.oemPartNumber), pattern),
    );
    if (search) conditions.push(search);
  }

  if (filters.categorySlug) {
    conditions.push(eq(categories.slug, filters.categorySlug));
  }

  if (filters.inStockOnly) {
    conditions.push(gt(products.stock, 0));
  }

  // Filtro por moto: existe una compatibilidad que calza, o el producto es universal.
  const bikeConditions = [];
  if (filters.brand) bikeConditions.push(eq(motorcycles.brand, filters.brand));
  if (filters.model) bikeConditions.push(eq(motorcycles.model, filters.model));
  if (filters.line) bikeConditions.push(eq(motorcycles.line, filters.line));
  if (filters.year !== undefined) {
    const from = or(isNull(motorcycles.yearFrom), lte(motorcycles.yearFrom, filters.year));
    const to = or(isNull(motorcycles.yearTo), gte(motorcycles.yearTo, filters.year));
    if (from) bikeConditions.push(from);
    if (to) bikeConditions.push(to);
  }

  if (bikeConditions.length > 0) {
    const compatible = exists(
      db
        .select({ one: sql`1` })
        .from(productCompatibility)
        .innerJoin(motorcycles, eq(motorcycles.id, productCompatibility.motorcycleId))
        .where(and(eq(productCompatibility.productId, products.id), ...bikeConditions)),
    );

    const byBike = or(compatible, eq(products.isUniversal, true));
    if (byBike) conditions.push(byBike);
  }

  const where = and(...conditions);

  const orderBy =
    filters.sort === 'price_asc'
      ? [asc(products.priceClp), asc(products.name)]
      : filters.sort === 'price_desc'
        ? [desc(products.priceClp), asc(products.name)]
        : [desc(products.createdAt), desc(products.id)];

  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(...orderBy)
    .limit(filters.limit)
    .offset((filters.page - 1) * filters.limit);

  const [counted] = await db
    .select({ total: sql<number>`count(*)` })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where);

  return { items: await enrichProducts(db, rows, options), total: counted?.total ?? 0 };
}

/** Detalle público de un producto por su slug (RNF-08). Devuelve `null` si no existe o está oculto. */
export async function getCatalogProductBySlug(
  db: Database,
  slug: string,
  options: CatalogReadOptions = {},
): Promise<CatalogProduct | null> {
  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.isActive, true)))
    .limit(1);

  const [enriched] = await enrichProducts(db, rows, options);
  return enriched ?? null;
}

/** Árbol Marca → Modelos → rango de años para el selector "¿Qué moto tienes?" (HU-01). */
export async function listMotorcycleTree(db: Database): Promise<MotorcycleBrandEntry[]> {
  const rows = await db
    .select({
      brand: motorcycles.brand,
      model: motorcycles.model,
      line: motorcycles.line,
      yearFrom: motorcycles.yearFrom,
      yearTo: motorcycles.yearTo,
    })
    .from(motorcycles)
    .orderBy(asc(motorcycles.brand), asc(motorcycles.model));

  const brands = new Map<string, MotorcycleModelEntry[]>();
  for (const row of rows) {
    const models = brands.get(row.brand) ?? [];
    models.push({
      model: row.model,
      line: row.line,
      yearFrom: row.yearFrom,
      yearTo: row.yearTo,
    });
    brands.set(row.brand, models);
  }

  return [...brands.entries()]
    .map(([brand, models]) => ({ brand, models }))
    .sort((a, b) => {
      const idxA = BRAND_PRIORITY.findIndex((p) => p.toLowerCase() === a.brand.toLowerCase());
      const idxB = BRAND_PRIORITY.findIndex((p) => p.toLowerCase() === b.brand.toLowerCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.brand.localeCompare(b.brand, 'es');
    });
}

/** Regiones y tarifas de envío activas (RF-10). */
export async function listShippingRates(db: Database): Promise<ShippingRateEntry[]> {
  return db
    .select({
      id: shippingRates.id,
      regionCode: shippingRates.regionCode,
      regionName: shippingRates.regionName,
      baseCostClp: shippingRates.baseCostClp,
      isPayableOnDelivery: shippingRates.isPayableOnDelivery,
      estimatedDays: shippingRates.estimatedDays,
      courierName: shippingRates.courierName,
      isActive: shippingRates.isActive,
    })
    .from(shippingRates)
    .where(eq(shippingRates.isActive, true))
    .orderBy(asc(shippingRates.id));
}

/** `true` si el producto existe y está visible en la tienda. */
export async function productIsVisible(db: Database, productId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.isActive, true)))
    .limit(1);

  return row !== undefined;
}

/** Registra el aviso "avisarme cuando llegue" de un repuesto agotado (R-03). */
export async function createStockAlert(db: Database, input: StockAlertInput): Promise<number> {
  const [created] = await db
    .insert(stockAlerts)
    .values({
      productId: input.productId,
      customerName: input.customerName,
      customerContact: input.customerContact,
    })
    .returning({ id: stockAlerts.id });

  return created?.id ?? 0;
}
