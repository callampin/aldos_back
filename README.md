# Aldo's Motos — Backend

API RESTful **serverless** para la tienda de repuestos y accesorios de motos (líneas Enduro y Honda XR), construida con **Cloudflare Workers + Hono + Drizzle ORM + D1 + R2**.

- **Clientes/operadores:** Estrella (administración, ventas y despachos) y Aldo (especialista técnico mecánico).
- **Objetivo:** que la tienda venda 24/7 por su cuenta (catálogo, stock, checkout y pagos), manteniendo el trato humano por WhatsApp para repuestos de alto valor o dudas técnicas.
- **Costo objetivo: $0.** Todo corre en la capa gratuita de Cloudflare: sin servidores dedicados, sin contenedores permanentes y sin bases de datos que se "duerman".

> **Nota de monorepo:** este directorio (`/back`) es un proyecto **independiente** de `/front` (cada uno con su `package.json`, su `pnpm install` y sus pruebas). La intención es separarlos en dos repos; este README será la documentación del repo del backend.

---

## Estado del proyecto

✅ **Backend completo.** Los **13 pasos** de la hoja de ruta (`.opencode/PLAN.md`) están terminados, más un paso adicional acordado con el cliente (rate limiting, `Paso 6-A`).

| Métrica | Valor |
|---|---|
| Verificación de tipos | `pnpm run check` limpio |
| Pruebas | **87 tests en verde** (14 archivos) sobre el runtime real de Workers con D1 real |
| Archivos fuente | 33 en `src/` |
| Endpoints | 36 rutas en 10 archivos de rutas (+ el healthcheck) |

**Falta para producción:** crear la base D1 y el bucket R2 reales, cargar los secretos, desplegar y conectar el frontend. Ver [Antes de desplegar](#antes-de-desplegar).

---

## Probar en local

```bash
pnpm install
pnpm run db:migrate:local   # crea el esquema en la base D1 local
pnpm run db:seed:local      # carga la semilla (regiones, categorías, motos y productos de prueba)
pnpm run dev                # API en http://localhost:8787
```

Comprobación rápida (la base local queda con datos de ejemplo):

```bash
curl http://localhost:8787/api/v1/health
curl "http://localhost:8787/api/v1/public/catalog?brand=Honda&model=XR%20250R%20Japon%C3%A9s&year=1998"
curl http://localhost:8787/api/v1/public/motorcycles
```

**Panel de administración:** el usuario de la semilla es `contacto@aldosmotos.cl` con la contraseña `AldosMotors2026!` (solo desarrollo; el login devuelve la cookie `HttpOnly` para el panel).

```bash
curl -X POST http://localhost:8787/api/v1/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"contacto@aldosmotos.cl","password":"AldosMotors2026!"}'

# Con la cookie guardada en el archivo de cookies:
curl -b cookies.txt http://localhost:8787/api/v1/admin/products
```

### Probar el pago sin pasarela real

En desarrollo `KHIPU_API_KEY` va **vacía**, así que el checkout responde `201` con `paymentUrl: null` y un mensaje para el comprador (el pedido y el stock quedan reservados igual). Para probar la **notificación de pago** se firma el cuerpo a mano con el secreto de `.dev.vars`:

```bash
# cuerpo de ejemplo (transaction_id = número de pedido)
printf '%s' '{"payment_id":"zfxnocsow6mz","receiver_id":990939,"amount":"93480.0000","currency":"CLP","transaction_id":"ALD-2026-0001","conciliation_date":"2026-10-19T12:00:00.000Z"}' > /tmp/cobro.json

# firma: HMAC-SHA256 en base64 sobre "<timestamp>.<cuerpo crudo>"
SIG=$(node -e "
const {createHmac}=require('node:crypto');const fs=require('node:fs');
const secret=process.argv[1];const t=String(Date.now());
const body=fs.readFileSync('/tmp/cobro.json','utf8');
console.log('t='+t+',s='+createHmac('sha256',secret).update(t+'.'+body).digest('base64'));
" "$(grep -o 'KHIPU_WEBHOOK_SECRET=\"[^\"]*\"' .dev.vars | sed 's/.*=\"//; s/\"$//')")

curl -X POST http://localhost:8787/api/v1/public/webhooks/khipu \
  -H "x-khipu-signature: $SIG" -H 'Content-Type: application/json' \
  --data-binary @/tmp/cobro.json
```

Con `RESEND_API_KEY` vacía los correos **no se envían**, pero el log del Worker muestra los destinatarios y los asuntos (y, para la recuperación de contraseña, el enlace completo). Así se puede seguir todo el flujo sin proveedor de correo.

---

## Stack

| Capa | Tecnología | Para qué |
|---|---|---|
| Runtime | **Cloudflare Workers** (`workerd`) | Ejecución en el edge, sin cold starts que se noten |
| Framework HTTP | **Hono** (+ `@hono/zod-validator`) | Router ultraligero, middlewares y RPC |
| Lenguaje | **TypeScript 5.9** (`strict: true`) | Tipado de punta a punta |
| Base de datos | **Cloudflare D1** (SQLite serverless) | Productos, pedidos, configuración |
| ORM / migraciones | **Drizzle ORM** + `drizzle-kit` | Consultas tipadas, `db.batch()` y migraciones SQL |
| Validación | **Zod 4** | Entradas de la API, planillas de Excel y webhooks |
| Imágenes | **Cloudflare R2** | Fotos de repuestos (egress $0) |
| Autenticación | **Web Crypto (PBKDF2) + JWT** (`hono/jwt`) | Panel de Estrella con cookie `HttpOnly` |
| Pagos | **Khipu API v3** + transferencia bancaria | Cobro automático y confirmación de transferencias |
| Notificaciones | **Resend** + enlaces de WhatsApp | Correo al comprador y aviso inmediato a Estrella |
| Pruebas | **Vitest** + `@cloudflare/vitest-plugin` | Tests sobre workerd con D1 real |

## Requisitos

- Node.js 20+ (probado con v22).
- **pnpm** — en este entorno `npm` está interceptado y ejecuta pnpm; usar `pnpm` / `pnpm exec`.
- pnpm 11 requiere aprobar los *build scripts* (`pnpm-workspace.yaml` → `allowBuilds`), ya configurado.

## Comandos

```bash
pnpm install            # instalar dependencias

pnpm run dev            # Worker de desarrollo en http://localhost:8787
pnpm run deploy         # desplegar a Cloudflare (requiere la base y los secretos reales)
pnpm run check          # verificación de tipos (tsc --noEmit)
pnpm test               # suite completa (unitarios + integración sobre D1 real)
pnpm run test:watch     # tests en modo watch

pnpm run db:generate    # genera el SQL de migración desde src/db/schema.ts
pnpm run db:migrate:local   # aplica migraciones a la base D1 local
pnpm run db:migrate:prod    # aplica migraciones a la base D1 remota
pnpm run db:seed:generate   # genera drizzle/seed/0001_seed.sql desde src/db/seed.ts
pnpm run db:seed:local      # genera y aplica la semilla en la base local
```

---

## API

Envelope uniforme en todas las respuestas:

```jsonc
// éxito
{ "ok": true, "data": { }, "meta": { } }
// error
{ "ok": false, "error": { "code": "INSUFFICIENT_STOCK", "message": "…en español…", "details": [ ] } }
```

Los **listados** devuelven un arreglo en `data` (con la paginación en `meta`), porque así los consume el frontend.

### Públicas (`/api/v1/public/*`)

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/health` | Estado del Worker |
| `GET` | `/catalog` | Catálogo con filtros combinables: `q` (nombre/SKU/OEM, sin tildes), `category`, `brand`, `model`, `year`, `line`, `inStockOnly`, `sort` (`newest`/`price_asc`/`price_desc`), `page`, `limit` |
| `GET` | `/products/:slug` | Ficha completa: galería, compatibilidades, estado de stock y enlace de WhatsApp pre-armado |
| `GET` | `/motorcycles` | Árbol Marca → Modelos → años para el selector "¿Qué moto tienes?" |
| `GET` | `/shipping-rates` | 16 regiones de Chile + Isla de Pascua, con costos y plazos |
| `GET` | `/media/*` | Sirve las fotos de R2 con caché inmutable (proxy del Worker) |
| `POST` | `/products/:id/stock-alert` | "Avisarme cuando llegue" de un repuesto agotado |
| `POST` | `/checkout` | Crea el pedido, **descuenta el stock de forma atómica** y devuelve el enlace de pago o los datos de transferencia |
| `GET` | `/orders/track/:trackingCode` | Seguimiento público del pedido (sin cuenta, sin datos personales sensibles) |
| `POST` | `/webhooks/khipu` | Notificación de pago de Khipu (firma HMAC validada) |
| `GET` | `/webhooks/khipu/status/:paymentId` | Consulta el estado real del cobro en Khipu (reconciliación) |

### Administración (`/api/v1/admin/*`) — requieren sesión

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/auth/login` · `/auth/logout` | Ingreso y salida del panel (cookie `HttpOnly`) |
| `GET` | `/auth/me` | Administrador autenticado |
| `POST` | `/auth/forgot-password` · `/auth/reset-password` | Recuperación de contraseña por correo (token de un solo uso, 1 hora) |
| `GET` | `/products` | Inventario con filtros rápidos (bajo stock, agotados, sin foto, modo WhatsApp, usados) |
| `GET` | `/products/export` | Catálogo completo **en el mismo formato que acepta la importación** |
| `GET` | `/products/:id` | Ficha de un repuesto para editar |
| `POST` | `/products` | Crear repuesto (con sus motos compatibles) |
| `POST` | `/products/batch-import` | **Carga masiva tipo Excel**: upsert por `sku` en bloques de 100, con reporte de creados/actualizados/errores/advertencias |
| `PUT` | `/products/:id` | Editar repuesto (solo cambia lo que llega) |
| `PATCH` | `/products/:id/quick-update` | Guardado instantáneo de una celda (precio, stock, umbral, modo de venta, visibilidad) |
| `POST` | `/media/upload` | Subir una foto a R2 (`multipart/form-data`) |
| `DELETE` | `/media/:imageId` | Borrar una foto (si era la principal, promueve la siguiente) |
| `GET` | `/media/product/:productId` | Galería de un repuesto |
| `GET` | `/motorcycles` · `POST` · `PUT` · `DELETE` | Mantenedor de motos compatibles |
| `GET` | `/orders` | Pedidos ordenados por urgencia (lo que hay que despachar hoy primero) |
| `GET` | `/orders/:id` | Ficha del pedido + etiqueta de despacho + enlace de WhatsApp del cliente |
| `PATCH` | `/orders/:id/status` | Cambiar estado: `PAID` confirma el pago, `SHIPPED` guarda courier y seguimiento, `CANCELLED` **devuelve el stock** |
| `GET` | `/settings` | Configuración de la tienda + tarifas de envío |
| `PUT` | `/settings` | Guardar configuración (whitelist de claves, validada) |
| `GET` | `/settings/shipping-rates` | Tarifas por región |
| `PUT` | `/settings/shipping-rates/:regionCode` | Ajustar el envío de una región |

---

## Estructura

```text
src/
├── index.ts              Entrypoint de Hono: CORS, healthcheck, rutas y manejo de errores
├── types/bindings.ts     Tipado de `Env` (bindings de D1/R2 y secretos)
├── db/
│   ├── schema.ts         11 tablas (dinero entero en CLP, booleanos 0/1, fechas Unix)
│   ├── index.ts          createDb(env.DB): cliente Drizzle
│   └── seed.ts           Semilla pura (regiones, categorías, motos, productos, admin)
├── middlewares/
│   ├── auth.middleware.ts       requireAdmin (JWT por cookie o Bearer)
│   ├── rate-limit.middleware.ts Límite por IP (login, checkout, avisos…)
│   └── error.middleware.ts      Contrato de errores + hook de validación Zod
├── routes/
│   ├── public/   catalog · checkout · tracking · webhooks
│   └── admin/    auth · products · media · motorcycles · orders · settings
├── services/     catalog · inventory · order · payment-khipu · notification · settings · storage-r2
├── validators/   auth.schema · product.schema · order.schema
└── utils/        crypto (PBKDF2/HMAC) · chile (RUT/teléfono/CLP) · slug · whatsapp · background

drizzle/migrations/   Migraciones SQL (las aplica Wrangler)
scripts/              Generador del SQL de semilla para la carga local
test/                 Unitarios + integración (D1 real) + helpers
```

---

## Base de datos

11 tablas (ver `src/db/schema.ts` y `.opencode/AGENTS.md` §4): `admins`, `categories`, `motorcycles`, `products`, `product_images`, `product_compatibility`, `shipping_rates`, `orders`, `order_items`, `stock_alerts`, `store_settings`.

Reglas que el esquema respeta a rajatabla:

- **Dinero = entero en pesos chilenos** (`INTEGER`), nunca decimales. Ej: `$300.000` ⇒ `300000`.
- **Booleanos** como `INTEGER` 0/1.
- **Fechas** como timestamp Unix (segundos), con `unixepoch()` por defecto.
- **Nombres de archivo `snake_case`**; el JSON de la API va en `camelCase`.

### Semilla local

`pnpm run db:seed:local` carga: **17 tarifas** (16 regiones + Isla de Pascua), **7 categorías**, **21 motos** (línea XR 125→650, CRF, KTM EXC, WR/YZ, Husqvarna, Beta, GasGas, Suzuki), **12 productos** de prueba (incluye `WHATSAPP_ONLY` y uno usado), **20 compatibilidades**, **7 ajustes** de tienda y la cuenta de Estrella. Es **idempotente**: se puede volver a correr sin duplicar nada.

---

## Cómo se protegen las reglas del negocio

Estas son las decisiones que sostienen las promesas del proyecto (el detalle y el porqué están en `.opencode/NOTAS.md`):

- **Cero sobreventa.** El stock se descuenta con `UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`: la condición va **dentro** del `UPDATE`, así que es la base de datos la que decide. Si dos compras simultáneas piden el último repuesto, **sólo una** actualiza la fila; la otra recibe `409` con el detalle exacto del repuesto. Si un ítem posterior del carrito no alcanza, **se devuelve al inventario** lo ya descontado (`reserveStockForItems`).
- **`WHATSAPP_ONLY` no entra al carrito.** El checkout rechaza los repuestos que requieren validación técnica; esos se cotizan por WhatsApp con un mensaje pre-armado (nombre + SKU + enlace).
- **El stock vuelve al cancelar.** `PATCH /admin/orders/:id/status` con `CANCELLED` devuelve las unidades **una sola vez** (bandera `stock_deducted`).
- **Los montos los calcula el servidor.** El precio unitario, el nombre y el envío salen de la base (el costo de envío se busca por región); nunca se confía en montos que vengan del navegador.
- **El webhook de pago se valida de verdad.** Firma **HMAC-SHA256 en base64 sobre `"<timestamp>.<cuerpo crudo>"`** + descarte de mensajes de más de 5 minutos + comparación del monto con el total del pedido + **idempotencia** (Khipu reintenta hasta 2 días). El ejemplo oficial de la documentación de Khipu está como test.
- **Sin IA ni respuestas automáticas** (restricción del negocio): todos los correos son de una sola vía y derivan al WhatsApp real; no hay chatbots.
- **Protección básica contra abuso.** Límite de solicitudes por IP: login 10/5 min, recuperación de contraseña 5/15 min (y 10/15 min al fijar la nueva), avisos de stock 10/15 min, checkout 20/15 min y seguimiento 40/15 min. Es un límite en memoria del isolate (frena el abuso casual; no es global, ver `.opencode/NOTAS.md` `H-17`).
- **Privacidad.** El seguimiento público **no** expone dirección, teléfono ni RUT; el código de seguimiento es aleatorio y no predecible.

---

## Secretos y variables

Las variables no sensibles van en `wrangler.toml` (`[vars]`); los secretos en `.dev.vars` (ignorado por git; hay una plantilla en `.dev.vars.example`).

```bash
# desarrollo: copiar la plantilla y completar
cp .dev.vars.example .dev.vars

# producción
pnpm exec wrangler secret put JWT_SECRET
pnpm exec wrangler secret put KHIPU_API_KEY
pnpm exec wrangler secret put KHIPU_WEBHOOK_SECRET
pnpm exec wrangler secret put RESEND_API_KEY
```

| Nombre | Dónde | Para qué |
|---|---|---|
| `FRONTEND_URL` | `[vars]` | CORS, `return_url`/`cancel_url` de Khipu y enlaces de los correos |
| `STORE_WHATSAPP` | `[vars]` | WhatsApp de la tienda (`+569…`) para los enlaces `wa.me` |
| `JWT_SECRET` | secreto | Firma de los tokens del panel y de los enlaces de recuperación |
| `KHIPU_API_KEY` | secreto | Crear y consultar cobros en Khipu (`x-api-key`) |
| `KHIPU_WEBHOOK_SECRET` | secreto | **Secreto del comercio**: valida la firma de las notificaciones |
| `RESEND_API_KEY` | secreto | Envío de correos transaccionales |

Sin `RESEND_API_KEY` la aplicación funciona igual (los correos quedan en el log). Sin `KHIPU_API_KEY` el checkout sigue creando el pedido y reservando stock, pero devuelve `paymentUrl: null` y **avisa a Estrella** para coordinar el pago a mano.

---

## Pruebas

```bash
pnpm test          # 14 archivos, 87 tests
pnpm run check     # tipos
```

Los tests de integración corren **sobre el runtime real de Cloudflare Workers con una base D1 real**: `vitest.config.ts` lee las migraciones de `drizzle/migrations` y las inyecta como binding, y `test/setup.ts` las aplica antes de cada archivo. Un test verifica explícitamente que la suite corre en workerd (`navigator.userAgent === 'Cloudflare-Workers'`).

Qué se cubre:

- Utilidades: RUT (módulo 11), teléfonos `+569…`, montos CLP, slugs, PBKDF2, HMAC y enlaces de WhatsApp.
- Auth: `/me` sin sesión `401`, token vencido, firma con otro secreto, login y recuperación de contraseña.
- Rate limiting: corte por ventana, contadores por IP, `Retry-After`.
- Khipu: firma con el **vector oficial de la documentación**, cuerpo alterado, timestamp viejo, creación de cobro y errores de la API.
- Integración con D1: **concurrencia por el último repuesto** (gana una sola), **compensación de stock**, bloqueo de `WHATSAPP_ONLY`, importación masiva idempotente y el **ciclo completo** checkout → pago → despacho → cancelación con reversión de stock.

---

## Antes de desplegar

1. **Crear la base y el bucket reales** y actualizar `wrangler.toml`:
   ```bash
   pnpm exec wrangler d1 create aldos-db     # copiar el database_id en wrangler.toml
   pnpm exec wrangler r2 bucket create aldos-media
   pnpm run db:migrate:prod            # aplicar el esquema a la base remota
   ```
2. **Cargar los secretos** con `wrangler secret put` (tabla de arriba).
3. **Configurar `FRONTEND_URL`** con el dominio real (afecta CORS y los enlaces de los correos).
4. **Cuenta de cobro de Khipu**: la `x-api-key` y el **secreto del comercio** se obtienen del panel de Khipu (el segundo es distinto de la primera y es el que firma las notificaciones). Al desplegar, revisar también el `notify_url` (se arma con el dominio de la petición).
5. **Correos**: verificar el dominio en Resend y ajustar el remitente (`STORE_FROM_EMAIL` en `notification.service.ts`).
6. **Dejar la semilla solo para desarrollo**: no correr `db:seed:local` contra producción (crea la cuenta de Estrella con contraseña conocida).

---

## Documentación

- `LOGS.md` — bitácora de errores encontrados y cómo se resolvieron (`L-01`…`L-23`).
- `.opencode/AGENTS.md` — arquitectura, reglas de negocio, contratos de la API y convenciones del backend.
- `.opencode/PLAN.md` — hoja de ruta por etapas y pasos, con el estado y las evidencias de cada uno.
- `.opencode/NOTAS.md` — desvíos y decisiones que conviene revisar más adelante (`H-01`…`H-19`).
- `../README.md` — documentación general del monorepo (la tienda, el panel y la API juntos).
- `REQUERIMIENTOS.md` — requisitos de negocio (en la raíz del monorepo hasta la separación).
- `front/README.md` — documentación de la tienda y el panel (Astro + React).
