/**
 * Generador de slugs limpios para SEO (RNF-08).
 *
 * Ej: `"Kit Pistón Original Honda XR 250R (STD)"` → `"kit-piston-original-honda-xr-250r-std"`
 */

/**
 * Normaliza un texto para compararlo con otro (sin tildes, minúsculas, espacios simples).
 * Se usa para hacer coincidir categorías y motos escritas a mano en la planilla de Excel.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Largo máximo por defecto de un slug (los buscadores penalizan URLs muy largas). */
export const DEFAULT_SLUG_MAX_LENGTH = 80;

/**
 * Convierte un texto en un slug apto para URL: sin tildes, minúsculas,
 * solo letras/números separados por guiones simples.
 */
export function slugify(value: string, maxLength: number = DEFAULT_SLUG_MAX_LENGTH): string {
  const slug = value
    .normalize('NFD')
    // Quita los acentos (marcas diacríticas que NFD separó de la letra base).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  if (maxLength <= 0 || slug.length <= maxLength) return slug;

  return slug
    .slice(0, maxLength)
    .replace(/-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * Genera un slug único anteponiendo el SKU, útil para productos con nombres repetidos.
 * Ej: `("XR-PIST-250R-STD", "Kit Pistón Original")` → `"xr-pist-250r-std-kit-piston-original"`
 */
export function buildProductSlug(
  sku: string,
  name: string,
  maxLength: number = DEFAULT_SLUG_MAX_LENGTH,
): string {
  return slugify(`${sku} ${name}`, maxLength);
}
