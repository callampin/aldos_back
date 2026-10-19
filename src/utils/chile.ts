/**
 * Utilidades de dominio chileno: RUT (módulo 11), teléfonos móviles y montos CLP.
 *
 * Reglas de negocio:
 * - El dinero se maneja siempre como entero en pesos chilenos (sin decimales).
 * - Los teléfonos se normalizan a `+569XXXXXXXX` para poder armar links de WhatsApp.
 */

// ---------------------------------------------------------------------------
// RUT (cédula de identidad chilena) — algoritmo del módulo 11
// ---------------------------------------------------------------------------

/** Deja solo dígitos y el dígito verificador en mayúscula. Ej: `"12.345.678-k"` → `"12345678K"`. */
export function cleanRut(value: string): string {
  return value.replace(/[^0-9kK]/g, '').toUpperCase();
}

/** Calcula el dígito verificador del cuerpo del RUT (sin puntos ni guion). */
export function computeRutDv(body: string): string {
  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body.charAt(i)) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/** Valida un RUT chileno con el algoritmo del módulo 11. */
export function isValidRut(value: string): boolean {
  const cleaned = cleanRut(value);
  if (cleaned.length < 2) return false;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^[1-9]\d*$/.test(body)) return false;

  return computeRutDv(body) === dv;
}

/** Formatea un RUT chileno. Ej: `"12345678k"` → `"12.345.678-K"`. */
export function formatRut(value: string): string {
  const cleaned = cleanRut(value);
  if (cleaned.length < 2) return cleaned;

  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${withDots}-${dv}`;
}

// ---------------------------------------------------------------------------
// Teléfonos móviles de Chile
// ---------------------------------------------------------------------------

const MOBILE_PATTERN = /^\+569\d{8}$/;

/**
 * Normaliza un teléfono móvil chileno a `+569XXXXXXXX`.
 * Acepta `912345678`, `56912345678`, `+56 9 1234 5678`, etc.
 * Devuelve `null` si no es un móvil chileno válido.
 */
export function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');

  let normalized: string;
  if (digits.length === 9 && digits.startsWith('9')) {
    normalized = `+56${digits}`;
  } else if (digits.length === 11 && digits.startsWith('569')) {
    normalized = `+${digits}`;
  } else {
    return null;
  }

  return MOBILE_PATTERN.test(normalized) ? normalized : null;
}

/** `true` si el valor es un teléfono móvil chileno válido. */
export function isValidPhone(value: string): boolean {
  return normalizePhone(value) !== null;
}

/** Formatea un teléfono móvil para mostrarlo. Ej: `"+56 9 1234 5678"`. */
export function formatPhone(value: string): string {
  const normalized = normalizePhone(value);
  if (normalized === null) return value;

  return `+56 ${normalized.slice(3, 4)} ${normalized.slice(4, 8)} ${normalized.slice(8, 12)}`;
}

// ---------------------------------------------------------------------------
// Montos en pesos chilenos (CLP, sin decimales)
// ---------------------------------------------------------------------------

/** Valida que un valor sea un monto CLP utilizable: entero, sin decimales y no negativo. */
export function isValidClpAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Formatea un monto en pesos chilenos. Ej: `15990` → `"$15.990"`. */
export function formatClp(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  const withDots = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${sign}$${withDots}`;
}
