import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { requireAdmin, type AppEnv } from './middlewares/auth.middleware';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { adminAuthRoutes } from './routes/admin/auth.routes';
import { adminMediaRoutes } from './routes/admin/media.routes';
import { adminMotorcycleRoutes } from './routes/admin/motorcycles.routes';
import { adminOrderRoutes } from './routes/admin/orders.routes';
import { adminProductRoutes } from './routes/admin/products.routes';
import { adminSettingsRoutes } from './routes/admin/settings.routes';
import { publicCatalogRoutes } from './routes/public/catalog.routes';
import { publicCheckoutRoutes } from './routes/public/checkout.routes';
import { publicTrackingRoutes } from './routes/public/tracking.routes';
import { publicWebhookRoutes } from './routes/public/webhooks.routes';

const app = new Hono<AppEnv>();

/**
 * CORS: solo se permite el frontend oficial de la tienda y el servidor local de
 * desarrollo. Se habilitan credenciales para la cookie HttpOnly del panel.
 */
app.use('/api/*', (c, next) =>
  cors({
    origin: (origin) => {
      const allowed = [c.env.FRONTEND_URL, 'http://localhost:4321', 'http://127.0.0.1:4321'];
      return allowed.includes(origin) ? origin : undefined;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    credentials: true,
    maxAge: 86400,
  })(c, next),
);

/** Healthcheck: confirma que el Worker está en línea. */
app.get('/api/v1/health', (c) => c.json({ ok: true as const, status: 'healthy' }));

/**
 * Panel de Estrella. Todo `/api/v1/admin/*` exige sesión, **salvo** el paquete de
 * autenticación (ingreso y recuperación de contraseña). Se protege por prefijo para
 * que cualquier ruta nueva del panel quede cerrada por defecto.
 */
app.use('/api/v1/admin/*', async (c, next) => {
  if (c.req.path.startsWith('/api/v1/admin/auth/')) return next();
  return requireAdmin(c, next);
});

app.route('/api/v1/admin/auth', adminAuthRoutes);
app.route('/api/v1/admin/products', adminProductRoutes);
app.route('/api/v1/admin/motorcycles', adminMotorcycleRoutes);
app.route('/api/v1/admin/media', adminMediaRoutes);
app.route('/api/v1/admin/orders', adminOrderRoutes);
app.route('/api/v1/admin/settings', adminSettingsRoutes);

/** Tienda pública: catálogo, motos, envíos y avisos de stock (sin sesión). */
app.route('/api/v1/public', publicCatalogRoutes);

/** Checkout y seguimiento público de pedidos (sin sesión). */
app.route('/api/v1/public', publicCheckoutRoutes);
app.route('/api/v1/public', publicTrackingRoutes);

/** Webhooks de la pasarela de pagos (Khipu). */
app.route('/api/v1/public', publicWebhookRoutes);

app.notFound(notFoundHandler);
app.onError(errorHandler);

export default app;
