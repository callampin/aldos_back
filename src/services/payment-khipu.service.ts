import type { Env } from '../types/bindings';
import { verifyHmacSha256 } from '../utils/crypto';

/**
 * Integración con **Khipu API v3 — Pagos Instantáneos**.
 *
 * Contrato confirmado en la documentación oficial (`docs.khipu.com`):
 * - `POST https://payment-api.khipu.com/v3/payments` con la cabecera `x-api-key`.
 * - La respuesta trae `payment_id` y `payment_url` (a donde se manda al comprador).
 * - El webhook llega como un `POST` con el evento en JSON y trae la cabecera
 *   `x-khipu-signature: t=<epoch ms>,s=<hmac>` donde la firma es
 *   **HMAC-SHA256 en base64 sobre `"<timestamp>.<cuerpo crudo>"`**, usando el
 *   secreto del comercio. El cuerpo **no** se puede reformatear antes de validar.
 *
 * Ver `NOTAS.md` H-11 (se confirmó el formato de la firma) y H-17 (manejo de fallas).
 */

const DEFAULT_BASE_URL = 'https://payment-api.khipu.com';

/** Versión de la API de notificaciones que se pide al crear el cobro. */
const NOTIFY_API_VERSION = '3.0';

/** Vigencia de la firma del webhook (protección contra repetición de mensajes). */
export const KHIPU_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** La cuenta de cobro no tiene clave de API configurada. */
export class KhipuNotConfiguredError extends Error {
  constructor() {
    super('Khipu no está configurado: falta KHIPU_API_KEY.');
    this.name = 'KhipuNotConfiguredError';
  }
}

/** Khipu respondió con un error (o con algo inesperado). */
export class KhipuApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Khipu respondió ${status}.`);
    this.name = 'KhipuApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** `true` si hay una clave de API de Khipu configurada. */
export function isKhipuConfigured(env: Env): boolean {
  return typeof env.KHIPU_API_KEY === 'string' && env.KHIPU_API_KEY.length > 0;
}

export interface CreateKhipuPaymentInput {
  /** Monto total en pesos chilenos (entero). */
  amountClp: number;
  /** Identificador propio de la transacción: se usa el número de pedido. */
  orderNumber: string;
  subject: string;
  body: string;
  /** URL pública del Worker que Khipu llamará al conciliar el pago. */
  notifyUrl: string;
  returnUrl: string;
  cancelUrl: string;
  payerName: string;
  payerEmail: string;
  expiresInHours?: number;
}

export interface CreatedKhipuPayment {
  paymentId: string;
  paymentUrl: string;
  simplifiedTransferUrl: string | null;
  transferUrl: string | null;
  appUrl: string | null;
  readyForTerminal: boolean;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Crea el cobro en Khipu y devuelve las URLs de pago.
 * Lanza `KhipuNotConfiguredError` si no hay clave y `KhipuApiError` si Khipu falla.
 */
export async function createKhipuPayment(
  env: Env,
  input: CreateKhipuPaymentInput,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<CreatedKhipuPayment> {
  if (!isKhipuConfigured(env)) throw new KhipuNotConfiguredError();

  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const expiresDate = new Date(
    Date.now() + (input.expiresInHours ?? 24) * 60 * 60 * 1000,
  ).toISOString();

  const response = await doFetch(`${baseUrl}/v3/payments`, {
    method: 'POST',
    headers: {
      'x-api-key': env.KHIPU_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amountClp,
      currency: 'CLP',
      subject: input.subject,
      body: input.body,
      transaction_id: input.orderNumber,
      notify_url: input.notifyUrl,
      notify_api_version: NOTIFY_API_VERSION,
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      payer_name: input.payerName,
      payer_email: input.payerEmail,
      // Los correos los manda la tienda por Resend, no Khipu (evita duplicados).
      send_email: false,
      send_reminders: false,
      expires_date: expiresDate,
    }),
  });

  if (!response.ok) {
    throw new KhipuApiError(response.status, await response.text());
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const paymentId = readString(payload, 'payment_id');
  const paymentUrl = readString(payload, 'payment_url');

  if (paymentId === null || paymentUrl === null) {
    throw new KhipuApiError(502, 'Respuesta de Khipu sin payment_id o payment_url.');
  }

  return {
    paymentId,
    paymentUrl,
    simplifiedTransferUrl: readString(payload, 'simplified_transfer_url'),
    transferUrl: readString(payload, 'transfer_url'),
    appUrl: readString(payload, 'app_url'),
    readyForTerminal: payload['ready_for_terminal'] === true,
  };
}

export interface KhipuPaymentStatus {
  paymentId: string;
  status: string;
  amount: number | null;
  currency: string | null;
  transactionId: string | null;
  raw: Record<string, unknown>;
}

/**
 * Consulta el estado de un cobro directamente en Khipu.
 * Sirve para reconciliar cuando el webhook no llegó o para revisar un pago a mano.
 */
export async function getKhipuPayment(
  env: Env,
  paymentId: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch } = {},
): Promise<KhipuPaymentStatus | null> {
  if (!isKhipuConfigured(env)) throw new KhipuNotConfiguredError();

  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  const response = await doFetch(`${baseUrl}/v3/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'x-api-key': env.KHIPU_API_KEY },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new KhipuApiError(response.status, await response.text());

  const payload = (await response.json()) as Record<string, unknown>;
  const amount = payload['amount'];
  const currency = payload['currency'];

  return {
    paymentId,
    status: readString(payload, 'status') ?? 'unknown',
    amount: typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : null,
    currency: typeof currency === 'string' ? currency : null,
    transactionId: readString(payload, 'transaction_id'),
    raw: payload,
  };
}

// ---------------------------------------------------------------------------
// Firma del webhook
// ---------------------------------------------------------------------------

export interface KhipuSignatureHeader {
  /** Timestamp UNIX en milisegundos, tal como viene en `t=`. */
  timestamp: string;
  /** Firma en base64, tal como viene en `s=`. */
  signature: string;
}

/** Separa la cabecera `x-khipu-signature` (`t=...,s=...`). Devuelve `null` si está mal formada. */
export function parseKhipuSignatureHeader(
  header: string | null | undefined,
): KhipuSignatureHeader | null {
  if (typeof header !== 'string' || header.trim().length === 0) return null;

  let timestamp: string | null = null;
  let signature: string | null = null;

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;

    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't') timestamp = value;
    else if (key === 's') signature = value;
  }

  return timestamp !== null && signature !== null && timestamp.length > 0 && signature.length > 0
    ? { timestamp, signature }
    : null;
}

export interface VerifyKhipuSignatureInput {
  /** Secreto del comercio (`KHIPU_WEBHOOK_SECRET`). */
  secret: string;
  header: string | null | undefined;
  /** Cuerpo **exactamente** como llegó (sin reformatear el JSON). */
  rawBody: string;
  maxAgeMs?: number;
  /** Solo para pruebas. */
  now?: number;
}

/**
 * Valida la firma del webhook de Khipu.
 * Además de la firma, descarta mensajes con más de 5 minutos de antigüedad (repetición).
 */
export async function verifyKhipuWebhookSignature({
  secret,
  header,
  rawBody,
  maxAgeMs = KHIPU_SIGNATURE_MAX_AGE_MS,
  now = Date.now(),
}: VerifyKhipuSignatureInput): Promise<boolean> {
  const parsed = parseKhipuSignatureHeader(header);
  if (parsed === null) return false;

  const timestampMs = Number.parseInt(parsed.timestamp, 10);
  if (!Number.isFinite(timestampMs)) return false;

  if (maxAgeMs > 0 && Math.abs(now - timestampMs) > maxAgeMs) return false;

  // Exactamente lo que firma Khipu: "<timestamp>.<cuerpo crudo>", en base64.
  return verifyHmacSha256(secret, `${parsed.timestamp}.${rawBody}`, parsed.signature, 'base64');
}
