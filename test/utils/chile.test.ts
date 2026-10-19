import { describe, expect, it } from 'vitest';

import {
  cleanRut,
  computeRutDv,
  formatClp,
  formatPhone,
  formatRut,
  isValidClpAmount,
  isValidPhone,
  isValidRut,
  normalizePhone,
} from '../../src/utils/chile';

describe('RUT chileno (módulo 11)', () => {
  it('calcula el dígito verificador', () => {
    expect(computeRutDv('12345678')).toBe('5');
    expect(computeRutDv('22222222')).toBe('2');
    expect(computeRutDv('14')).toBe('0');
    expect(computeRutDv('6')).toBe('K');
  });

  it('valida RUT correctos', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('11.111.111-1')).toBe(true);
    expect(isValidRut('22222222-2')).toBe(true);
    expect(isValidRut('6-K')).toBe(true);
    expect(isValidRut('6-k')).toBe(true);
  });

  it('rechaza RUT inválidos', () => {
    expect(isValidRut('12.345.678-9')).toBe(false);
    expect(isValidRut('12.345.678-k')).toBe(false);
    expect(isValidRut('11.111.111-2')).toBe(false);
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('abc')).toBe(false);
    expect(isValidRut('12.345.678')).toBe(false);
    expect(isValidRut('0-0')).toBe(false);
  });

  it('limpia y formatea', () => {
    expect(cleanRut('12.345.678-k')).toBe('12345678K');
    expect(formatRut('12345678k')).toBe('12.345.678-K');
    expect(formatRut('12345678')).toBe('1.234.567-8');
    expect(formatRut('6k')).toBe('6-K');
  });
});

describe('Teléfonos móviles de Chile', () => {
  it('normaliza a +569XXXXXXXX', () => {
    expect(normalizePhone('912345678')).toBe('+56912345678');
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678');
    expect(normalizePhone('56912345678')).toBe('+56912345678');
    expect(normalizePhone('(9) 1234-5678')).toBe('+56912345678');
  });

  it('rechaza números que no son móviles chilenos', () => {
    expect(normalizePhone('91234567')).toBeNull();
    expect(normalizePhone('123456789')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('+1 555 1234')).toBeNull();
    expect(isValidPhone('912345678')).toBe(true);
    expect(isValidPhone('812345678')).toBe(false);
  });

  it('formatea para mostrar', () => {
    expect(formatPhone('+56912345678')).toBe('+56 9 1234 5678');
    expect(formatPhone('cualquier cosa')).toBe('cualquier cosa');
  });
});

describe('Montos en pesos chilenos (CLP)', () => {
  it('valida que sea un entero no negativo', () => {
    expect(isValidClpAmount(0)).toBe(true);
    expect(isValidClpAmount(300000)).toBe(true);
    expect(isValidClpAmount(-1)).toBe(false);
    expect(isValidClpAmount(1.5)).toBe(false);
    expect(isValidClpAmount(Number.NaN)).toBe(false);
    expect(isValidClpAmount(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isValidClpAmount('1000')).toBe(false);
  });

  it('formatea con separador de miles', () => {
    expect(formatClp(0)).toBe('$0');
    expect(formatClp(15990)).toBe('$15.990');
    expect(formatClp(300000)).toBe('$300.000');
    expect(formatClp(1234567)).toBe('$1.234.567');
    expect(formatClp(-500)).toBe('-$500');
  });
});
