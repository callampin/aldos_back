import { describe, expect, it } from 'vitest';

import { checkoutSchema, trackingCodeParamSchema } from '../../src/validators/order.schema';

const baseCheckout = {
  customerName: 'Pedro Soto',
  customerRut: null,
  customerEmail: 'pedro@example.cl',
  customerPhone: '+56 9 1234 5678',
  deliveryMethod: 'SHIPPING' as const,
  regionCode: 'RM',
  comuna: 'Maipú',
  addressLine: 'Av. Siempre Viva 123, casa 4',
  addressReference: null,
  customerNotes: null,
  paymentMethod: 'KHIPU' as const,
  items: [{ productId: 1, quantity: 1 }],
};

describe('Validación del checkout', () => {
  it('normaliza el teléfono y el correo', () => {
    const result = checkoutSchema.safeParse({ ...baseCheckout, customerEmail: '  PEDRO@Example.CL ' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.customerPhone).toBe('+56912345678');
    expect(result.success && result.data.customerEmail).toBe('pedro@example.cl');
  });

  it('rechaza un celular que no es chileno', () => {
    const result = checkoutSchema.safeParse({ ...baseCheckout, customerPhone: '+1 555 1234' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('celular chileno');
  });

  it('acepta RUT válido y descarta el vacío', () => {
    const valid = checkoutSchema.safeParse({ ...baseCheckout, customerRut: '12.345.678-5' });
    const empty = checkoutSchema.safeParse({ ...baseCheckout, customerRut: '   ' });

    expect(valid.success).toBe(true);
    expect(valid.success && valid.data.customerRut).toBe('12.345.678-5');
    expect(empty.success).toBe(true);
    expect(empty.success && empty.data.customerRut).toBeNull();
  });

  it('rechaza un RUT inválido', () => {
    const result = checkoutSchema.safeParse({ ...baseCheckout, customerRut: '12.345.678-9' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain('RUT');
  });

  it('exige dirección cuando es despacho, pero no cuando es retiro', () => {
    const withoutAddress = checkoutSchema.safeParse({ ...baseCheckout, addressLine: '' });
    const pickup = checkoutSchema.safeParse({
      ...baseCheckout,
      deliveryMethod: 'PICKUP',
      addressLine: undefined,
    });

    expect(withoutAddress.success).toBe(false);
    expect(
      withoutAddress.success === false &&
        withoutAddress.error.issues.some((issue) => issue.path.join('.') === 'addressLine'),
    ).toBe(true);
    expect(pickup.success).toBe(true);
  });

  it('exige al menos un repuesto y cantidades razonables', () => {
    expect(checkoutSchema.safeParse({ ...baseCheckout, items: [] }).success).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...baseCheckout, items: [{ productId: 1, quantity: 0 }] }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...baseCheckout, items: [{ productId: 1, quantity: 51 }] }).success,
    ).toBe(false);
  });

  it('valida el código de seguimiento de la consulta pública', () => {
    expect(trackingCodeParamSchema.safeParse({ trackingCode: 'ALD-8F3K9PQR' }).success).toBe(true);
    expect(trackingCodeParamSchema.safeParse({ trackingCode: 'ALD-1' }).success).toBe(false);
  });
});

describe('Cambio de estado y tarifas (panel)', () => {
  it('acepta los estados válidos del pedido', async () => {
    const { orderStatusUpdateSchema } = await import('../../src/validators/order.schema');

    for (const status of ['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'] as const) {
      const payload =
        status === 'SHIPPED' ? { status, courierName: 'Chilexpress' } : { status };
      expect(orderStatusUpdateSchema.safeParse(payload).success).toBe(true);
    }
  });

  it('exige el courier al marcar como despachado', async () => {
    const { orderStatusUpdateSchema } = await import('../../src/validators/order.schema');

    const result = orderStatusUpdateSchema.safeParse({ status: 'SHIPPED' });

    expect(result.success).toBe(false);
    expect(
      result.success === false && result.error.issues.some((issue) => issue.path.join('.') === 'courierName'),
    ).toBe(true);
  });

  it('rechaza un estado inexistente', async () => {
    const { orderStatusUpdateSchema } = await import('../../src/validators/order.schema');

    expect(orderStatusUpdateSchema.safeParse({ status: 'ENVIADO' }).success).toBe(false);
  });

  it('valida la tarifa de envío (pesos enteros, sin negativos)', async () => {
    const { shippingRateUpdateSchema } = await import('../../src/validators/order.schema');

    expect(shippingRateUpdateSchema.safeParse({ baseCostClp: 3990 }).success).toBe(true);
    expect(shippingRateUpdateSchema.safeParse({ baseCostClp: -1 }).success).toBe(false);
    expect(shippingRateUpdateSchema.safeParse({ baseCostClp: 3990.5 }).success).toBe(false);
    expect(shippingRateUpdateSchema.safeParse({ estimatedDays: '2 a 3 días hábiles' }).success).toBe(true);
  });
});
