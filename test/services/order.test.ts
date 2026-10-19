import { describe, expect, it } from 'vitest';

import { formatOrderNumber, generateTrackingCode } from '../../src/services/order.service';

describe('Número de pedido y código de seguimiento', () => {
  it('arma el número de pedido como ALD-año-correlativo', () => {
    expect(formatOrderNumber(1, 2026)).toBe('ALD-2026-0001');
    expect(formatOrderNumber(42, 2026)).toBe('ALD-2026-0042');
    expect(formatOrderNumber(999, 2026)).toBe('ALD-2026-0999');
    expect(formatOrderNumber(1234, 2026)).toBe('ALD-2026-1234');
  });

  it('genera códigos de seguimiento con el formato de la tienda', () => {
    const code = generateTrackingCode();

    expect(code).toMatch(/^ALD-[A-Z2-9]{8}$/);
    // Sin caracteres que se confundan al dictarlos por teléfono.
    expect(code.slice(4)).not.toMatch(/[IO01]/);
  });

  it('no repite códigos en 500 intentos', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 500; index += 1) codes.add(generateTrackingCode());

    expect(codes.size).toBe(500);
  });
});
