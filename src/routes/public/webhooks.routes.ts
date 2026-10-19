import { Hono } from 'hono';

import { createDb } from '../../db';
import { requireAdmin, type AppEnv } from '../../middlewares/auth.middleware';
import { KhipuNotConfiguredError, getKhipuPayment, verifyKhipuWebhookSignature } from '../../services/payment-khipu.service';
import { markOrderPaid } from '../../services/order.service';
import { runInBackground, type BackgroundContextLike } from '../../utils/background';

/**
 * Webhook de notificaciones de Khipu (RF-05, HU-03).
 *
 * Seguridad (ver `NOTAS.md` H-11, confirmado con la documentación oficial):
 * 1. Se valida la cabecera `x-khipu-signature` = `t=<epoch ms>,s=<hmac>`: la firma es
 *    **HMAC-SHA256 en base64 sobre `"<timestamp>.<cuerpo crudo>"`**, con el secreto del
 *    comercio. El cuerpo **no** se reformatea antes de validar.
 * 2. Se descartan mensajes con más de 5 minutos (protección contra repetición).
 * 3. Se compara el monto notificado con el total guardado del pedido.
 * 4. Es idempotente: si el pedido ya estaba pagado no se vuelve a notificar.
 *
 * Siempre se responde `200` cuando el aviso es legítimo (aunque no haya nada que hacer),
 * porque Khipu reintenta hasta por dos días si no recibe un 200.
 */
export const publicWebhookRoutes = new Hono<AppEnv>();

interface KhipuEventPayload {
  payment_id?: unknown;
  transaction_id?: unknown;
  amount?: unknown;
  currency?: unknown;
  conciliation_date?: unknown;
  payer_email?: unknown;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readAmount(source: Record<string, unknown>): number | null {
  const value = source['amount'];

  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/** `POST /api/v1/public/webhooks/khipu` */
publicWebhookRoutes.post('/webhooks/khipu', async (c) => {
  // El cuerpo debe leerse como texto y en su forma original: la firma se calcula sobre él.
  const rawBody = await c.req.text();

  if (c.env.KHIPU_WEBHOOK_SECRET.length === 0) {
    console.error('[khipu] KHIPU_WEBHOOK_SECRET no configurado: no se puede validar la notificación.');
    return c.json(
      {
        ok: false as const,
        error: {
          code: 'WEBHOOK_NOT_CONFIGURED',
          message: 'La tienda no puede validar notificaciones de pago en este momento.',
        },
      },
      503,
    );
  }

  const isValid = await verifyKhipuWebhookSignature({
    secret: c.env.KHIPU_WEBHOOK_SECRET,
    header: c.req.header('x-khipu-signature'),
    rawBody,
  });

  if (!isValid) {
    // No se procesa nada: la notificación no es de Khipu, viene alterada o es muy antigua.
    console.warn('[khipu] Notificación con firma inválida descartada.');
    return c.json(
      {
        ok: false as const,
        error: { code: 'INVALID_SIGNATURE', message: 'La notificación no es válida.' },
      },
      400,
    );
  }

  let payload: KhipuEventPayload;
  try {
    payload = JSON.parse(rawBody) as KhipuEventPayload;
  } catch {
    return c.json(
      { ok: false as const, error: { code: 'INVALID_PAYLOAD', message: 'El aviso no es válido.' } },
      400,
    );
  }

  const source = payload as Record<string, unknown>;
  const orderNumber = readString(source, 'transaction_id');
  const paymentId = readString(source, 'payment_id');
  const amountClp = readAmount(source);
  const currency = readString(source, 'currency');

  if (orderNumber === null) {
    // Sin número de pedido no hay nada que conciliar, pero se responde 200 para no
    // generar reintentos por dos días sobre un mensaje que nunca vamos a poder usar.
    console.warn('[khipu] Notificación sin transaction_id: se ignora.');
    return c.json({ ok: true as const, data: { ignored: true, reason: 'SIN_PEDIDO' } });
  }

  if (currency !== null && currency !== 'CLP') {
    console.error(`[khipu] Moneda inesperada (${currency}) en el pedido ${orderNumber}.`);
    return c.json(
      { ok: false as const, error: { code: 'UNEXPECTED_CURRENCY', message: 'Moneda no soportada.' } },
      400,
    );
  }

  const db = createDb(c.env.DB);
  const conciliationDate = readString(source, 'conciliation_date');
  const parsedDate = conciliationDate === null ? null : new Date(conciliationDate);

  const result = await markOrderPaid(
    db,
    {
      orderNumber,
      paymentId,
      amountClp,
      paidAt: parsedDate !== null && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date(),
    },
    {
      env: c.env,
      frontendUrl: c.env.FRONTEND_URL,
      deliver: (promise) => runInBackground(c as unknown as BackgroundContextLike, promise),
    },
  );

  if (result.status === 'amount_mismatch') {
    return c.json(
      {
        ok: false as const,
        error: { code: 'AMOUNT_MISMATCH', message: 'El monto del pago no coincide con el pedido.' },
      },
      409,
    );
  }

  return c.json({ ok: true as const, data: { status: result.status, orderNumber: result.orderNumber } });
});

/**
 * `GET /api/v1/public/webhooks/khipu/status/:paymentId`
 *
 * Consulta el estado real del cobro en Khipu. Es la vía de reconciliación cuando el
 * webhook no llegó (por ejemplo, durante el desarrollo o si hubo un problema de red).
 * Protegido con `requireAdmin` para que solo Estrella pueda gatillar reconciliaciones (H-17.7).
 */
publicWebhookRoutes.get('/webhooks/khipu/status/:paymentId', requireAdmin, async (c) => {
  const paymentId = c.req.param('paymentId');
  const db = createDb(c.env.DB);

  try {
    const status = await getKhipuPayment(c.env, paymentId);

    if (status === null) {
      return c.json(
        { ok: false as const, error: { code: 'PAYMENT_NOT_FOUND', message: 'Ese cobro no existe en Khipu.' } },
        404,
      );
    }

    // Si Khipu dice que el pago está listo, se concilia el pedido con la misma lógica
    // del webhook (idempotente).
    let reconciled: string | null = null;
    if (status.status === 'done' && status.transactionId !== null) {
      const result = await markOrderPaid(
        db,
        {
          orderNumber: status.transactionId,
          paymentId: status.paymentId,
          amountClp: status.amount,
          paidAt: new Date(),
        },
        {
          env: c.env,
          frontendUrl: c.env.FRONTEND_URL,
          deliver: (promise) => runInBackground(c as unknown as BackgroundContextLike, promise),
        },
      );
      reconciled = result.status;
    }

    return c.json({
      ok: true as const,
      data: {
        paymentId: status.paymentId,
        status: status.status,
        amount: status.amount,
        currency: status.currency,
        orderNumber: status.transactionId,
        reconciled,
      },
    });
  } catch (error) {
    if (error instanceof KhipuNotConfiguredError) {
      return c.json(
        {
          ok: false as const,
          error: {
            code: 'KHIPU_NOT_CONFIGURED',
            message: 'La pasarela de pago en línea todavía no está configurada.',
          },
        },
        503,
      );
    }

    console.error('[khipu] No se pudo consultar el cobro:', error);
    return c.json(
      {
        ok: false as const,
        error: {
          code: 'KHIPU_UNAVAILABLE',
          message: 'No pudimos consultar el pago en Khipu. Intenta nuevamente en unos minutos.',
        },
      },
      502,
    );
  }
});
