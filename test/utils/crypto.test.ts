import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  signHmacSha256,
  verifyHmacSha256,
  verifyPassword,
} from '../../src/utils/crypto';

describe('Hashing de contraseñas (PBKDF2-SHA256)', () => {
  it('genera un hash con formato propio y salt aleatorio', async () => {
    const first = await hashPassword('AldosMotors2026!');
    const second = await hashPassword('AldosMotors2026!');

    const parts = first.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2-sha256');
    expect(parts[1]).toBe('210000');
    expect(first).not.toBe(second); // salt aleatorio distinto
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const stored = await hashPassword('AldosMotors2026!');

    await expect(verifyPassword('AldosMotors2026!', stored)).resolves.toBe(true);
    await expect(verifyPassword('AldosMotors2026', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('nunca lanza excepción con un hash mal formado', async () => {
    await expect(verifyPassword('x', 'basura')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
    await expect(verifyPassword('x', 'pbkdf2-sha256$abc$salt$hash')).resolves.toBe(false);
    await expect(verifyPassword('x', 'md5$1000$c2FsdA==$aGFzaA==')).resolves.toBe(false);
  });
});

describe('Firma HMAC-SHA256 (webhooks Khipu)', () => {
  const payload = 'The quick brown fox jumps over the lazy dog';

  it('coincide con el vector de prueba conocido', async () => {
    const expected = 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8';
    await expect(signHmacSha256('key', payload, 'hex')).resolves.toBe(expected);
  });

  it('es determinista y depende del secreto y del payload', async () => {
    const first = await signHmacSha256('secreto', payload);
    const second = await signHmacSha256('secreto', payload);
    const otherSecret = await signHmacSha256('otro-secreto', payload);
    const otherPayload = await signHmacSha256('secreto', `${payload} `);

    expect(first).toBe(second);
    expect(first).not.toBe(otherSecret);
    expect(first).not.toBe(otherPayload);
  });

  it('verifica firmas válidas en base64 y hexadecimal', async () => {
    const base64 = await signHmacSha256('secreto', payload);
    const hex = await signHmacSha256('secreto', payload, 'hex');

    await expect(verifyHmacSha256('secreto', payload, base64)).resolves.toBe(true);
    await expect(verifyHmacSha256('secreto', payload, hex, 'hex')).resolves.toBe(true);
  });

  it('rechaza firmas manipuladas o mal formadas', async () => {
    const hex = await signHmacSha256('secreto', payload, 'hex');
    const tampered = `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;

    await expect(verifyHmacSha256('secreto', payload, tampered, 'hex')).resolves.toBe(false);
    await expect(verifyHmacSha256('otro-secreto', payload, hex, 'hex')).resolves.toBe(false);
    await expect(verifyHmacSha256('secreto', `${payload}x`, hex, 'hex')).resolves.toBe(false);
    await expect(verifyHmacSha256('secreto', payload, 'zz', 'hex')).resolves.toBe(false);
    await expect(verifyHmacSha256('secreto', payload, 'abc', 'hex')).resolves.toBe(false);
    await expect(verifyHmacSha256('secreto', payload, '')).resolves.toBe(false);
  });
});
