import { z } from 'zod';

import { isValidRut, normalizePhone } from '../utils/chile';

/**
 * Validación del checkout público (RF-04, RF-05) y del seguimiento de pedidos (RF-14).
 * Los mensajes están en español chileno claro, porque se muestran tal cual al comprador.
 */

const nameField = z
  .string('Escribe tu nombre.')
  .trim()
  .min(3, 'Escribe tu nombre completo.')
  .max(120, 'El nombre es demasiado largo.');

const emailField = z
  .string('Escribe tu correo electrónico.')
  .trim()
  .toLowerCase()
  .min(5, 'Escribe tu correo electrónico.')
  .max(160, 'El correo electrónico es demasiado largo.')
  .check(z.email('Escribe un correo electrónico válido.'));

/** Teléfono móvil chileno, normalizado a `+569XXXXXXXX`. */
const phoneField = z
  .string('Escribe tu teléfono o WhatsApp.')
  .trim()
  .min(5, 'Escribe tu teléfono o WhatsApp.')
  .max(30, 'El teléfono es demasiado largo.')
  .refine((value) => normalizePhone(value) !== null, {
    message: 'Escribe un celular chileno válido, por ejemplo +56 9 1234 5678.',
  })
  .transform((value) => normalizePhone(value) ?? value);

/** RUT opcional: si viene, tiene que ser válido. */
const rutField = z
  .union([z.string(), z.null()])
  .optional()
  .refine((value) => value === undefined || value === null || value.trim() === '' || isValidRut(value), {
    message: 'El RUT no es válido. Revísalo, por ejemplo 12.345.678-5.',
  })
  .transform((value) => (value === undefined || value === null || value.trim() === '' ? null : value.trim()));

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === null) return null;
      const clean = value.trim();
      return clean.length === 0 ? null : clean.slice(0, max);
    });

export const checkoutItemSchema = z.object({
  productId: z.coerce.number().int('El repuesto del carrito no es válido.').positive(),
  quantity: z.coerce
    .number()
    .int('La cantidad debe ser un número entero.')
    .min(1, 'Cada repuesto debe llevar al menos 1 unidad.')
    .max(50, 'La cantidad máxima por repuesto es 50 unidades.'),
});

export const checkoutSchema = z
  .object({
    customerName: nameField,
    customerRut: rutField,
    customerEmail: emailField,
    customerPhone: phoneField,
    deliveryMethod: z.enum(['SHIPPING', 'PICKUP'], {
      message: 'Elige si quieres despacho o retiro en el taller.',
    }),
    regionCode: z.string('Elige tu región.').trim().min(2, 'Elige tu región.').max(10),
    regionName: z.string().trim().max(120).optional(),
    comuna: z.string('Elige tu comuna.').trim().min(2, 'Elige tu comuna.').max(80),
    addressLine: z.string().trim().max(200).optional(),
    addressReference: optionalText(200),
    customerNotes: optionalText(500),
    paymentMethod: z.enum(['KHIPU', 'BANK_TRANSFER'], {
      message: 'Elige cómo quieres pagar.',
    }),
    items: z
      .array(checkoutItemSchema)
      .min(1, 'Tu carrito está vacío.')
      .max(30, 'El carrito tiene demasiados repuestos distintos. Escríbenos por WhatsApp.'),
  })
  .superRefine((value, ctx) => {
    if (value.deliveryMethod === 'SHIPPING') {
      const address = value.addressLine?.trim() ?? '';
      if (address.length < 5) {
        ctx.addIssue({
          code: 'custom',
          path: ['addressLine'],
          message: 'Escribe la dirección donde te despachamos el pedido.',
        });
      }
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type CheckoutItemInput = z.infer<typeof checkoutItemSchema>;

/** Código de seguimiento público (RF-14). */
export const trackingCodeParamSchema = z.object({
  trackingCode: z
    .string('El código de seguimiento no es válido.')
    .trim()
    .min(6, 'El código de seguimiento no es válido.')
    .max(24, 'El código de seguimiento no es válido.'),
});

// ---------------------------------------------------------------------------
// Panel de Estrella: pedidos y despachos (RF-08)
// ---------------------------------------------------------------------------

/** Estado del pedido (`PENDING` → `PAID` → `SHIPPED` → `DELIVERED`, o `CANCELLED`). */
export const orderStatusField = z.enum(['PENDING', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED'], {
  message: 'Ese estado de pedido no existe.',
});

/** Filtros del listado de pedidos del panel. */
export const adminOrderQuerySchema = z.object({
  status: orderStatusField.optional(),
  paymentStatus: z.enum(['PENDING', 'PAID', 'FAILED', 'REFUNDED']).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

/** Cambio de estado desde el panel (incluye el courier al despachar). */
export const orderStatusUpdateSchema = z
  .object({
    status: orderStatusField,
    courierName: z
      .string('Escribe el courier con el que despachas.')
      .trim()
      .max(80)
      .nullable()
      .optional(),
    courierTrackingNumber: z
      .string()
      .trim()
      .max(80, 'El número de seguimiento es demasiado largo.')
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status !== 'SHIPPED') return;

    const courier = value.courierName?.trim() ?? '';
    if (courier.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['courierName'],
        message: 'Escribe el courier con el que despachas (ej. Chilexpress, Starken).',
      });
    }
  });

export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;

/** Tarifa de envío por región (RF-10). */
export const shippingRateUpdateSchema = z.object({
  baseCostClp: z
    .number('El costo debe ser un número entero en pesos.')
    .int('El costo no puede tener decimales: son pesos chilenos.')
    .min(0, 'El costo no puede ser negativo.')
    .max(99_999_999)
    .optional(),
  estimatedDays: z.string().trim().min(3, 'Escribe el plazo estimado.').max(120).optional(),
  courierName: z.string().trim().min(2, 'Escribe el nombre del courier.').max(80).optional(),
  isPayableOnDelivery: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type ShippingRateUpdateInput = z.infer<typeof shippingRateUpdateSchema>;

/** Configuración de la tienda: valores simples que Estrella puede editar. */
export const storeSettingsUpdateSchema = z.object({
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});
