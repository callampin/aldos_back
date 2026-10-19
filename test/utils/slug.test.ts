import { describe, expect, it } from 'vitest';

import { buildProductSlug, slugify } from '../../src/utils/slug';

describe('Generador de slugs para SEO (RNF-08)', () => {
  it('convierte nombres de repuestos en slugs limpios', () => {
    expect(slugify('Kit Pistón Original Honda XR 250R (STD)')).toBe(
      'kit-piston-original-honda-xr-250r-std',
    );
    expect(slugify('  ¡Aceite 10W40 — Motul!  ')).toBe('aceite-10w40-motul');
    expect(slugify('Filtro de aire Honda XR 250R')).toBe('filtro-de-aire-honda-xr-250r');
  });

  it('quita tildes y la letra ñ', () => {
    expect(slugify('Ñuñoa Ñandú')).toBe('nunoa-nandu');
    expect(slugify('Suspensión KTM EXC 300')).toBe('suspension-ktm-exc-300');
  });

  it('no deja guiones al inicio, al final ni repetidos', () => {
    expect(slugify('---Motor---')).toBe('motor');
    expect(slugify('a   b')).toBe('a-b');
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });

  it('respeta el largo máximo sin cortar en guion', () => {
    const long = 'uno dos tres cuatro cinco seis siete ocho nueve diez once doce';
    const slug = slugify(long, 20);

    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith('-')).toBe(false);
    expect(long.startsWith(slug.replace(/-/g, ' ').split(' ')[0] ?? '')).toBe(true);
  });

  it('arma el slug de un producto incluyendo el SKU', () => {
    expect(buildProductSlug('XR-PIST-250R-STD', 'Kit Pistón Original')).toBe(
      'xr-pist-250r-std-kit-piston-original',
    );
  });
});
