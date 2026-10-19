import { describe, expect, it } from 'vitest';

/**
 * Guardia de entorno: confirma que la suite corre **dentro del runtime de Cloudflare
 * Workers** (workerd) y no en Node, tal como exige `back/AGENTS.md` §2.
 * Si algún día la configuración de Vitest deja de usar el plugin de Cloudflare,
 * este test fallará y nos avisará.
 */
describe('Runtime de las pruebas', () => {
  it('corre en Cloudflare Workers (workerd)', () => {
    expect(navigator.userAgent).toBe('Cloudflare-Workers');
  });

  it('tiene Web Crypto disponible (necesario para PBKDF2 y HMAC)', () => {
    expect(typeof crypto.subtle.deriveBits).toBe('function');
    expect(typeof crypto.subtle.sign).toBe('function');
  });
});
