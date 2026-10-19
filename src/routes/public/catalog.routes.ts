import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import { validationHook } from '../../middlewares/error.middleware';
import { rateLimit } from '../../middlewares/rate-limit.middleware';
import {
  createStockAlert,
  getCatalogProductBySlug,
  listCatalogProducts,
  listMotorcycleTree,
  listShippingRates,
  productIsVisible,
} from '../../services/catalog.service';
import { getMediaObject, mediaResponseHeaders } from '../../services/storage-r2.service';
import type { Env } from '../../types/bindings';
import { buildProductInquiryMessage, buildWhatsAppUrl } from '../../utils/whatsapp';
import { catalogQuerySchema, idParamSchema, stockAlertSchema } from '../../validators/product.schema';

/**
 * Rutas públicas de la tienda (sin sesión).
 * RF-01 (catálogo), RF-02 (búsqueda y filtros), RF-10 (envíos), R-03 (avisos de stock).
 */
export const publicCatalogRoutes = new Hono<{ Bindings: Env }>();

/** `GET /api/v1/public/catalog` — listado con filtros combinables y paginación. */
publicCatalogRoutes.get(
  '/catalog',
  zValidator('query', catalogQuerySchema, validationHook),
  async (c) => {
    const query = c.req.valid('query');
    const db = createDb(c.env.DB);

    const { items, total } = await listCatalogProducts(
      db,
      {
        q: query.q,
        categorySlug: query.category,
        brand: query.brand,
        model: query.model,
        year: query.year,
        line: query.line,
        inStockOnly: query.inStockOnly ?? query.inStock ?? false,
        sort: query.sort,
        page: query.page,
        limit: query.limit,
      },
      { mediaBaseUrl: new URL(c.req.url).origin },
    );

    return c.json({
      ok: true as const,
      data: items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    });
  },
);

/** `GET /api/v1/public/products/:slug` — ficha completa + enlace de WhatsApp (HU-07). */
publicCatalogRoutes.get('/products/:slug', async (c) => {
  const slug = c.req.param('slug');
  const db = createDb(c.env.DB);

  const product = await getCatalogProductBySlug(db, slug, {
    mediaBaseUrl: new URL(c.req.url).origin,
  });

  if (!product) {
    return c.json(
      {
        ok: false as const,
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'No encontramos ese repuesto. Puede que ya no esté disponible.',
        },
      },
      404,
    );
  }

  const productUrl = `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/producto/${product.slug}`;
  const whatsappMessage = buildProductInquiryMessage({
    productName: product.name,
    sku: product.sku,
    url: productUrl,
  });

  return c.json({
    ok: true as const,
    data: {
      ...product,
      url: productUrl,
      whatsappUrl: buildWhatsAppUrl(c.env.STORE_WHATSAPP, whatsappMessage),
      whatsappMessage,
    },
  });
});
/** `GET /api/v1/public/motorcycles` — Marcas → Modelos → años (HU-01). */
publicCatalogRoutes.get('/motorcycles', async (c) => {
  const db = createDb(c.env.DB);
  const brands = await listMotorcycleTree(db);

  return c.json({ ok: true as const, data: brands });
});

/** `GET /api/v1/public/shipping-rates` — regiones, costos y plazos (RF-10). */
publicCatalogRoutes.get('/shipping-rates', async (c) => {
  const db = createDb(c.env.DB);
  const rates = await listShippingRates(db);

  return c.json({ ok: true as const, data: rates });
});

/**
 * `GET /api/v1/public/media/*` — sirve las fotos de los repuestos desde Cloudflare R2.
 *
 * Se sirven a través del Worker con `Cache-Control` inmutable, para no depender de un
 * dominio propio de R2 (ver `NOTAS.md` H-14). Si más adelante se configura un dominio
 * público de R2, basta con cambiar las URLs guardadas en `product_images`.
 */
publicCatalogRoutes.get('/media/*', async (c) => {
  const marker = '/media/';
  const start = c.req.path.indexOf(marker);
  const r2Key = start >= 0 ? decodeURIComponent(c.req.path.slice(start + marker.length)) : '';

  if (r2Key.length === 0) {
    return c.json(
      { ok: false as const, error: { code: 'MEDIA_NOT_FOUND', message: 'No encontramos esa foto.' } },
      404,
    );
  }

  const object = await getMediaObject(c.env.BUCKET, r2Key);

  if (!object) {
    return c.json(
      { ok: false as const, error: { code: 'MEDIA_NOT_FOUND', message: 'No encontramos esa foto.' } },
      404,
    );
  }

  return new Response(object.body, { headers: mediaResponseHeaders(object) });
});

/** `POST /api/v1/public/products/:id/stock-alert` — "avisarme cuando llegue" (R-03). */
publicCatalogRoutes.post(
  '/products/:id/stock-alert',
  rateLimit({ name: 'stock-alert', limit: 10, windowSeconds: 900 }),
  zValidator('param', idParamSchema, validationHook),
  zValidator('json', stockAlertSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    if (!(await productIsVisible(db, id))) {
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'PRODUCT_NOT_FOUND',
            message: 'No encontramos ese repuesto. Puede que ya no esté disponible.',
          },
        },
        404,
      );
    }

    await createStockAlert(db, {
      productId: id,
      customerName: body.customerName,
      customerContact: body.customerContact,
    });

    return c.json(
      {
        ok: true as const,
        data: {
          message: 'Listo. Te avisaremos apenas llegue el repuesto.',
        },
      },
      201,
    );
  },
);
