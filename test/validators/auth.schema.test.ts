import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '../../src/validators/auth.schema';

describe('Validación del ingreso al panel', () => {
  it('normaliza el correo (sin espacios y en minúsculas)', () => {
    const result = loginSchema.safeParse({
      email: '  Contacto@AldosMotos.CL  ',
      password: 'AldosMotors2026!',
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe('contacto@aldosmotos.cl');
  });

  it('rechaza un correo inválido con mensaje en español', () => {
    const result = loginSchema.safeParse({ email: 'no-es-un-correo', password: 'x' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toBe(
      'Ingresa un correo electrónico válido.',
    );
  });

  it('exige la contraseña', () => {
    const result = loginSchema.safeParse({ email: 'contacto@aldosmotos.cl', password: '' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toBe('Ingresa tu contraseña.');
  });

  it('no aplica la política de contraseña nueva al ingreso (permite claves antiguas cortas)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.cl', password: 'corta' }).success).toBe(true);
  });
});

describe('Validación de la recuperación de contraseña', () => {
  it('acepta un correo correcto', () => {
    const result = forgotPasswordSchema.safeParse({ email: 'Contacto@AldosMotos.cl' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe('contacto@aldosmotos.cl');
  });

  it('exige un token de recuperación de largo razonable', () => {
    const result = resetPasswordSchema.safeParse({ token: 'corto', password: 'AldosMotors2026!' });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toBe(
      'El enlace de recuperación no es válido.',
    );
  });

  it(`exige al menos ${PASSWORD_MIN_LENGTH} caracteres en la contraseña nueva`, () => {
    const result = resetPasswordSchema.safeParse({
      token: 'x'.repeat(40),
      password: 'Ab1',
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain(
      `${PASSWORD_MIN_LENGTH} caracteres`,
    );
  });

  it('exige letras y números en la contraseña nueva', () => {
    const onlyLetters = resetPasswordSchema.safeParse({
      token: 'x'.repeat(40),
      password: 'abcdefghij',
    });
    const onlyNumbers = resetPasswordSchema.safeParse({
      token: 'x'.repeat(40),
      password: '1234567890',
    });

    expect(onlyLetters.success).toBe(false);
    expect(onlyNumbers.success).toBe(false);
  });

  it('acepta una contraseña nueva que cumple la política', () => {
    const result = resetPasswordSchema.safeParse({
      token: 'x'.repeat(40),
      password: 'AldosMotors2026!',
    });

    expect(result.success).toBe(true);
  });
});
