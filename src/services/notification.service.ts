import type { Env } from '../types/bindings';
import { formatClp } from '../utils/chile';
import { buildWhatsAppUrl } from '../utils/whatsapp';

/**
 * Envío de correos transaccionales con Resend.
 *
 * IMPORTANTE (restricción C-01 / RF-18): aquí solo se envían avisos de una sola vía
 * (recuperación de contraseña, confirmación de pedido, aviso a Estrella). Nunca hay
 * respuestas automáticas ni asistentes: toda consulta se deriva al WhatsApp real.
 *
 * NOTA (ver `NOTAS.md` H-12): el archivo se adelantó desde el Paso 11 solo con el envío
 * de correo, porque el flujo de recuperación de contraseña (Paso 6) lo necesita.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** Remitente por defecto (debe ser un dominio validado en Resend). */
export const STORE_FROM_EMAIL = 'Aldos Motos <contacto@aldosmotos.cl>';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

/** `true` si hay una API key de Resend configurada. */
export function isEmailConfigured(env: Env): boolean {
  return typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.length > 0;
}

/**
 * Envía un correo transaccional. Nunca lanza excepción: devuelve `true`/`false` y
 * deja el detalle en el log, para no romper el flujo del cliente si Resend falla.
 */
export async function sendTransactionalEmail(env: Env, input: SendEmailInput): Promise<boolean> {
  if (!isEmailConfigured(env)) {
    console.warn(
      `[email] RESEND_API_KEY no está configurada; no se envió "${input.subject}" a ${input.to}.`,
    );
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: STORE_FROM_EMAIL,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    if (!response.ok) {
      console.error(`[email] Resend respondió ${response.status}: ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[email] No se pudo enviar el correo:', error);
    return false;
  }
}

export interface PasswordResetEmailInput {
  adminName: string;
  resetUrl: string;
  expiresMinutes: number;
}/** Arma el correo de recuperación de contraseña del panel. */
export function buildPasswordResetEmail({
  adminName,
  resetUrl,
  expiresMinutes,
}: PasswordResetEmailInput): { subject: string; html: string } {
  return {
    subject: 'Recuperar tu contraseña — Aldos Motos',
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
      <h1 style="margin:0 0 12px;font-size:20px;">Recuperar tu contraseña</h1>
      <p style="margin:0 0 16px;line-height:1.5;">Hola ${adminName}, recibimos una solicitud para cambiar la contraseña del panel de administración.</p>
      <p style="margin:0 0 24px;">
        <a href="${resetUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">Crear una contraseña nueva</a>
      </p>
      <p style="margin:0 0 16px;line-height:1.5;font-size:14px;color:#52525b;">El enlace vence en ${expiresMinutes} minutos y sirve una sola vez.</p>
      <p style="margin:0 0 8px;line-height:1.5;font-size:14px;color:#52525b;">Si no pediste este cambio, ignora este correo: tu contraseña actual sigue funcionando.</p>
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
      <p style="margin:0;font-size:12px;color:#71717a;">¿Dudas? Escríbenos por WhatsApp y te atiende una persona del taller. Este correo se genera automáticamente, no respondas a él.</p>
    </div>
  </body>
</html>`,
  };
}

// ---------------------------------------------------------------------------
// Correos de pedidos (RF-06 / HU-03)
// ---------------------------------------------------------------------------

export interface OrderEmailItem {
  sku: string;
  name: string;
  quantity: number;
  unitPriceClp: number;
  lineTotalClp: number;
  /** Unidades que quedan en bodega después de esta venta (así Estrella las ubica). */
  stockLeft?: number | null;
}

export interface OrderEmailData {
  orderNumber: string;
  trackingCode: string;
  customerName: string;
  customerRut: string | null;
  customerEmail: string;
  customerPhone: string;
  deliveryMethod: string;
  regionName: string;
  comuna: string;
  addressLine: string;
  addressReference: string | null;
  customerNotes: string | null;
  subtotalClp: number;
  shippingCostClp: number;
  totalClp: number;
  paymentMethod: string;
  items: OrderEmailItem[];
  trackingUrl: string;
  /** Enlace de WhatsApp con el cliente y mensaje pre-armado. */
  customerWhatsAppUrl: string | null;
}

/** Escapa texto para incrustarlo en el HTML del correo. */
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function emailShell(title: string, intro: string, content: string, footer: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;">
      <h1 style="margin:0 0 8px;font-size:20px;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 16px;line-height:1.5;">${intro}</p>
      ${content}
      <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
      <p style="margin:0;font-size:12px;color:#71717a;">${footer}</p>
    </div>
  </body>
</html>`;
}

function itemsTable(items: OrderEmailItem[], options: { showStock?: boolean } = {}): string {
  const rows = items
    .map(
      (item) => `<tr>
        <td style="padding:8px;border-bottom:1px solid #e4e4e7;font-size:13px;">${escapeHtml(item.sku)}</td>
        <td style="padding:8px;border-bottom:1px solid #e4e4e7;font-size:13px;">${escapeHtml(item.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #e4e4e7;font-size:13px;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e4e4e7;font-size:13px;text-align:right;">${escapeHtml(formatClp(item.lineTotalClp))}</td>
        ${
          options.showStock
            ? `<td style="padding:8px;border-bottom:1px solid #e4e4e7;font-size:13px;text-align:center;">${
                item.stockLeft === null || item.stockLeft === undefined ? '—' : item.stockLeft
              }</td>`
            : ''
        }
      </tr>`,
    )
    .join('');

  return `<table style="width:100%;border-collapse:collapse;margin:8px 0 12px;">
    <thead>
      <tr>
        <th style="text-align:left;padding:8px;font-size:12px;color:#52525b;">Código</th>
        <th style="text-align:left;padding:8px;font-size:12px;color:#52525b;">Repuesto</th>
        <th style="padding:8px;font-size:12px;color:#52525b;">Cant.</th>
        <th style="text-align:right;padding:8px;font-size:12px;color:#52525b;">Total</th>
        ${options.showStock ? '<th style="padding:8px;font-size:12px;color:#52525b;">Quedan</th>' : ''}
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsBlock(data: OrderEmailData): string {
  return `<table style="width:100%;border-collapse:collapse;">
    <tr><td style="padding:4px 8px;font-size:13px;">Repuestos</td><td style="padding:4px 8px;font-size:13px;text-align:right;">${escapeHtml(formatClp(data.subtotalClp))}</td></tr>
    <tr><td style="padding:4px 8px;font-size:13px;">Envío</td><td style="padding:4px 8px;font-size:13px;text-align:right;">${data.shippingCostClp === 0 ? 'Sin costo' : escapeHtml(formatClp(data.shippingCostClp))}</td></tr>
    <tr><td style="padding:8px;font-size:15px;font-weight:bold;border-top:1px solid #e4e4e7;">Total</td><td style="padding:8px;font-size:15px;font-weight:bold;text-align:right;border-top:1px solid #e4e4e7;">${escapeHtml(formatClp(data.totalClp))}</td></tr>
  </table>`;
}

function deliveryBlock(data: OrderEmailData): string {
  if (data.deliveryMethod === 'PICKUP') {
    return `<p style="margin:0 0 12px;line-height:1.5;font-size:14px;"><strong>Entrega:</strong> retiro en el taller.</p>`;
  }

  return `<p style="margin:0 0 12px;line-height:1.5;font-size:14px;">
    <strong>Despacho a:</strong> ${escapeHtml(data.addressLine)}<br />
    ${escapeHtml(data.comuna)}, ${escapeHtml(data.regionName)}
    ${data.addressReference ? `<br /><em>Referencia: ${escapeHtml(data.addressReference)}</em>` : ''}
  </p>`;
}

/** Correo de comprobante para el comprador. */
export function buildCustomerReceiptEmail(data: OrderEmailData): { subject: string; html: string } {
  const intro = `Hola ${escapeHtml(data.customerName)}, recibimos tu pedido <strong>${escapeHtml(data.orderNumber)}</strong> y ya quedó registrado.`;

  const content = `
    ${itemsTable(data.items)}
    ${totalsBlock(data)}
    ${deliveryBlock(data)}
    <p style="margin:0 0 16px;line-height:1.5;font-size:14px;">
      <strong>Tu código de seguimiento:</strong> <span style="font-family:monospace;font-size:16px;">${escapeHtml(data.trackingCode)}</span><br />
      <a href="${escapeHtml(data.trackingUrl)}" style="color:#dc2626;">Ver el estado de mi pedido</a>
    </p>
    ${
      data.customerWhatsAppUrl
        ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(data.customerWhatsAppUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Escribirnos por WhatsApp</a></p>`
        : ''
    }`;

  return {
    subject: `Tu pedido ${data.orderNumber} — Aldos Motos`,
    html: emailShell(
      '¡Gracias por tu compra!',
      intro,
      content,
      'Si tienes dudas técnicas, escríbenos por WhatsApp: te atiende una persona del taller (Aldo). Este correo se genera automáticamente, no respondas a él.',
    ),
  };
}

/**
 * Aviso prioritario a Estrella (HU-03): todo lo que necesita para embalar y despachar
 * el mismo día, con el botón directo al WhatsApp del cliente.
 */
export function buildStorePaidOrderEmail(data: OrderEmailData): { subject: string; html: string } {
  const intro = `El pedido <strong>${escapeHtml(data.orderNumber)}</strong> está <strong>PAGADO</strong> y listo para embalar y despachar hoy.`;

  const content = `
    ${itemsTable(data.items, { showStock: true })}
    ${totalsBlock(data)}
    ${deliveryBlock(data)}
    <p style="margin:0 0 12px;line-height:1.5;font-size:14px;">
      <strong>Cliente:</strong> ${escapeHtml(data.customerName)}${
        data.customerRut ? ` · RUT ${escapeHtml(data.customerRut)}` : ''
      }<br />
      <strong>Teléfono:</strong> ${escapeHtml(data.customerPhone)}<br />
      <strong>Correo:</strong> ${escapeHtml(data.customerEmail)}<br />
      <strong>Pago:</strong> ${data.paymentMethod === 'KHIPU' ? 'Khipu (verificado)' : 'Transferencia bancaria'}
      ${data.customerNotes ? `<br /><strong>Nota del cliente:</strong> ${escapeHtml(data.customerNotes)}` : ''}
    </p>
    ${
      data.customerWhatsAppUrl
        ? `<p style="margin:0 0 16px;"><a href="${escapeHtml(data.customerWhatsAppUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">Avisarle por WhatsApp</a></p>`
        : ''
    }
    <p style="margin:0;line-height:1.5;font-size:14px;">
      <a href="${escapeHtml(data.trackingUrl)}" style="color:#dc2626;">Ver la ficha del pedido</a>
    </p>`;

  return {
    subject: `🛠️ Pedido pagado ${data.orderNumber} — embalar y despachar hoy`,
    html: emailShell(
      'Pedido pagado: listo para despachar',
      intro,
      content,
      'Aviso automático de la tienda. La columna "Quedan" muestra las unidades que quedan en bodega después de esta venta.',
    ),
  };
}

/** Envía el comprobante al comprador. Nunca lanza excepción (devuelve `false` si falla). */
export async function sendCustomerReceiptEmail(env: Env, data: OrderEmailData): Promise<boolean> {
  const mail = buildCustomerReceiptEmail(data);
  return sendTransactionalEmail(env, { to: data.customerEmail, ...mail });
}

/** Avisa a Estrella que el pedido está pagado. Nunca lanza excepción. */
export async function notifyStoreAboutPaidOrder(
  env: Env,
  data: OrderEmailData,
  recipients: string[],
): Promise<boolean> {
  if (recipients.length === 0) {
    console.warn(`[email] No hay correo de la tienda configurado; no se avisó del pedido ${data.orderNumber}.`);
    return false;
  }

  const mail = buildStorePaidOrderEmail(data);
  const results = await Promise.all(
    recipients.map((to) => sendTransactionalEmail(env, { to, ...mail, replyTo: data.customerEmail })),
  );

  return results.some(Boolean);
}

/** Enlace de WhatsApp de la tienda con el cliente, con el mensaje de despacho pre-armado. */
export function buildStoreToCustomerWhatsAppUrl(
  storePhone: string,
  data: Pick<OrderEmailData, 'customerName' | 'orderNumber' | 'items' | 'trackingCode'>,
  storeName = 'Aldos Motos',
): string | null {
  const detail = data.items.map((item) => `${item.quantity}x ${item.name}`).join(', ');
  const message = `Hola ${data.customerName}, soy Estrella de ${storeName}. Recibimos tu pedido ${data.orderNumber} (${detail}) y ya lo estamos preparando para despacharlo hoy mismo. Te aviso apenas salga con el courier. Tu código de seguimiento es ${data.trackingCode}.`;

  return buildWhatsAppUrl(storePhone, message);
}

/** Correos de la tienda que reciben los avisos: `notification_emails` o, si no está, `store_email`. */
export function resolveStoreRecipients(settings: Record<string, string>): string[] {
  const configured = settings['notification_emails'];
  const fallback = settings['store_email'];

  const source = configured && configured.trim().length > 0 ? configured : (fallback ?? '');

  return source
    .split(/[,;]/)
    .map((email) => email.trim())
    .filter((email) => email.length > 3 && email.includes('@'));
}

/** Correo al comprador con los datos para hacer la transferencia bancaria. */
export function buildCustomerTransferInstructionsEmail(
  data: OrderEmailData,
  bankTransfer: Record<string, string | null>,
): { subject: string; html: string } {
  const labelByKey: Record<string, string> = {
    banco: 'Banco',
    tipo_cuenta: 'Tipo de cuenta',
    numero: 'Número de cuenta',
    titular: 'Titular',
    rut: 'RUT',
    email: 'Correo',
  };

  const rows = Object.entries(bankTransfer)
    .map(
      ([key, value]) => `<tr>
        <td style="padding:6px 8px;font-size:13px;color:#52525b;">${escapeHtml(labelByKey[key] ?? key)}</td>
        <td style="padding:6px 8px;font-size:13px;font-weight:bold;">${escapeHtml(value ?? '—')}</td>
      </tr>`,
    )
    .join('');

  const content = `
    ${itemsTable(data.items)}
    ${totalsBlock(data)}
    <p style="margin:0 0 12px;line-height:1.5;font-size:14px;">Transfiere el total del pedido a esta cuenta:</p>
    <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;">${rows}</table>
    <p style="margin:16px 0;line-height:1.5;font-size:14px;">
      Cuando esté hecha, respóndenos por WhatsApp con el comprobante y marcamos tu pedido como pagado para despacharlo el mismo día.
    </p>
    <p style="margin:0 0 16px;line-height:1.5;font-size:14px;">
      <strong>Tu código de seguimiento:</strong> <span style="font-family:monospace;font-size:16px;">${escapeHtml(data.trackingCode)}</span><br />
      <a href="${escapeHtml(data.trackingUrl)}" style="color:#dc2626;">Ver el estado de mi pedido</a>
    </p>
    ${
      data.customerWhatsAppUrl
        ? `<p style="margin:0;"><a href="${escapeHtml(data.customerWhatsAppUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Enviar comprobante por WhatsApp</a></p>`
        : ''
    }`;

  return {
    subject: `Pedido ${data.orderNumber} registrado — datos para transferir`,
    html: emailShell(
      'Tu pedido quedó registrado',
      `Hola ${escapeHtml(data.customerName)}, guardamos tu pedido <strong>${escapeHtml(data.orderNumber)}</strong> y reservamos los repuestos.`,
      content,
      'Te atiende una persona del taller por WhatsApp. Este correo se genera automáticamente, no respondas a él.',
    ),
  };
}

/** Aviso a Estrella de un pedido que espera confirmación (transferencia o link de pago pendiente). */
export function buildStorePendingOrderEmail(
  data: OrderEmailData,
  note: string,
): { subject: string; html: string } {
  const content = `
    ${itemsTable(data.items, { showStock: true })}
    ${totalsBlock(data)}
    ${deliveryBlock(data)}
    <p style="margin:0 0 12px;line-height:1.5;font-size:14px;">
      <strong>Cliente:</strong> ${escapeHtml(data.customerName)}<br />
      <strong>Teléfono:</strong> ${escapeHtml(data.customerPhone)}<br />
      <strong>Correo:</strong> ${escapeHtml(data.customerEmail)}<br />
      <strong>Medio de pago:</strong> ${data.paymentMethod === 'KHIPU' ? 'Khipu' : 'Transferencia bancaria'}
    </p>
    <p style="margin:0 0 16px;line-height:1.5;font-size:14px;background:#fffbeb;padding:12px;border-radius:8px;">${escapeHtml(note)}</p>
    ${
      data.customerWhatsAppUrl
        ? `<p style="margin:0;"><a href="${escapeHtml(data.customerWhatsAppUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:14px 22px;border-radius:8px;text-decoration:none;font-weight:bold;">Escribirle por WhatsApp</a></p>`
        : ''
    }`;

  return {
    subject: `🟡 Pedido por confirmar ${data.orderNumber} — Aldos Motos`,
    html: emailShell(
      'Pedido nuevo esperando confirmación',
      `El pedido <strong>${escapeHtml(data.orderNumber)}</strong> quedó registrado y el stock está reservado.`,
      content,
      'Aviso automático de la tienda. La columna "Quedan" muestra las unidades que quedan en bodega.',
    ),
  };
}

/** Envía las instrucciones de transferencia al comprador. Nunca lanza excepción. */
export async function sendCustomerTransferInstructionsEmail(
  env: Env,
  data: OrderEmailData,
  bankTransfer: Record<string, string | null>,
): Promise<boolean> {
  const mail = buildCustomerTransferInstructionsEmail(data, bankTransfer);
  return sendTransactionalEmail(env, { to: data.customerEmail, ...mail });
}

/** Avisa a Estrella de un pedido pendiente. Nunca lanza excepción. */
export async function notifyStoreAboutPendingOrder(
  env: Env,
  data: OrderEmailData,
  recipients: string[],
  note: string,
): Promise<boolean> {
  if (recipients.length === 0) {
    console.warn(`[email] No hay correo de la tienda configurado; no se avisó del pedido ${data.orderNumber}.`);
    return false;
  }

  const mail = buildStorePendingOrderEmail(data, note);
  const results = await Promise.all(
    recipients.map((to) => sendTransactionalEmail(env, { to, ...mail, replyTo: data.customerEmail })),
  );

  return results.some(Boolean);
}

/** Correo al comprador cuando Estrella despacha el pedido (RF-08). */
export function buildOrderShippedEmail(
  data: OrderEmailData & { courierName: string | null; courierTrackingNumber: string | null },
): { subject: string; html: string } {
  const courier = data.courierName ?? 'el courier';
  const tracking = data.courierTrackingNumber;

  const content = `
    ${itemsTable(data.items)}
    ${totalsBlock(data)}
    ${deliveryBlock(data)}
    <p style="margin:0 0 12px;line-height:1.5;font-size:14px;">
      <strong>Despachado por:</strong> ${escapeHtml(courier)}
      ${tracking ? `<br /><strong>N° de seguimiento:</strong> <span style="font-family:monospace;font-size:15px;">${escapeHtml(tracking)}</span>` : ''}
    </p>
    <p style="margin:0 0 16px;line-height:1.5;font-size:14px;">
      <a href="${escapeHtml(data.trackingUrl)}" style="color:#dc2626;">Ver el estado de mi pedido</a>
    </p>
    ${
      data.customerWhatsAppUrl
        ? `<p style="margin:0;"><a href="${escapeHtml(data.customerWhatsAppUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Consultar por WhatsApp</a></p>`
        : ''
    }`;

  return {
    subject: `Tu pedido ${data.orderNumber} ya fue despachado — Aldos Motos`,
    html: emailShell(
      '¡Tu pedido va en camino!',
      `Hola ${escapeHtml(data.customerName)}, ya despachamos tu pedido <strong>${escapeHtml(data.orderNumber)}</strong>.`,
      content,
      'Si tienes dudas del despacho, escríbenos por WhatsApp: te atiende una persona del taller. Este correo se genera automáticamente, no respondas a él.',
    ),
  };
}

/** Envía el aviso de despacho al comprador. Nunca lanza excepción. */
export async function sendCustomerShippedEmail(
  env: Env,
  data: OrderEmailData & { courierName: string | null; courierTrackingNumber: string | null },
): Promise<boolean> {
  const mail = buildOrderShippedEmail(data);
  return sendTransactionalEmail(env, { to: data.customerEmail, ...mail });
}
