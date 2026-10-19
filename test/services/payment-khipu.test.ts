import { describe, expect, it, vi } from 'vitest';

import {
  KhipuApiError,
  KhipuNotConfiguredError,
  createKhipuPayment,
  getKhipuPayment,
  parseKhipuSignatureHeader,
  verifyKhipuWebhookSignature,
} from '../../src/services/payment-khipu.service';
import type { Env } from '../../src/types/bindings';

const env = { KHIPU_API_KEY: 'clave-de-prueba' } as unknown as Env;
const envSinClave = { KHIPU_API_KEY: '' } as unknown as Env;

/**
 * Vector de prueba tomado de la documentación oficial de Khipu
 * (`docs.khipu.com` → Pagos Instantáneos → Notificaciones → Verificación de la firma).
 * El cuerpo lleva `\/` (barras escapadas) porque es el cuerpo **crudo** que se firma.
 */
const DOCS_SECRET = '1a4cbbbeb8bdb7e1d73572b9cc43ce4ce18f79d9';
const DOCS_TIMESTAMP = '1711965600393';
const DOCS_SIGNATURE = 'rq08YUGSaWa1D0RAwhMnJTRHMNmY4ToCn2Gd6G9LaDg=';
const DOCS_BODY = String.raw`{"payment_id":"zfxnocsow6mz","receiver_id":990939,"subject":"TEST_COBRO","amount":"1000.0000","discount":"0.0000","currency":"CLP","receipt_url":"https:\/\/s3.amazonaws.com\/staging.notifications.khipu.com\/CPKH-1804240956-zfxnocsow6mz.pdf","bank":"DemoBank","bank_id":"Bawdf","payer_name":"Cobrador de desarrollo #990.939","payer_email":"test@khipu.com","personal_identifier":"44.444.444-4","bank_account_number":"000000000000444444444","out_of_date_conciliation":false,"transaction_id":"15f836bd-e8a7-4d12-b2f1-56403012b555","authorizer_operation_code":"AUT-20240418-0001","responsible_user_email":"test@khipu.com","payment_method":"simplified_transfer","conciliation_date":"2024-04-18T13:56:54.859Z"}`;

describe('Firma del webhook de Khipu', () => {
  it('valida el ejemplo oficial de la documentación', async () => {
    const result = await verifyKhipuWebhookSignature({
      secret: DOCS_SECRET,
      header: `t=${DOCS_TIMESTAMP},s=${DOCS_SIGNATURE}`,
      rawBody: DOCS_BODY,
      now: Number(DOCS_TIMESTAMP),
    });

    expect(result).toBe(true);
  });

  it('rechaza el cuerpo si fue alterado', async () => {
    const tampered = DOCS_BODY.replace('TEST_COBRO', 'TEST_COBRO2');

    await expect(
      verifyKhipuWebhookSignature({
        secret: DOCS_SECRET,
        header: `t=${DOCS_TIMESTAMP},s=${DOCS_SIGNATURE}`,
        rawBody: tampered,
        now: Number(DOCS_TIMESTAMP),
      }),
    ).resolves.toBe(false);
  });

  it('rechaza la firma hecha con otro secreto', async () => {
    await expect(
      verifyKhipuWebhookSignature({
        secret: 'otro-secreto',
        header: `t=${DOCS_TIMESTAMP},s=${DOCS_SIGNATURE}`,
        rawBody: DOCS_BODY,
        now: Number(DOCS_TIMESTAMP),
      }),
    ).resolves.toBe(false);
  });

  it('descarta notificaciones antiguas (protección contra repetición)', async () => {
    await expect(
      verifyKhipuWebhookSignature({
        secret: DOCS_SECRET,
        header: `t=${DOCS_TIMESTAMP},s=${DOCS_SIGNATURE}`,
        rawBody: DOCS_BODY,
        now: Number(DOCS_TIMESTAMP) + 10 * 60 * 1000,
      }),
    ).resolves.toBe(false);

    // Justo dentro de la ventana de 5 minutos: sigue siendo válida.
    await expect(
      verifyKhipuWebhookSignature({
        secret: DOCS_SECRET,
        header: `t=${DOCS_TIMESTAMP},s=${DOCS_SIGNATURE}`,
        rawBody: DOCS_BODY,
        now: Number(DOCS_TIMESTAMP) + 4 * 60 * 1000,
      }),
    ).resolves.toBe(true);
  });

  it('rechaza cabeceras mal formadas', async () => {
    const headers = [null, undefined, '', 't=123', 's=abc', 'basura', 't=,s='];

    for (const header of headers) {
      await expect(
        verifyKhipuWebhookSignature({
          secret: DOCS_SECRET,
          header,
          rawBody: DOCS_BODY,
          now: Number(DOCS_TIMESTAMP),
        }),
      ).resolves.toBe(false);
    }
  });

  it('lee la cabecera con espacios y atributos extra', () => {
    expect(parseKhipuSignatureHeader('t=1711965600393,s=rq08YUGS=')).toEqual({
      timestamp: '1711965600393',
      signature: 'rq08YUGS=',
    });
    expect(parseKhipuSignatureHeader(' t=1 , s=abc , extra=1 ')).toEqual({
      timestamp: '1',
      signature: 'abc',
    });
    expect(parseKhipuSignatureHeader('t=1')).toBeNull();
    expect(parseKhipuSignatureHeader('')).toBeNull();
    expect(parseKhipuSignatureHeader(undefined)).toBeNull();
  });
});

describe('Creación de cobros en Khipu', () => {
  it('exige una clave de API configurada', async () => {
    await expect(
      createKhipuPayment(envSinClave, {
        amountClp: 1000,
        orderNumber: 'ALD-2026-0001',
        subject: 'Prueba',
        body: 'Detalle',
        notifyUrl: 'https://api.example.cl/api/v1/public/webhooks/khipu',
        returnUrl: 'https://tienda.example.cl/checkout/confirmacion',
        cancelUrl: 'https://tienda.example.cl/checkout',
        payerName: 'Pedro Soto',
        payerEmail: 'pedro@example.cl',
      }),
    ).rejects.toBeInstanceOf(KhipuNotConfiguredError);
  });

  it('envía el cobro con la cabecera x-api-key y mapea la respuesta', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          payment_id: 'gqzdy6chjne9',
          payment_url: 'https://khipu.com/payment/info/gqzdy6chjne9',
          simplified_transfer_url: 'https://app.khipu.com/payment/simplified/gqzdy6chjne9',
          transfer_url: 'https://khipu.com/payment/manual/gqzdy6chjne9',
          app_url: 'khipu:///pos/gqzdy6chjne9',
          ready_for_terminal: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const payment = await createKhipuPayment(
      env,
      {
        amountClp: 93480,
        orderNumber: 'ALD-2026-0001',
        subject: 'Pedido ALD-2026-0001 — Aldos Motos',
        body: 'Compra: 1x Kit Pistón',
        notifyUrl: 'https://api.example.cl/api/v1/public/webhooks/khipu',
        returnUrl: 'https://tienda.example.cl/checkout/confirmacion?order=ALD-2026-0001',
        cancelUrl: 'https://tienda.example.cl/checkout?pago=cancelado',
        payerName: 'Pedro Soto',
        payerEmail: 'pedro@example.cl',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: 'https://payment-api.khipu.com' },
    );

    expect(payment.paymentId).toBe('gqzdy6chjne9');
    expect(payment.paymentUrl).toBe('https://khipu.com/payment/info/gqzdy6chjne9');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://payment-api.khipu.com/v3/payments');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('clave-de-prueba');

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body['amount']).toBe(93480);
    expect(body['currency']).toBe('CLP');
    expect(body['transaction_id']).toBe('ALD-2026-0001');
    expect(body['notify_api_version']).toBe('3.0');
    expect(body['notify_url']).toContain('/api/v1/public/webhooks/khipu');
    expect(body['send_email']).toBe(false);
  });

  it('lanza KhipuApiError si Khipu responde con error', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401 }));

    await expect(
      createKhipuPayment(
        env,
        {
          amountClp: 1000,
          orderNumber: 'ALD-2026-0002',
          subject: 'Prueba',
          body: 'Detalle',
          notifyUrl: 'https://api.example.cl/webhook',
          returnUrl: 'https://tienda.example.cl/ok',
          cancelUrl: 'https://tienda.example.cl/no',
          payerName: 'Pedro',
          payerEmail: 'pedro@example.cl',
        },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toBeInstanceOf(KhipuApiError);
  });

  it('consulta el estado de un cobro y devuelve null si no existe', async () => {
    const notFound = vi.fn(async () => new Response('{}', { status: 404 }));
    await expect(
      getKhipuPayment(env, 'noexiste', { fetchImpl: notFound as unknown as typeof fetch }),
    ).resolves.toBeNull();

    const ok = vi.fn(async () =>
      new Response(
        JSON.stringify({
          payment_id: 'gqzdy6chjne9',
          status: 'done',
          amount: 93480,
          currency: 'CLP',
          transaction_id: 'ALD-2026-0001',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const status = await getKhipuPayment(env, 'gqzdy6chjne9', {
      fetchImpl: ok as unknown as typeof fetch,
    });

    expect(status?.status).toBe('done');
    expect(status?.amount).toBe(93480);
    expect(status?.transactionId).toBe('ALD-2026-0001');
  });
});
