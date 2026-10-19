import { eq, inArray, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';

import { productCompatibility, products } from '../../src/db/schema';
import { batchUpsertProducts } from '../../src/services/inventory.service';
import { batchRowSchema } from '../../src/validators/product.schema';
import { getDb, insertProduct, resetDatabase } from './helpers';

/**
 * Importación masiva tipo Excel (RF-07 / R-02): debe ser **idempotente** por `sku`,
 * sin duplicar filas, y tiene que informar las filas malas sin perder las buenas.
 */
async function parseRow(raw: unknown, position: number) {
  const parsed = batchRowSchema.parse(raw);
  return { position, row: parsed };
}

describe('Importación masiva tipo Excel', () => {
  beforeEach(resetDatabase);
  it('crea y actualiza por SKU sin duplicar', async () => {
    const db = getDb();
    const existing = await insertProduct({ stock: 1, priceClp: 1_000 });

    const items = await Promise.all([
      parseRow(
        {
          sku: 'EXCEL-NUEVO-1',
          name: 'Repuesto nuevo 1',
          category: 'motor',
          priceClp: 15_990,
          stock: 5,
          saleMode: 'DIRECT',
        },
        1,
      ),
      parseRow(
        {
          sku: 'EXCEL-NUEVO-2',
          name: 'Repuesto nuevo 2',
          priceClp: 20_000,
          stock: 0,
          saleMode: 'WHATSAPP_ONLY',
        },
        2,
      ),
      parseRow(
        {
          sku: existing.sku,
          name: 'Repuesto actualizado',
          priceClp: 2_500,
          stock: 9,
          saleMode: 'DIRECT',
        },
        3,
      ),
    ]);

    const first = await batchUpsertProducts(db, items);
    expect(first.created).toBe(2);
    expect(first.updated).toBe(1);
    expect(first.errors).toHaveLength(0);

    // Segunda pasada con el mismo lote: no crea nada y no duplica SKU.
    const second = await batchUpsertProducts(db, items);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(3);

    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(products)
      .where(inArray(products.sku, ['EXCEL-NUEVO-1', 'EXCEL-NUEVO-2', existing.sku]));

    expect(counted?.total).toBe(3);

    const [updated] = await db
      .select({ name: products.name, priceClp: products.priceClp, stock: products.stock })
      .from(products)
      .where(eq(products.sku, existing.sku));

    expect(updated).toMatchObject({ name: 'Repuesto actualizado', priceClp: 2_500, stock: 9 });
  });

  it('reporta las filas malas sin perder las buenas', async () => {
    const db = getDb();

    const good = await parseRow(
      { sku: 'EXCEL-OK-1', name: 'Repuesto correcto', priceClp: 1_000, stock: 1, saleMode: 'DIRECT' },
      1,
    );

    // Fila sin nombre: se detecta al validar (no llega al servicio).
    const badName = batchRowSchema.safeParse({ sku: 'EXCEL-MALA-1', name: '', priceClp: 100, stock: 1 });
    expect(badName.success).toBe(false);
    expect(badName.success === false && badName.error.issues[0]?.message).toBe(
      'Falta el nombre del repuesto.',
    );

    const badPrice = batchRowSchema.safeParse({
      sku: 'EXCEL-MALA-2',
      name: 'Precio malo',
      priceClp: '$abc',
      stock: 1,
    });
    expect(badPrice.success).toBe(false);

    const report = await batchUpsertProducts(db, [good]);
    expect(report.created).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it('avisa (sin bloquear) cuando la categoría o la moto no existen', async () => {
    const db = getDb();

    const item = await parseRow(
      {
        sku: 'EXCEL-AVISO-1',
        name: 'Con datos raros',
        category: 'Categoría Fantasma',
        priceClp: 1_000,
        stock: 1,
        saleMode: 'DIRECT',
        compatibility: ['Honda:XR 999 Inexistente'],
      },
      1,
    );

    const report = await batchUpsertProducts(db, [item]);

    expect(report.created).toBe(1);
    expect(report.warnings).toHaveLength(2);
    expect(report.warnings.map((warning) => warning.message).join(' ')).toContain('Categoría Fantasma');
    expect(report.warnings.some((warning) => warning.message.includes('XR 999 Inexistente'))).toBe(true);

    // El repuesto igual quedó guardado.
    const [saved] = await db
      .select({ id: products.id, categoryId: products.categoryId })
      .from(products)
      .where(eq(products.sku, 'EXCEL-AVISO-1'));

    expect(saved).toBeDefined();
    expect(saved?.categoryId).toBeNull();
    expect(
      await db
        .select({ id: productCompatibility.id })
        .from(productCompatibility)
        .where(eq(productCompatibility.productId, saved?.id ?? 0)),
    ).toHaveLength(0);
  });

  it('acepta el formato crudo de la planilla (snake_case y textos en español)', async () => {
    const parsed = batchRowSchema.parse({
      sku: 'EXCEL-PLANILLA-1',
      name: 'Repuesto formato planilla',
      category: 'Transmisión',
      price_clp: '12.990',
      stock: '7',
      sale_mode: 'Solo WhatsApp',
      condition: 'Usado',
      oem_part_number: 'OEM-X',
      compatible_models: 'Honda:XR 250 Tornado | KTM:EXC 300',
      Visible: 'No',
    });

    expect(parsed).toMatchObject({
      sku: 'EXCEL-PLANILLA-1',
      priceClp: 12_990,
      stock: 7,
      saleMode: 'WHATSAPP_ONLY',
      condition: 'USED',
      oemPartNumber: 'OEM-X',
      isActive: false,
    });
    expect(parsed.compatibility).toEqual(['Honda:XR 250 Tornado', 'KTM:EXC 300']);
  });
});
