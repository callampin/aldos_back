import { z } from 'zod';

/**
 * Esquemas de validación de los endpoints de autenticación del panel de Estrella.
 * Los mensajes están en español chileno claro, porque se muestran tal cual al usuario.
 */

/** Política mínima de contraseña para el panel (RNF-05). */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

const emailField = z
  .string('Ingresa tu correo electrónico.')
  .trim()
  .toLowerCase()
  .min(5, 'Ingresa un correo electrónico válido.')
  .max(160, 'El correo electrónico es demasiado largo.')
  .check(z.email('Ingresa un correo electrónico válido.'));

/** Contraseña nueva: se exige el mínimo de seguridad de forma explícita. */
const newPasswordField = z
  .string('Ingresa la nueva contraseña.')
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(PASSWORD_MAX_LENGTH, 'La contraseña es demasiado larga.')
  .regex(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/, 'La contraseña debe incluir al menos una letra.')
  .regex(/\d/, 'La contraseña debe incluir al menos un número.');

/**
 * Contraseña de ingreso: solo se exige que venga algo.
 * (No aplicamos la política aquí, porque una contraseña antigua podría no cumplirla.)
 */
const loginPasswordField = z
  .string('Ingresa tu contraseña.')
  .min(1, 'Ingresa tu contraseña.')
  .max(PASSWORD_MAX_LENGTH, 'La contraseña es demasiado larga.');

export const loginSchema = z.object({
  email: emailField,
  password: loginPasswordField,
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  token: z
    .string('El enlace de recuperación no es válido.')
    .min(20, 'El enlace de recuperación no es válido.')
    .max(512, 'El enlace de recuperación no es válido.'),
  password: newPasswordField,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
