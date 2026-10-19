import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { createDb } from '../../db';
import { productImages, products } from '../../db/schema';
import type { AppEnv } from '../../middlewares/auth.middleware';
import { AppError } from '../../middlewares/error.middleware';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  deleteProductImageObject,
  putProductImage,
} from '../../services/storage-r2.service';

/**
 * Fotos de repuestos en Cloudflare R2 (RF-07).
 *
 * El frontend sube la imagen comprimida a WebP por `multipart/form-data` con los
 * campos `productId`, `file` y, opcionalmente, `altText` e `isPrimary`.
 */
export const adminMediaRoutes = new Hono<AppEnv>();

function absoluteUrl(origin: string, path: string): string {
  return path.startsWith('/') ? `${origin}${path}` : path;
}

/** Marca una foto como principal y desmarca el resto del producto. */
async function setPrimaryImage(
  db: ReturnType<typeof createDb>,
  productId: number,
  imageId: number,
): Promise<void> {
  await db
    .update(productImages)
    .set({ isPrimary: false })
    .where(and(eq(productImages.productId, productId), ne(productImages.id, imageId)));

  await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, imageId));
}

/** `POST /api/v1/admin/media/upload` — subir una foto y asociarla a un repuesto. */
adminMediaRoutes.post('/upload', async (c) => {
  const form = await c.req.formData();

  const rawProductId = form.get('productId');
  const productId = Number(rawProductId);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new AppError('INVALID_PRODUCT_ID', 'No indicaste a qué repuesto pertenece la foto.', 400);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    throw new AppError(
      'MISSING_FILE',
      `Adjunta la foto como archivo. Formatos permitidos: ${ALLOWED_IMAGE_TYPES.join(', ')} (máximo ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB).`,
      400,
    );
  }

  const db = createDb(c.env.DB);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  if (!product) {
    throw new AppError('PRODUCT_NOT_FOUND', 'No encontramos ese repuesto.', 404);
  }

  const stored = await putProductImage(c.env.BUCKET, { productId, file });

  const [existing] = await db
    .select({ total: sql<number>`count(*)` })
    .from(productImages)
    .where(eq(productImages.productId, productId));

  const [lastOrder] = await db
    .select({ maxOrder: sql<number | null>`max(${productImages.sortOrder})` })
    .from(productImages)
    .where(eq(productImages.productId, productId));

  const wantsPrimary = form.get('isPrimary') === 'true';
  // La primera foto de un repuesto siempre queda como principal.
  const isPrimary = wantsPrimary || (existing?.total ?? 0) === 0;
  const altText = form.get('altText');
  const sortOrder = (lastOrder?.maxOrder ?? -1) + 1;

  const [created] = await db
    .insert(productImages)
    .values({
      productId,
      r2Key: stored.r2Key,
      url: stored.publicPath,
      altText: typeof altText === 'string' && altText.trim().length > 0 ? altText.trim() : null,
      isPrimary,
      sortOrder,
    })
    .returning({ id: productImages.id });

  const imageId = created?.id ?? 0;

  if (isPrimary && imageId > 0) {
    await setPrimaryImage(db, productId, imageId);
  }

  return c.json(
    {
      ok: true as const,
      data: {
        image: {
          id: imageId,
          url: absoluteUrl(new URL(c.req.url).origin, stored.publicPath),
          r2Key: stored.r2Key,
          isPrimary,
          sortOrder,
          sizeBytes: stored.sizeBytes,
          contentType: stored.contentType,
        },
      },
    },
    201,
  );
});

/** `DELETE /api/v1/admin/media/:imageId` — borrar la foto del repuesto y de R2. */
adminMediaRoutes.delete('/:imageId', async (c) => {
  const imageId = Number(c.req.param('imageId'));
  if (!Number.isInteger(imageId) || imageId <= 0) {
    throw new AppError('INVALID_IMAGE_ID', 'La foto que intentas borrar no es válida.', 400);
  }

  const db = createDb(c.env.DB);

  const [image] = await db
    .select({
      id: productImages.id,
      productId: productImages.productId,
      r2Key: productImages.r2Key,
      isPrimary: productImages.isPrimary,
    })
    .from(productImages)
    .where(eq(productImages.id, imageId))
    .limit(1);

  if (!image) {
    throw new AppError('IMAGE_NOT_FOUND', 'Esa foto ya no existe.', 404);
  }

  await deleteProductImageObject(c.env.BUCKET, image.r2Key);
  await db.delete(productImages).where(eq(productImages.id, imageId));

  // Si se borró la principal, se promueve la siguiente foto del repuesto.
  let promoted: number | null = null;
  if (image.isPrimary) {
    const [next] = await db
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, image.productId))
      .orderBy(asc(productImages.sortOrder), asc(productImages.id))
      .limit(1);

    if (next) {
      await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, next.id));
      promoted = next.id;
    }
  }

  return c.json({
    ok: true as const,
    data: { id: imageId, promotedImageId: promoted, message: 'Foto eliminada.' },
  });
});

/** Lista las fotos de un repuesto (por si el panel necesita refrescar la galería). */
adminMediaRoutes.get('/product/:productId', async (c) => {
  const productId = Number(c.req.param('productId'));
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new AppError('INVALID_PRODUCT_ID', 'El repuesto indicado no es válido.', 400);
  }

  const db = createDb(c.env.DB);
  const origin = new URL(c.req.url).origin;

  const images = await db
    .select({
      id: productImages.id,
      url: productImages.url,
      altText: productImages.altText,
      isPrimary: productImages.isPrimary,
      sortOrder: productImages.sortOrder,
    })
    .from(productImages)
    .where(eq(productImages.productId, productId))
    .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder), asc(productImages.id));

  return c.json({
    ok: true as const,
    data: images.map((image) => ({ ...image, url: absoluteUrl(origin, image.url) })),
  });
});
