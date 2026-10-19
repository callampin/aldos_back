import { asc, eq } from 'drizzle-orm';

import type { Database } from '../db';
import { shippingRates, storeSettings } from '../db/schema';
import { AppError } from '../middlewares/error.middleware';

/**
 * Configuración global de la tienda (`store_settings`) y tarifas de envío
 * (`shipping_rates`). Es lo que Estrella puede ajustar sin tocar código (RF-10).
 */

/** Claves permitidas en `store_settings` (todo lo demás se rechaza). */
export const ALLOWED_SETTING_KEYS = [
  'whatsapp_number',
  'store_email',
  'notification_emails',
  'dispatch_cutoff_hour',
  'allow_khipu',
  'allow_manual_transfer',
  'hide_out_of_stock',
  'bank_transfer_details',
  'pickup_enabled',
  'pickup_address',
] as const;

export type SettingKey = (typeof ALLOWED_SETTING_KEYS)[number];

/** Lee toda la configuración como objeto plano `clave → valor`. */
export async function readStoreSettings(db: Database): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: storeSettings.key, value: storeSettings.value })
    .from(storeSettings);

  const settings: Record<string, string> = {};
  for (const row of rows) settings[row.key] = row.value;

  return settings;
}

/** Crea o actualiza varias claves de configuración de una vez. */
export async function upsertStoreSettings(
  db: Database,
  entries: Record<string, string>,
): Promise<void> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;

  const unknown = keys.filter((key) => !(ALLOWED_SETTING_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new AppError(
      'INVALID_SETTING',
      `No conocemos la configuración "${unknown[0]}". Revisa los datos enviados.`,
      400,
      unknown,
    );
  }

  for (const [key, value] of Object.entries(entries)) {
    await db
      .insert(storeSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: storeSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}

export interface AdminShippingRate {
  id: number;
  regionCode: string;
  regionName: string;
  baseCostClp: number;
  isPayableOnDelivery: boolean;
  estimatedDays: string;
  courierName: string;
  isActive: boolean;
}

/** Todas las regiones (incluidas las desactivadas), para el panel de Estrella. */
export async function listAllShippingRates(db: Database): Promise<AdminShippingRate[]> {
  return db
    .select({
      id: shippingRates.id,
      regionCode: shippingRates.regionCode,
      regionName: shippingRates.regionName,
      baseCostClp: shippingRates.baseCostClp,
      isPayableOnDelivery: shippingRates.isPayableOnDelivery,
      estimatedDays: shippingRates.estimatedDays,
      courierName: shippingRates.courierName,
      isActive: shippingRates.isActive,
    })
    .from(shippingRates)
    .orderBy(asc(shippingRates.id));
}

export interface UpdateShippingRateInput {
  baseCostClp?: number;
  estimatedDays?: string;
  courierName?: string;
  isPayableOnDelivery?: boolean;
  isActive?: boolean;
}

/** Actualiza la tarifa de una región. */
export async function updateShippingRate(
  db: Database,
  regionCode: string,
  input: UpdateShippingRateInput,
): Promise<AdminShippingRate> {
  const changes: Record<string, unknown> = {};

  if (input.baseCostClp !== undefined) changes['baseCostClp'] = input.baseCostClp;
  if (input.estimatedDays !== undefined) changes['estimatedDays'] = input.estimatedDays;
  if (input.courierName !== undefined) changes['courierName'] = input.courierName;
  if (input.isPayableOnDelivery !== undefined) {
    changes['isPayableOnDelivery'] = input.isPayableOnDelivery;
  }
  if (input.isActive !== undefined) changes['isActive'] = input.isActive;

  if (Object.keys(changes).length === 0) {
    throw new AppError('NO_CHANGES', 'No hay cambios para guardar.', 400);
  }

  const updated = await db
    .update(shippingRates)
    .set(changes)
    .where(eq(shippingRates.regionCode, regionCode))
    .returning({
      id: shippingRates.id,
      regionCode: shippingRates.regionCode,
      regionName: shippingRates.regionName,
      baseCostClp: shippingRates.baseCostClp,
      isPayableOnDelivery: shippingRates.isPayableOnDelivery,
      estimatedDays: shippingRates.estimatedDays,
      courierName: shippingRates.courierName,
      isActive: shippingRates.isActive,
    });

  const [rate] = updated;

  if (!rate) {
    throw new AppError('REGION_NOT_FOUND', 'No encontramos esa región.', 404);
  }

  return rate;
}
