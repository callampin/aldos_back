import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';

import { createDb } from '../../db';
import type { AppEnv } from '../../middlewares/auth.middleware';
import { AppError, validationHook } from '../../middlewares/error.middleware';
import {
  listAllShippingRates,
  readStoreSettings,
  updateShippingRate,
  upsertStoreSettings,
  ALLOWED_SETTING_KEYS,
} from '../../services/settings.service';
import {
  shippingRateUpdateSchema,
  storeSettingsUpdateSchema,
} from '../../validators/order.schema';

/**
 * Configuración de la tienda que Estrella puede ajustar sin tocar código (RF-10):
 * datos de WhatsApp y correo, medios de pago habilitados, datos bancarios y
 * tarifas de envío por región.
 */
export const adminSettingsRoutes = new Hono<AppEnv>();

/** Claves que no se deben mostrar tal cual en el panel. */
const HIDDEN_KEYS: readonly string[] = [];

/** Textos y formatos esperados por clave de configuración. */
function normalizeSettingValue(key: string, raw: string | number | boolean): string {
  if (key === 'allow_khipu' || key === 'allow_manual_transfer' || key === 'hide_out_of_stock' || key === 'pickup_enabled') {
    const text = String(raw).trim().toLowerCase();
    if (['true', '1', 'si', 'sí', 'yes'].includes(text)) return 'true';
    if (['false', '0', 'no'].includes(text)) return 'false';
    throw new AppError('INVALID_SETTING_VALUE', `"${key}" debe ser sí o no.`, 400, [key]);
  }

  if (key === 'dispatch_cutoff_hour') {
    const hour = Number.parseInt(String(raw), 10);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new AppError(
        'INVALID_SETTING_VALUE',
        'La hora de corte debe ser un número entre 0 y 23.',
        400,
        [key],
      );
    }
    return String(hour);
  }

  if (key === 'store_email' || key === 'notification_emails') {
    const value = String(raw).trim();
    const emails = value.split(/[,;]/).map((email) => email.trim()).filter((email) => email.length > 0);
    const invalid = emails.filter((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email));
    if (emails.length === 0 || invalid.length > 0) {
      throw new AppError(
        'INVALID_SETTING_VALUE',
        'Revisa los correos: deben tener el formato nombre@dominio.cl.',
        400,
        [key],
      );
    }
    return emails.join(',');
  }

  if (key === 'bank_transfer_details') {
    const value = String(raw).trim();
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('no es un objeto');
      }
      return JSON.stringify(parsed);
    } catch {
      throw new AppError(
        'INVALID_SETTING_VALUE',
        'Los datos bancarios deben venir como un objeto JSON con banco, tipo de cuenta, número y titular.',
        400,
        [key],
      );
    }
  }

  const value = String(raw).trim();
  if (value.length === 0) {
    throw new AppError('INVALID_SETTING_VALUE', `"${key}" no puede quedar vacío.`, 400, [key]);
  }
  if (value.length > 500) {
    throw new AppError('INVALID_SETTING_VALUE', `"${key}" es demasiado largo.`, 400, [key]);
  }

  return value;
}

/** `GET /api/v1/admin/settings` — configuración de la tienda + tarifas de envío. */
adminSettingsRoutes.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const [settings, rates] = await Promise.all([readStoreSettings(db), listAllShippingRates(db)]);

  const visible: Record<string, string> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!HIDDEN_KEYS.includes(key)) visible[key] = value;
  }

  return c.json({
    ok: true as const,
    data: { settings: visible, shippingRates: rates },
    meta: { allowedKeys: [...ALLOWED_SETTING_KEYS] },
  });
});

/** `PUT /api/v1/admin/settings` — guarda solo las claves enviadas. */
adminSettingsRoutes.put(
  '/',
  zValidator('json', storeSettingsUpdateSchema, validationHook),
  async (c) => {
    const { settings } = c.req.valid('json');
    const db = createDb(c.env.DB);

    const normalized: Record<string, string> = {};
    for (const [key, raw] of Object.entries(settings)) {
      normalized[key] = normalizeSettingValue(key, raw);
    }

    await upsertStoreSettings(db, normalized);

    return c.json({ ok: true as const, data: { settings: await readStoreSettings(db) } });
  },
);

/** `GET /api/v1/admin/settings/shipping-rates` — tarifas por región (incluidas las apagadas). */
adminSettingsRoutes.get('/shipping-rates', async (c) => {
  const db = createDb(c.env.DB);
  const rates = await listAllShippingRates(db);

  return c.json({ ok: true as const, data: rates, meta: { total: rates.length } });
});

/** `PUT /api/v1/admin/settings/shipping-rates/:regionCode` — ajusta una región. */
adminSettingsRoutes.put(
  '/shipping-rates/:regionCode',
  zValidator('json', shippingRateUpdateSchema, validationHook),
  async (c) => {
    const regionCode = c.req.param('regionCode');
    const body = c.req.valid('json');
    const db = createDb(c.env.DB);

    const rate = await updateShippingRate(db, regionCode.toUpperCase(), body);

    return c.json({ ok: true as const, data: rate });
  },
);
