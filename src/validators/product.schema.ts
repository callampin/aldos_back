import { z } from 'zod';

import { normalizeText } from '../utils/slug';

/**
 * Esquemas de validación de productos: filtros del catálogo público (RF-02)
 * y los formularios y la carga masiva del panel.
 */

/** Booleano aceptado en query string: `true` / `false` / `1` / `0`. */
const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** Query params del catálogo público. */
export const catalogQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  brand: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  line: z.enum(['XR_CLASSIC', 'ENDURO', 'CROSS', 'MULTI']).optional(),
  inStockOnly: queryBoolean.optional(),
  /** Alias que usa el frontend (`inStock`). */
  inStock: queryBoolean.optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

/** Identificador numérico de ruta (ej. `/products/:id/stock-alert`). */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Aviso "avisarme cuando llegue" (mitigación del riesgo R-03). */
export const stockAlertSchema = z.object({
  customerName: z
    .string('Escribe tu nombre.')
    .trim()
    .min(3, 'Escribe tu nombre.')
    .max(120, 'El nombre es demasiado largo.'),
  customerContact: z
    .string('Déjanos tu WhatsApp o tu correo para avisarte.')
    .trim()
    .min(5, 'Déjanos tu WhatsApp o tu correo para avisarte.')
    .max(160, 'El dato de contacto es demasiado largo.'),
});

export type StockAlertBody = z.infer<typeof stockAlertSchema>;

// ---------------------------------------------------------------------------
// Panel de administración — productos y motos compatibles (RF-07, HU-04)
// ---------------------------------------------------------------------------

const moneyField = z
  .number('El precio debe ser un número entero en pesos.')
  .int('El precio no puede tener decimales: son pesos chilenos.')
  .min(0, 'El precio no puede ser negativo.')
  .max(99_999_999, 'El precio es demasiado alto.');

const stockField = z
  .number('El stock debe ser un número entero.')
  .int('El stock no puede tener decimales.')
  .min(0, 'El stock no puede ser negativo.')
  .max(100_000, 'El stock es demasiado alto.');

const yearField = z.number().int().min(1900).max(2100);

/** Una moto compatible: se puede indicar por `motorcycleId` o por marca y modelo. */
export const compatibilityInputSchema = z
  .object({
    motorcycleId: z.number().int().positive().optional(),
    brand: z.string().trim().min(1).max(60).optional(),
    model: z.string().trim().min(1).max(80).optional(),
    yearFromOverride: yearField.nullable().optional(),
    yearToOverride: yearField.nullable().optional(),
    /** Alias que usa el frontend. */
    yearFrom: yearField.nullable().optional(),
    yearTo: yearField.nullable().optional(),
    fitmentNotes: z.string().trim().max(400).nullable().optional(),
  })
  .refine(
    (value) =>
      value.motorcycleId !== undefined || (value.brand !== undefined && value.model !== undefined),
    {
      message: 'Indica la moto compatible por su identificador o por marca y modelo.',
      path: ['motorcycleId'],
    },
  );

export const productCreateSchema = z.object({
  sku: z.string('El SKU es obligatorio.').trim().min(1, 'El SKU es obligatorio.').max(60),
  name: z
    .string('El nombre del repuesto es obligatorio.')
    .trim()
    .min(3, 'El nombre del repuesto es obligatorio.')
    .max(200, 'El nombre es demasiado largo.'),
  slug: z.string().trim().max(120).optional(),
  categoryId: z.number().int().positive().optional(),
  categorySlug: z.string().trim().max(60).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  oemPartNumber: z.string().trim().max(60).nullable().optional(),
  priceClp: moneyField,
  stock: stockField,
  lowStockThreshold: z.number().int().min(0).max(1000).optional(),
  saleMode: z.enum(['DIRECT', 'WHATSAPP_ONLY']).optional(),
  condition: z.enum(['NEW', 'USED']).optional(),
  isUniversal: z.boolean().optional(),
  weightGrams: z.number().int().min(0).max(200_000).nullable().optional(),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  compatibility: z.array(compatibilityInputSchema).max(60).optional(),
});

/** Edición completa: todos los campos son opcionales (solo se actualiza lo que llega). */
export const productUpdateSchema = productCreateSchema.partial();

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

/** Edición rápida en línea desde la tabla tipo Excel de Estrella (HU-04). */
export const productQuickUpdateSchema = z
  .object({
    priceClp: moneyField.optional(),
    stock: stockField.optional(),
    lowStockThreshold: z.number().int().min(0).max(1000).optional(),
    saleMode: z.enum(['DIRECT', 'WHATSAPP_ONLY']).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'No hay cambios para guardar.',
  });

export type ProductQuickUpdateInput = z.infer<typeof productQuickUpdateSchema>;

/** Filtros del listado del panel (bajo stock, agotados, sin foto, etc.). */
const queryFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const adminProductQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  category: z.string().trim().min(1).max(60).optional(),
  saleMode: z.enum(['DIRECT', 'WHATSAPP_ONLY']).optional(),
  condition: z.enum(['NEW', 'USED']).optional(),
  lowStock: queryFlag.optional(),
  outOfStock: queryFlag.optional(),
  withoutImage: queryFlag.optional(),
  isActive: queryFlag.optional(),
  isUniversal: queryFlag.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type AdminProductQuery = z.infer<typeof adminProductQuerySchema>;

/** Mantenedor de motos compatibles (HU-01). */
export const motorcycleCreateSchema = z.object({
  brand: z.string('La marca es obligatoria.').trim().min(1, 'La marca es obligatoria.').max(60),
  model: z.string('El modelo es obligatorio.').trim().min(1, 'El modelo es obligatorio.').max(80),
  line: z.enum(['XR_CLASSIC', 'ENDURO', 'CROSS', 'MULTI']).default('MULTI'),
  yearFrom: yearField.nullable().optional(),
  yearTo: yearField.nullable().optional(),
});

export const motorcycleUpdateSchema = motorcycleCreateSchema.partial();

export type MotorcycleCreateInput = z.infer<typeof motorcycleCreateSchema>;
export type MotorcycleUpdateInput = z.infer<typeof motorcycleUpdateSchema>;

// ---------------------------------------------------------------------------
// Importación y exportación masiva tipo Excel (RF-07 / R-02)
// ---------------------------------------------------------------------------

/** Normaliza texto para comparar (sin tildes, minúsculas, espacios simples). */
const normalizeKey = normalizeText;

/** Convierte un valor de planilla a número (acepta `"12.990"` o `12990`). */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const clean = value.replace(/[^\d-]/g, '');
    return clean.length > 0 && clean !== '-' ? Number(clean) : Number.NaN;
  }
  return Number.NaN;
}

/** Interpreta los valores de la columna "Visible" de la planilla. */
function toVisible(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const clean = normalizeKey(value);
    if (clean === '') return fallback;
    if (['true', '1', 'si', 'x', 'visible', 'activo'].includes(clean)) return true;
    if (['false', '0', 'no', 'oculto', 'inactivo'].includes(clean)) return false;
  }
  return fallback;
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

/** Interpreta el modo de venta escrito a mano ("Solo WhatsApp") o el código (`WHATSAPP_ONLY`). */
function toSaleMode(value: unknown): 'DIRECT' | 'WHATSAPP_ONLY' {
  const clean = normalizeKey(toText(value));
  return clean.includes('whatsapp') ? 'WHATSAPP_ONLY' : 'DIRECT';
}

/** Interpreta la condición del repuesto ("usado" / `USED`). */
function toCondition(value: unknown): 'NEW' | 'USED' {
  return normalizeKey(toText(value)).includes('usad') ? 'USED' : 'NEW';
}

/** Acepta la lista de motos como arreglo o como texto separado por `|` o `,`. */
function toCompatibilityList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[|,]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  return [];
}

/**
 * Lleva una fila de planilla al formato interno, aceptando `camelCase` (el que manda
 * el panel) y `snake_case` (el que describe `AGENTS.md` §5.2).
 */
function normalizeBatchRow(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;

  return {
    sku: toText(source['sku'] ?? source['SKU']),
    name: toText(source['name'] ?? source['Nombre']),
    category: toText(source['category'] ?? source['categorySlug'] ?? source['Categoria']),
    priceClp: toNumber(source['priceClp'] ?? source['price_clp'] ?? source['Precio']),
    stock: toNumber(source['stock'] ?? source['Stock']),
    saleMode: toSaleMode(source['saleMode'] ?? source['sale_mode'] ?? source['ModoVenta']),
    condition: toCondition(source['condition'] ?? source['Condicion']),
    oemPartNumber: toText(source['oemPartNumber'] ?? source['oem_part_number'] ?? source['OEM']) || null,
    compatibility: toCompatibilityList(
      source['compatibility'] ?? source['compatible_models'] ?? source['ModelosCompatibles'],
    ),
    isActive: toVisible(source['isActive'] ?? source['is_active'] ?? source['Visible'], true),
  };
}

/** Fila ya normalizada y validada de una planilla de Estrella. */
export const batchRowSchema = z.preprocess(
  normalizeBatchRow,
  z.object({
    sku: z.string().trim().min(1, 'Falta el SKU.').max(60, 'El SKU es demasiado largo.'),
    name: z
      .string()
      .trim()
      .min(2, 'Falta el nombre del repuesto.')
      .max(200, 'El nombre es demasiado largo.'),
    category: z.string().trim().max(60).optional(),
    priceClp: z.coerce
      .number('El precio no es válido.')
      .int('El precio debe ser un entero en pesos.')
      .min(0, 'El precio no puede ser negativo.')
      .max(99_999_999, 'El precio es demasiado alto.'),
    stock: z.coerce
      .number('El stock no es válido.')
      .int('El stock debe ser un número entero.')
      .min(0, 'El stock no puede ser negativo.')
      .max(100_000, 'El stock es demasiado alto.'),
    saleMode: z.enum(['DIRECT', 'WHATSAPP_ONLY']),
    condition: z.enum(['NEW', 'USED']),
    oemPartNumber: z.string().trim().max(60).nullable().optional(),
    compatibility: z.array(z.string().trim().min(1)).max(60).optional(),
    isActive: z.boolean(),
  }),
);

export type BatchImportRow = z.infer<typeof batchRowSchema>;

/**
 * Cuerpo de la carga masiva. Las filas se validan **una por una** para poder importar
 * las correctas y reportar las malas, tal como muestra el panel antes de confirmar.
 */
export const batchImportSchema = z.object({
  rows: z
    .array(z.unknown())
    .min(1, 'No hay filas para importar.')
    .max(500, 'La planilla trae demasiadas filas. Súbela en partes de 500 productos.'),
});

export type BatchImportRequest = z.infer<typeof batchImportSchema>;
