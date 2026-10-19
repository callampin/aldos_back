import { describe, expect, it } from 'vitest';

import { buildProductInquiryMessage, buildWhatsAppUrl } from '../../src/utils/whatsapp';

describe('Enlaces de WhatsApp (trato 100% humano, sin IA)', () => {
  it('arma el enlace con el número normalizado', () => {
    expect(buildWhatsAppUrl('+56912345678')).toBe('https://wa.me/56912345678');
    expect(buildWhatsAppUrl('912345678')).toBe('https://wa.me/56912345678');
  });

  it('codifica el mensaje en la URL', () => {
    const url = buildWhatsAppUrl('912345678', 'Hola, ¿tienen stock?');

    expect(url).not.toBeNull();
    expect(url?.startsWith('https://wa.me/56912345678?text=')).toBe(true);
    expect(url).toContain('%C2%BF'); // signo ¿ codificado
    expect(buildWhatsAppUrl('912345678', 'linea 1\nlinea 2')).toContain('%0A');
  });

  it('devuelve null si el número no es válido (no se muestra un botón roto)', () => {
    expect(buildWhatsAppUrl('123')).toBeNull();
    expect(buildWhatsAppUrl('+1 555 1234')).toBeNull();
  });

  it('pre-arma el mensaje de consulta de un repuesto (HU-07)', () => {
    const message = buildProductInquiryMessage({
      productName: 'Kit Pistón Original Honda XR 250R STD',
      sku: 'XR-PIST-250R-STD',
      url: 'https://aldosmotos.cl/producto/kit-piston-xr-250r-std',
      storeName: 'Aldos Motos',
    });

    expect(message).toContain('Kit Pistón Original Honda XR 250R STD');
    expect(message).toContain('XR-PIST-250R-STD');
    expect(message).toContain('https://aldosmotos.cl/producto/kit-piston-xr-250r-std');
    expect(message).toContain('Aldos Motos');
  });

  it('arma un mensaje más corto cuando no hay enlace ni nombre de tienda', () => {
    const message = buildProductInquiryMessage({
      productName: 'Carburador Keihin PWK 38',
      sku: 'EN-CARB-KEIHIN-300',
    });

    expect(message).toContain('Carburador Keihin PWK 38');
    expect(message).toContain('EN-CARB-KEIHIN-300');
    expect(message).not.toContain('Enlace:');
    expect(message).not.toContain('soy cliente de');
  });
});
