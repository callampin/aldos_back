/**
 * Utilidades criptográficas basadas en Web Crypto API (`crypto.subtle`),
 * disponibles tanto en el runtime de Cloudflare Workers como en Node 22.
 *
 * Contenido:
 * - Hashing de contraseñas con PBKDF2-SHA256 (`hashPassword` / `verifyPassword`).
 * - Firma HMAC-SHA256 para los webhooks de Khipu (`signHmacSha256` / `verifyHmacSha256`).
 */

/** Algoritmo y parámetros del hashing de contraseñas (formato del string guardado). */
const ALGORITHM = 'pbkdf2-sha256';
const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_HASH = 'SHA-256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function fromHex(value: string): Uint8Array {
  const clean = value.trim().toLowerCase();
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new Error('Firma hexadecimal inválida.');
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Comparación en tiempo constante (evita filtrar información por diferencias de tiempo). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: PBKDF2_HASH },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Hashea una contraseña con PBKDF2-SHA256 y salt aleatorio.
 * Formato guardado: `pbkdf2-sha256$<iteraciones>$<saltB64>$<hashB64>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  return `${ALGORITHM}$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Verifica una contraseña contra el string guardado. Nunca lanza: devuelve `false` si el formato es inválido. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false;

  const [algorithm, rawIterations, rawSalt, rawHash] = parts;
  if (algorithm !== ALGORITHM || !rawIterations || !rawSalt || !rawHash) return false;

  const iterations = Number.parseInt(rawIterations, 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  try {
    const expected = fromBase64(rawHash);
    const actual = await deriveKey(password, fromBase64(rawSalt), iterations);
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Firma HMAC-SHA256 (webhooks de Khipu)
// ---------------------------------------------------------------------------

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return new Uint8Array(signature);
}

/**
 * Firma un payload con HMAC-SHA256.
 * `encoding` permite devolver base64 (por defecto) o hexadecimal.
 */
export async function signHmacSha256(
  secret: string,
  payload: string,
  encoding: 'base64' | 'hex' = 'base64',
): Promise<string> {
  const signature = await hmacSha256(secret, payload);
  return encoding === 'hex' ? toHex(signature) : toBase64(signature);
}

/**
 * Verifica una firma HMAC-SHA256 en tiempo constante.
 * Nunca lanza excepción: devuelve `false` si la firma está mal formada.
 */
export async function verifyHmacSha256(
  secret: string,
  payload: string,
  signature: string,
  encoding: 'base64' | 'hex' = 'base64',
): Promise<boolean> {
  try {
    const expected = await hmacSha256(secret, payload);
    const received = encoding === 'hex' ? fromHex(signature) : fromBase64(signature);
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Tokens aleatorios
// ---------------------------------------------------------------------------

/**
 * Genera un token aleatorio criptográficamente seguro en base64url.
 * Se usa para la recuperación de contraseña y el código público de seguimiento (RF-14).
 */
export function generateRandomToken(bytes = 32): string {
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return toBase64(random).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
