import { and, asc, eq, exists, gt, gte, inArray, like, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../db';
import {
  categories,
  motorcycles,
  productCompatibility,
  productImages,
  products,
  type MotorcycleLine,
} from '../db/schema';
import { AppError } from '../middlewares/error.middleware';
import { buildProductSlug, normalizeText } from '../utils/slug';
import {
  enrichProducts,
  likePattern,
  normalizeColumn,
  productColumns,
  type CatalogProduct,
} from './catalog.service';
import type {
  AdminProductQuery,
  BatchImportRow,
  MotorcycleCreateInput,
  MotorcycleUpdateInput,
  ProductCreateInput,
  ProductQuickUpdateInput,
  ProductUpdateInput,
} from '../validators/product.schema';

/**
 * Gestión del inventario desde el panel de Estrella (RF-07, HU-04).
 *
 * Aquí vive todo lo que escribe productos y compatibilidades. El descuento atómico
 * de stock del checkout y la reversión al cancelar se agregan en los Pasos 10 y 12.
 */

/** Entrada de compatibilidad aceptada por la API (por id o por marca+modelo). */
type CompatibilityInput = NonNullable<ProductCreateInput['compatibility']>[number];

/** Motos que el panel pidió asociar pero que no existen en el mantenedor. */
export interface CompatibilityWarning {
  brand: string;
  model: string;
  message: string;
}

export interface ProductWriteResult {
  product: CatalogProduct | null;
  warnings: CompatibilityWarning[];
}

function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).includes('UNIQUE');
}

/** Concatena los mensajes de la cadena de errores (Drizzle envuelve el error de SQLite en `cause`). */
function errorChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (current === undefined || current === null) break;
    messages.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? (current as { cause?: unknown }).cause : undefined;
  }

  return messages.join(' | ');
}

/**
 * Traduce una violación de unicidad al mensaje que Estrella necesita leer.
 * Devuelve `null` si el error no es por un dato repetido.
 */
function describeDuplicateError(error: unknown, entity: 'product' | 'motorcycle'): AppError | null {
  if (!isUniqueViolation(error)) return null;

  const detail = errorChain(error);

  if (entity === 'product') {
    if (detail.includes('products.sku')) {
      return new AppError(
        'SKU_ALREADY_EXISTS',
        'Ya tienes un repuesto con ese SKU. El SKU no se puede repetir: revisa la planilla y vuelve a intentarlo.',
        409,
      );
    }
    if (detail.includes('products.slug')) {
      return new AppError(
        'SLUG_ALREADY_EXISTS',
        'Ya existe un repuesto con ese enlace. Cambia el nombre o el enlace del producto.',
        409,
      );
    }
  }

  if (entity === 'motorcycle') {
    return new AppError(
      'MOTORCYCLE_ALREADY_EXISTS',
      'Esa moto ya está registrada en el mantenedor.',
      409,
    );
  }

  return new AppError('ALREADY_EXISTS', 'Ese dato ya está registrado. Revisa la información.', 409);
}

/** Traduce una categoría (id o slug) al `category_id` que se guarda. */
async function resolveCategoryId(
  db: Database,
  input: { categoryId?: number; categorySlug?: string },
): Promise<number | null> {
  if (input.categoryId !== undefined) {
    const [found] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1);

    if (!found) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría elegida no existe.', 400);
    }
    return found.id;
  }

  if (input.categorySlug !== undefined) {
    const [found] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, input.categorySlug))
      .limit(1);

    if (!found) {
      throw new AppError('CATEGORY_NOT_FOUND', 'La categoría elegida no existe.', 400);
    }
    return found.id;
  }

  return null;
}

/**
 * Reemplaza las motos compatibles de un producto.
 *
 * Las motos se buscan en el mantenedor (`motorcycles`); si una marca+modelo no existe,
 * **no se crea automáticamente** (para no llenar el catálogo con errores de tipeo):
 * se omite y se devuelve una advertencia para que Estrella la agregue en "Motos compatibles".
 */
async function replaceCompatibility(
  db: Database,
  productId: number,
  entries: CompatibilityInput[],
): Promise<CompatibilityWarning[]> {
  const warnings: CompatibilityWarning[] = [];

  await db.delete(productCompatibility).where(eq(productCompatibility.productId, productId));

  const values: Array<{
    productId: number;
    motorcycleId: number;
    yearFromOverride: number | null;
    yearToOverride: number | null;
    fitmentNotes: string | null;
  }> = [];

  for (const entry of entries) {
    let motorcycleId = entry.motorcycleId ?? null;

    if (motorcycleId === null && entry.brand !== undefined && entry.model !== undefined) {
      const [found] = await db
        .select({ id: motorcycles.id })
        .from(motorcycles)
        .where(and(eq(motorcycles.brand, entry.brand), eq(motorcycles.model, entry.model)))
        .limit(1);

      motorcycleId = found?.id ?? null;

      if (motorcycleId === null) {
        warnings.push({
          brand: entry.brand,
          model: entry.model,
          message: `No teníamos registrada la moto ${entry.brand} ${entry.model}. Agrégala en "Motos compatibles" para asociarla.`,
        });
      }
    }

    if (motorcycleId === null) {
      if (entry.motorcycleId !== undefined) {
        warnings.push({
          brand: '',
          model: '',
          message: `La moto con identificador ${entry.motorcycleId} no existe.`,
        });
      }
      continue;
    }

    values.push({
      productId,
      motorcycleId,
      yearFromOverride: entry.yearFromOverride ?? entry.yearFrom ?? null,
      yearToOverride: entry.yearToOverride ?? entry.yearTo ?? null,
      fitmentNotes: entry.fitmentNotes ?? null,
    });
  }

  if (values.length > 0) {
    await db.insert(productCompatibility).values(values);
  }

  return warnings;
}

/** Lee un producto por id ya enriquecido (categoría, fotos y compatibilidades). */
export async function getAdminProductById(
  db: Database,
  id: number,
  options: { mediaBaseUrl?: string } = {},
): Promise<CatalogProduct | null> {
  const rows = await db
    .select(productColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, id))
    .limit(1);

  const [enriched] = await enrichProducts(db, rows, options);
  return enriched ?? null;
}

/**
 * Listado completo del inventario para el panel, con los filtros rápidos de Estrella.
 * Devuelve un arreglo porque así lo consume el frontend.
 */
export async function listAdminProducts(
  db: Database,
  filters: AdminProductQuery,
  options: { mediaBaseUrl?: string } = {},
): Promise<CatalogProduct[]> {
  const conditions = [];

  if (filters.q) {
    const pattern = likePattern(filters.q);
    const search = or(
      like(normalizeColumn(products.name), pattern),
      like(normalizeColumn(products.sku), pattern),
      like(normalizeColumn(products.oemPartNumber), pattern),
    );
    if (search) conditions.push(search);
  }

  if (filters.category) conditions.push(eq(categories.slug, filters.category));
  if (filters.saleMode) conditions.push(eq(products.saleMode, filters.saleMode));
  if (filters.condition) conditions.push(eq(products.condition, filters.condition));
  if (filters.isActive !== undefined) conditions.push(eq(products.isActive, filters.isActive));
  if (filters.isUniversal !== undefined) {
    conditions.push(eq(products.isUniversal, filters.isUniversal));
  }

  if (filters.outOfStock) {
    conditions.push(lte(products.stock, 0));
  } else if (filters.lowStock) {
    // Bajo stock: queda poco y todavía hay algo.
    conditions.push(gt(products.stock, 0));
    conditions.push(lte(products.stock, products.lowStockThreshold));
  }

  if (filters.withoutImage) {
    const hasImage = exists(
      db
        .select({ one: sql`1` })
        .from(productImages)
        .where(eq(productImages.productId, products.id)),
    );
    const noImage = sql`not ${hasImage}`;
    conditions.push(noImage);
  }

  const query = db
    .select(productColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(products.stock), asc(products.name));

  const rows = filters.limit === undefined ? await query : await query.limit(filters.limit);

  return enrichProducts(db, rows, options);
}

/** Crea un producto con sus motos compatibles. */
export async function createProduct(
  db: Database,
  input: ProductCreateInput,
): Promise<{ id: number; warnings: CompatibilityWarning[] }> {
  const slug = input.slug?.trim() || buildProductSlug(input.sku, input.name);

  let created: { id: number } | undefined;
  try {
    [created] = await db
      .insert(products)
      .values({
        sku: input.sku,
        name: input.name,
        slug,
        categoryId: await resolveCategoryId(db, input),
        description: input.description ?? null,
        oemPartNumber: input.oemPartNumber ?? null,
        priceClp: input.priceClp,
        stock: input.stock,
        lowStockThreshold: input.lowStockThreshold ?? 1,
        saleMode: input.saleMode ?? 'DIRECT',
        condition: input.condition ?? 'NEW',
        isUniversal: input.isUniversal ?? false,
        weightGrams: input.weightGrams ?? 500,
        isFeatured: input.isFeatured ?? false,
        isActive: input.isActive ?? true,
      })
      .returning({ id: products.id });
  } catch (error) {
    const duplicate = describeDuplicateError(error, 'product');
    if (duplicate) throw duplicate;
    throw error;
  }

  if (!created) {
    throw new AppError(
      'PRODUCT_CREATE_FAILED',
      'No pudimos guardar el repuesto. Intenta nuevamente.',
      500,
    );
  }

  const warnings =
    input.compatibility && input.compatibility.length > 0
      ? await replaceCompatibility(db, created.id, input.compatibility)
      : [];

  return { id: created.id, warnings };
}

/** Actualiza un producto. Solo se tocan los campos que llegan en el cuerpo. */
export async function updateProduct(
  db: Database,
  id: number,
  input: ProductUpdateInput,
): Promise<{ warnings: CompatibilityWarning[] }> {
  const [existing] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);

  if (!existing) {
    throw new AppError('PRODUCT_NOT_FOUND', 'No encontramos ese repuesto.', 404);
  }

  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.sku !== undefined) changes['sku'] = input.sku;
  if (input.name !== undefined) changes['name'] = input.name;
  if (input.slug !== undefined) changes['slug'] = input.slug;
  if (input.description !== undefined) changes['description'] = input.description;
  if (input.oemPartNumber !== undefined) changes['oemPartNumber'] = input.oemPartNumber;
  if (input.priceClp !== undefined) changes['priceClp'] = input.priceClp;
  if (input.stock !== undefined) changes['stock'] = input.stock;
  if (input.lowStockThreshold !== undefined) changes['lowStockThreshold'] = input.lowStockThreshold;
  if (input.saleMode !== undefined) changes['saleMode'] = input.saleMode;
  if (input.condition !== undefined) changes['condition'] = input.condition;
  if (input.isUniversal !== undefined) changes['isUniversal'] = input.isUniversal;
  if (input.weightGrams !== undefined) changes['weightGrams'] = input.weightGrams;
  if (input.isFeatured !== undefined) changes['isFeatured'] = input.isFeatured;
  if (input.isActive !== undefined) changes['isActive'] = input.isActive;

  if (input.categoryId !== undefined || input.categorySlug !== undefined) {
    changes['categoryId'] = await resolveCategoryId(db, input);
  }

  try {
    await db.update(products).set(changes).where(eq(products.id, id));
  } catch (error) {
    const duplicate = describeDuplicateError(error, 'product');
    if (duplicate) throw duplicate;
    throw error;
  }

  const warnings = input.compatibility ? await replaceCompatibility(db, id, input.compatibility) : [];

  return { warnings };
}

/** Edición rápida de una celda de la tabla de inventario (precio, stock, modo, visibilidad). */
export async function quickUpdateProduct(
  db: Database,
  id: number,
  input: ProductQuickUpdateInput,
): Promise<void> {
  const changes: Record<string, unknown> = { updatedAt: new Date() };

  if (input.priceClp !== undefined) changes['priceClp'] = input.priceClp;
  if (input.stock !== undefined) changes['stock'] = input.stock;
  if (input.lowStockThreshold !== undefined) changes['lowStockThreshold'] = input.lowStockThreshold;
  if (input.saleMode !== undefined) changes['saleMode'] = input.saleMode;
  if (input.isActive !== undefined) changes['isActive'] = input.isActive;

  const updated = await db
    .update(products)
    .set(changes)
    .where(eq(products.id, id))
    .returning({ id: products.id });

  if (updated.length === 0) {
    throw new AppError('PRODUCT_NOT_FOUND', 'No encontramos ese repuesto.', 404);
  }
}

// ---------------------------------------------------------------------------
// Mantenedor de motos compatibles (HU-01)
// ---------------------------------------------------------------------------

export interface AdminMotorcycle {
  id: number;
  brand: string;
  model: string;
  line: MotorcycleLine;
  yearFrom: number | null;
  yearTo: number | null;
}

export async function listAdminMotorcycles(db: Database): Promise<AdminMotorcycle[]> {
  return db
    .select({
      id: motorcycles.id,
      brand: motorcycles.brand,
      model: motorcycles.model,
      line: motorcycles.line,
      yearFrom: motorcycles.yearFrom,
      yearTo: motorcycles.yearTo,
    })
    .from(motorcycles)
    .orderBy(asc(motorcycles.brand), asc(motorcycles.model));
}

export async function createMotorcycle(
  db: Database,
  input: MotorcycleCreateInput,
): Promise<{ id: number }> {
  const [duplicated] = await db
    .select({ id: motorcycles.id })
    .from(motorcycles)
    .where(and(eq(motorcycles.brand, input.brand), eq(motorcycles.model, input.model)))
    .limit(1);

  if (duplicated) {
    throw new AppError(
      'MOTORCYCLE_ALREADY_EXISTS',
      `La moto ${input.brand} ${input.model} ya está registrada.`,
      409,
    );
  }

  try {
    const [created] = await db
      .insert(motorcycles)
      .values({
        brand: input.brand,
        model: input.model,
        line: input.line,
        yearFrom: input.yearFrom ?? null,
        yearTo: input.yearTo ?? null,
      })
      .returning({ id: motorcycles.id });

    return { id: created?.id ?? 0 };
  } catch (error) {
    const duplicate = describeDuplicateError(error, 'motorcycle');
    if (duplicate) throw duplicate;
    throw error;
  }
}

export async function updateMotorcycle(
  db: Database,
  id: number,
  input: MotorcycleUpdateInput,
): Promise<void> {
  const changes: Record<string, unknown> = {};

  if (input.brand !== undefined) changes['brand'] = input.brand;
  if (input.model !== undefined) changes['model'] = input.model;
  if (input.line !== undefined) changes['line'] = input.line;
  if (input.yearFrom !== undefined) changes['yearFrom'] = input.yearFrom;
  if (input.yearTo !== undefined) changes['yearTo'] = input.yearTo;

  if (Object.keys(changes).length === 0) {
    throw new AppError('NO_CHANGES', 'No hay cambios para guardar.', 400);
  }

  const updated = await db
    .update(motorcycles)
    .set(changes)
    .where(eq(motorcycles.id, id))
    .returning({ id: motorcycles.id });

  if (updated.length === 0) {
    throw new AppError('MOTORCYCLE_NOT_FOUND', 'No encontramos esa moto.', 404);
  }
}

/** Elimina una moto del mantenedor (también se quita de los productos compatibles). */
export async function deleteMotorcycle(db: Database, id: number): Promise<void> {
  const deleted = await db.delete(motorcycles).where(eq(motorcycles.id, id)).returning({
    id: motorcycles.id,
  });

  if (deleted.length === 0) {
    throw new AppError('MOTORCYCLE_NOT_FOUND', 'No encontramos esa moto.', 404);
  }
}

/** Traduce un texto de moto (`"Honda:XR 250 Tornado"`, `"Honda XR 400R"`, `"XR 400R"`) a un id. */
function resolveMotorcycleId(bikes: AdminMotorcycle[], token: string): number | null {
  const parts = token.split(':');
  const rawBrand = parts.length > 1 ? normalizeText(parts[0] ?? '') : '';
  const rawModel = normalizeText(parts.length > 1 ? (parts[1] ?? '') : token);

  if (rawModel.length === 0) return null;

  const exact = bikes.find(
    (bike) =>
      normalizeText(bike.model) === rawModel &&
      (rawBrand.length === 0 || normalizeText(bike.brand) === rawBrand),
  );
  if (exact) return exact.id;

  // Segundo intento: el nombre completo ("Honda XR 250 Tornado") tal cual.
  const full = bikes.find(
    (bike) => normalizeText(`${bike.brand} ${bike.model}`) === normalizeText(token.replace(':', ' ')),
  );

  return full?.id ?? null;
}

/** Descripción breve de un error de base de datos, para el reporte del lote. */
function describeDbError(error: unknown): string {
  const chain = errorChain(error);
  if (chain.includes('UNIQUE') && chain.includes('products.sku')) return 'El SKU ya existe.';
  if (chain.includes('UNIQUE')) return 'Hay un dato repetido.';
  if (chain.includes('NOT NULL')) return 'Falta un dato obligatorio.';
  return 'No se pudo guardar la fila.';
}

/** Agrupa un arreglo en bloques del tamaño indicado. */
function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * D1 rechaza las sentencias con demasiados parámetros ligados
 * (`D1_ERROR: too many SQL variables`), así que nunca se inserta "todo de una".
 * Se deja un margen bajo el límite para no depender del valor exacto de la plataforma.
 */
const MAX_BOUND_PARAMS_PER_STATEMENT = 90;

/** Divide las filas en tandas que quepan en una sola sentencia según sus columnas. */
function chunkRowsByParams<T>(rows: readonly T[], paramsPerRow: number): T[][] {
  const safeParams = Math.max(1, paramsPerRow);
  const rowsPerStatement = Math.max(1, Math.floor(MAX_BOUND_PARAMS_PER_STATEMENT / safeParams));
  return chunkArray(rows, rowsPerStatement);
}

/** Columnas ligadas por fila en el insert de compatibilidades. */
const COMPATIBILITY_PARAMS_PER_ROW = 5;

export interface BatchReportEntry {
  /** Posición de la fila dentro del lote enviado (1 = primera fila). */
  row: number;
  sku?: string;
  message: string;
}

export interface BatchImportReport {
  created: number;
  updated: number;
  errors: BatchReportEntry[];
  warnings: BatchReportEntry[];
}

interface PreparedRow {
  position: number;
  row: BatchImportRow;
  categoryId: number | null;
  motorcycleIds: number[];
}

/** Fila lista para importar, con su posición original en la planilla (1 = primera fila). */
export interface BatchImportItem {
  position: number;
  row: BatchImportRow;
}

/**
 * Importación masiva tipo Excel (RF-07 / R-02): crea o actualiza por `sku` en bloques
 * de hasta 100 productos, dentro de transacciones (`db.batch`) para no dejar el catálogo
 * a medias. Es idempotente: volver a subir la misma planilla no duplica nada.
 */
export async function batchUpsertProducts(
  db: Database,
  items: BatchImportItem[],
  options: { chunkSize?: number } = {},
): Promise<BatchImportReport> {
  const chunkSize = options.chunkSize ?? 100;
  const report: BatchImportReport = { created: 0, updated: 0, errors: [], warnings: [] };

  if (items.length === 0) return report;

  const categoryRows = await db
    .select({ id: categories.id, slug: categories.slug, name: categories.name })
    .from(categories);
  const categoryIndex = new Map<string, number>();
  for (const category of categoryRows) {
    categoryIndex.set(normalizeText(category.slug), category.id);
    categoryIndex.set(normalizeText(category.name), category.id);
  }

  const bikes = await listAdminMotorcycles(db);

  const prepared: PreparedRow[] = [];
  for (const { position, row } of items) {
    let categoryId: number | null = null;
    if (row.category && row.category.length > 0) {
      const found = categoryIndex.get(normalizeText(row.category));
      if (found === undefined) {
        report.warnings.push({
          row: position,
          sku: row.sku,
          message: `No teníamos la categoría "${row.category}": el repuesto quedó sin categoría.`,
        });
      } else {
        categoryId = found;
      }
    }

    const motorcycleIds: number[] = [];
    for (const token of row.compatibility ?? []) {
      const motorcycleId = resolveMotorcycleId(bikes, token);
      if (motorcycleId === null) {
        report.warnings.push({
          row: position,
          sku: row.sku,
          message: `No teníamos registrada la moto "${token}". Agrégala en "Motos compatibles" y vuelve a subir la planilla.`,
        });
      } else if (!motorcycleIds.includes(motorcycleId)) {
        motorcycleIds.push(motorcycleId);
      }
    }

    prepared.push({ position, row, categoryId, motorcycleIds });
  }

  // ¿Cuáles SKU ya existen? Así el reporte distingue creados de actualizados.
  const existing = new Set<string>();
  for (const chunk of chunkArray(prepared, 80)) {
    const skus = chunk.map((item) => item.row.sku);
    const found = await db
      .select({ sku: products.sku })
      .from(products)
      .where(inArray(products.sku, skus));
    for (const row of found) existing.add(row.sku);
  }

  for (const chunk of chunkArray(prepared, chunkSize)) {
    const statements = chunk.map((item) => buildProductUpsert(db, item));

    const countIfFresh = (item: PreparedRow): void => {
      if (existing.has(item.row.sku)) report.updated += 1;
      else report.created += 1;
    };

    try {
      await db.batch(statements as unknown as [any, ...any[]]);
      for (const item of chunk) countIfFresh(item);
    } catch {
      // Un bloque falló: se reintenta fila por fila para decir exactamente cuál viene mala.
      for (const item of chunk) {
        try {
          await buildProductUpsert(db, item);
          countIfFresh(item);
        } catch (error) {
          report.errors.push({
            row: item.position,
            sku: item.row.sku,
            message: describeDbError(error),
          });
        }
      }
    }

    // Compatibilidades del bloque (se reemplazan completas para esas filas).
    const skus = chunk.map((item) => item.row.sku);
    const idBySku = new Map<string, number>();

    for (const skuGroup of chunkArray(skus, 80)) {
      const savedProducts = await db
        .select({ id: products.id, sku: products.sku })
        .from(products)
        .where(inArray(products.sku, skuGroup));

      for (const row of savedProducts) idBySku.set(row.sku, row.id);
    }

    const compatibilityRows: Array<{
      productId: number;
      motorcycleId: number;
      yearFromOverride: null;
      yearToOverride: null;
      fitmentNotes: null;
    }> = [];
    const postStatements: unknown[] = [];

    for (const item of chunk) {
      const productId = idBySku.get(item.row.sku);
      if (productId === undefined) continue;

      postStatements.push(
        db.delete(productCompatibility).where(eq(productCompatibility.productId, productId)),
      );

      for (const motorcycleId of item.motorcycleIds) {
        compatibilityRows.push({
          productId,
          motorcycleId,
          yearFromOverride: null,
          yearToOverride: null,
          fitmentNotes: null,
        });
      }
    }

    for (const group of chunkRowsByParams(compatibilityRows, COMPATIBILITY_PARAMS_PER_ROW)) {
      postStatements.push(db.insert(productCompatibility).values(group));
    }

    if (postStatements.length > 0) {
      await db.batch(postStatements as unknown as [any, ...any[]]);
    }
  }

  return report;
}

/** Consulta de `INSERT ... ON CONFLICT(sku) DO UPDATE` de una fila de planilla. */
function buildProductUpsert(db: Database, item: PreparedRow) {
  const { row, categoryId } = item;
  const values = {
    sku: row.sku,
    name: row.name,
    slug: buildProductSlug(row.sku, row.name),
    categoryId,
    oemPartNumber: row.oemPartNumber ?? null,
    priceClp: row.priceClp,
    stock: row.stock,
    saleMode: row.saleMode,
    condition: row.condition,
    isActive: row.isActive,
    updatedAt: new Date(),
  };

  return db
    .insert(products)
    .values(values)
    .onConflictDoUpdate({
      target: products.sku,
      set: {
        name: values.name,
        categoryId: values.categoryId,
        oemPartNumber: values.oemPartNumber,
        priceClp: values.priceClp,
        stock: values.stock,
        saleMode: values.saleMode,
        condition: values.condition,
        isActive: values.isActive,
        updatedAt: values.updatedAt,
      },
    });
}

/**
 * Exporta el catálogo completo en el **mismo formato que acepta la importación**,
 * para que Estrella pueda descargar, editar y volver a subir sin perder información.
 */
export async function exportCatalogRows(db: Database): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      categoryName: categories.name,
      priceClp: products.priceClp,
      stock: products.stock,
      saleMode: products.saleMode,
      condition: products.condition,
      oemPartNumber: products.oemPartNumber,
      isActive: products.isActive,
    })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(asc(products.sku));

  const compatibilityByProduct = await loadCompatibilityTokens(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.categoryName ?? '',
    priceClp: row.priceClp,
    stock: row.stock,
    saleMode: row.saleMode,
    condition: row.condition,
    oemPartNumber: row.oemPartNumber,
    compatibility: compatibilityByProduct.get(row.id) ?? [],
    isActive: row.isActive,
  }));
}

/** Motos compatibles por producto, en el formato `Marca:Modelo` que usa la planilla. */
async function loadCompatibilityTokens(
  db: Database,
  productIds: number[],
): Promise<Map<number, string[]>> {
  const result = new Map<number, string[]>();

  for (const chunk of chunkArray(productIds, 80)) {
    const rows = await db
      .select({
        productId: productCompatibility.productId,
        brand: motorcycles.brand,
        model: motorcycles.model,
      })
      .from(productCompatibility)
      .innerJoin(motorcycles, eq(motorcycles.id, productCompatibility.motorcycleId))
      .where(inArray(productCompatibility.productId, chunk))
      .orderBy(asc(motorcycles.brand), asc(motorcycles.model));

    for (const row of rows) {
      const list = result.get(row.productId) ?? [];
      list.push(`${row.brand}:${row.model}`);
      result.set(row.productId, list);
    }
  }

  return result;
}

/** Cuenta cuántos productos tiene asociados una moto (para avisar antes de borrarla). */
export async function countProductsForMotorcycle(db: Database, id: number): Promise<number> {
  const [counted] = await db
    .select({ total: sql<number>`count(*)` })
    .from(productCompatibility)
    .where(eq(productCompatibility.motorcycleId, id));

  return counted?.total ?? 0;
}

// ---------------------------------------------------------------------------
// Stock: descuento atómico y reversión (RF-05 / C-05)
// ---------------------------------------------------------------------------

export interface StockChangeResult {
  id: number;
  sku: string;
  stock: number;
}

/**
 * **Descuento atómico de stock** (RF-05 / restricción C-05).
 *
 * La condición `stock >= :cantidad` va dentro del propio `UPDATE`, así que es la base
 * de datos la que impide vender de más: si dos compras simultáneas piden el último
 * repuesto, solo una de las dos actualiza la fila. Devuelve `null` cuando no se pudo
 * descontar (no hay stock suficiente, el repuesto está oculto o es solo por WhatsApp).
 */
export async function decrementProductStock(
  db: Database,
  productId: number,
  quantity: number,
): Promise<StockChangeResult | null> {
  const updated = await db
    .update(products)
    .set({ stock: sql`${products.stock} - ${quantity}`, updatedAt: new Date() })
    .where(
      and(
        eq(products.id, productId),
        gte(products.stock, quantity),
        eq(products.isActive, true),
        eq(products.saleMode, 'DIRECT'),
      ),
    )
    .returning({ id: products.id, sku: products.sku, stock: products.stock });

  return updated[0] ?? null;
}

/**
 * Devuelve unidades al inventario. Se usa para compensar un checkout que falló a
 * medias y para revertir el stock cuando Estrella cancela un pedido (Paso 12).
 */
export async function restoreProductStock(
  db: Database,
  productId: number,
  quantity: number,
): Promise<void> {
  await db
    .update(products)
    .set({ stock: sql`${products.stock} + ${quantity}`, updatedAt: new Date() })
    .where(eq(products.id, productId));
}

/** Datos mínimos de un producto para armar un pedido. */
export interface OrderableProduct {
  id: number;
  sku: string;
  name: string;
  priceClp: number;
  stock: number;
  isActive: boolean;
  saleMode: string;
}

/** Carga los productos de un carrito (una sola consulta). */
export async function loadOrderableProducts(
  db: Database,
  productIds: number[],
): Promise<OrderableProduct[]> {
  if (productIds.length === 0) return [];

  const rows: OrderableProduct[] = [];
  for (const group of chunkRowsByParams(productIds, 1)) {
    const found = await db
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        priceClp: products.priceClp,
        stock: products.stock,
        isActive: products.isActive,
        saleMode: products.saleMode,
      })
      .from(products)
      .where(inArray(products.id, group));

    rows.push(...found);
  }

  return rows;
}

export type ReserveStockResult =
  | { ok: true }
  | { ok: false; productId: number; quantity: number; available: number };

/**
 * Reserva el stock de todas las líneas del carrito (RF-05).
 *
 * Recorre ítem por ítem con `decrementProductStock` (cada `UPDATE` es atómico y
 * condicional, así que dos compras simultáneas no pueden vender el mismo repuesto).
 * Si alguna línea queda corta, **devuelve al inventario lo ya descontado** y avisa
 * cuál falló y cuánto queda disponible.
 */
export async function reserveStockForItems(
  db: Database,
  lines: Array<{ productId: number; quantity: number }>,
): Promise<ReserveStockResult> {
  const discounted: Array<{ productId: number; quantity: number }> = [];

  for (const line of lines) {
    const updated = await decrementProductStock(db, line.productId, line.quantity);

    if (updated) {
      discounted.push({ productId: line.productId, quantity: line.quantity });
      continue;
    }

    // Compensación: se devuelve lo descontado antes de este ítem.
    for (const done of discounted.reverse()) {
      await restoreProductStock(db, done.productId, done.quantity);
    }

    const [current] = await loadOrderableProducts(db, [line.productId]);

    return {
      ok: false,
      productId: line.productId,
      quantity: line.quantity,
      available: current?.stock ?? 0,
    };
  }

  return { ok: true };
}
