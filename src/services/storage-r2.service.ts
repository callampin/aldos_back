import { AppError } from '../middlewares/error.middleware';
import { generateRandomToken } from '../utils/crypto';

/**
 * Almacenamiento de las fotos de repuestos en **Cloudflare R2** (RF-07, RNF-03).
 *
 * Las fotos se suben ya comprimidas a WebP desde el navegador
 * (`front/src/lib/image-compressor.ts`); igual se aceptan JPG/PNG/AVIF por si
 * Estrella sube una foto desde el computador.
 *
 * Decisión de diseño (ver `NOTAS.md` H-14): la URL pública se sirve **a través del
 * Worker** (`/api/v1/public/media/<clave>`), con `Cache-Control` inmutable para que
 * Cloudflare la cachee en el CDN. No se asume un dominio propio de R2 todavía; si más
 * adelante se configura uno, basta cambiar `buildPublicMediaPath` y volver a guardar
 * las URLs.
 */

/** Tamaño máximo aceptado por foto (5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/avif': 'avif',
};

/** Tipos de imagen aceptados. */
export const ALLOWED_IMAGE_TYPES = Object.keys(MIME_EXTENSIONS);

/** Extensión de archivo para un MIME permitido, o `null` si no es una imagen aceptada. */
export function extensionForMimeType(mimeType: string): string | null {
  return MIME_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

/** Clave del objeto en R2. Ej: `products/104/1792384000000-a1b2c3d4.webp`. */
export function buildR2Key(productId: number, extension: string): string {
  return `products/${productId}/${Date.now()}-${generateRandomToken(4)}.${extension}`;
}

/** Ruta pública (relativa) con la que el Worker sirve la imagen desde R2. */
export function buildPublicMediaPath(r2Key: string): string {
  return `/api/v1/public/media/${r2Key}`;
}

/** Propiedades de caché que se guardan junto al objeto en R2. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface StoreImageInput {
  productId: number;
  file: File;
}

export interface StoredImage {
  r2Key: string;
  /** Ruta relativa guardada en la base (`/api/v1/public/media/...`). */
  publicPath: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Valida y guarda una foto en R2. Lanza `AppError` con mensaje claro si el archivo
 * no sirve (formato no permitido, muy pesado o vacío).
 */
export async function putProductImage(
  bucket: R2Bucket,
  { productId, file }: StoreImageInput,
): Promise<StoredImage> {
  const extension = extensionForMimeType(file.type);

  if (extension === null) {
    throw new AppError(
      'UNSUPPORTED_IMAGE_TYPE',
      'Ese archivo no es una foto permitida. Súbela en formato WebP, JPG, PNG o AVIF.',
      415,
    );
  }

  if (file.size === 0) {
    throw new AppError('EMPTY_IMAGE', 'La foto llegó vacía. Vuelve a intentarlo.', 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError(
      'IMAGE_TOO_LARGE',
      'La foto pesa más de 5 MB. Comprímela e intenta de nuevo.',
      413,
    );
  }

  const r2Key = buildR2Key(productId, extension);

  await bucket.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: CACHE_CONTROL,
    },
  });

  return {
    r2Key,
    publicPath: buildPublicMediaPath(r2Key),
    contentType: file.type,
    sizeBytes: file.size,
  };
}

/** Borra un objeto de R2 (no falla si ya no existía). */
export async function deleteProductImageObject(bucket: R2Bucket, r2Key: string): Promise<void> {
  await bucket.delete(r2Key);
}

/** Lee un objeto de R2 para servirlo desde el Worker. */
export async function getMediaObject(bucket: R2Bucket, r2Key: string): Promise<R2ObjectBody | null> {
  return bucket.get(r2Key);
}

/** Headers con los que el Worker sirve las fotos desde R2. */
export function mediaResponseHeaders(object: R2ObjectBody): HeadersInit {
  return {
    'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': object.httpMetadata?.cacheControl ?? CACHE_CONTROL,
    ETag: object.httpEtag,
    'Access-Control-Allow-Origin': '*',
  };
}
