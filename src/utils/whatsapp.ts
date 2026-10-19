/**
 * Generador de enlaces a WhatsApp (`https://wa.me/...`) con mensajes pre-armados.
 *
 * IMPORTANTE (restricción C-01 / RF-18): estos enlaces abren el WhatsApp **real**
 * de la tienda para que atienda una persona. Nunca hay respuestas automáticas ni IA.
 */

import { normalizePhone } from './chile';

export const WHATSAPP_BASE_URL = 'https://wa.me';

/**
 * Construye un enlace de WhatsApp con el mensaje ya escrito.
 * Devuelve `null` si el número no es un móvil chileno válido (mejor no mostrar un botón roto).
 */
export function buildWhatsAppUrl(phone: string, message?: string): string | null {
  const normalized = normalizePhone(phone);
  if (normalized === null) return null;

  // wa.me espera el número sin el signo "+".
  const url = `${WHATSAPP_BASE_URL}/${normalized.slice(1)}`;
  const text = message?.trim();

  return text ? `${url}?text=${encodeURIComponent(text)}` : url;
}

export interface ProductInquiryInput {
  productName: string;
  sku: string;
  /** Enlace público de la ficha del producto (opcional en desarrollo). */
  url?: string;
  storeName?: string;
}

/**
 * Mensaje pre-armado para consultar por un repuesto (RF-09 / HU-07).
 * Se usa en los productos `WHATSAPP_ONLY` y en el botón "¿Dudas técnicas?".
 */
export function buildProductInquiryMessage({
  productName,
  sku,
  url,
  storeName,
}: ProductInquiryInput): string {
  const lines = [
    `Hola${storeName ? `, soy cliente de ${storeName}` : ''}. Quiero consultar por este repuesto:`,
    '',
    `• Repuesto: ${productName}`,
    `• Código (SKU): ${sku}`,
  ];

  if (url) lines.push(`• Enlace: ${url}`);

  lines.push('', '¿Tienen disponibilidad y cuál es el precio final?');

  return lines.join('\n');
}
