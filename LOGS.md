# LOGS.md — Registro de errores encontrados y cómo se resolvieron (`/back`)

> **Para qué sirve este documento:** bitácora cronológica de **todo lo que salió mal** mientras se
> construía el backend (Pasos 1 a 11), con el síntoma exacto, la causa y la solución aplicada.
>
> **Relación con los otros documentos:**
> - `PLAN.md` → qué hay que construir y en qué orden (estado de avance).
> - `NOTAS.md` → desvíos y decisiones de diseño que hay que revisar más adelante (`H-xx`).
> - `LOGS.md` → **errores y cómo se salió de ellos** (`L-xx`). Varios tienen su `H-xx` asociado.
>
> **Clasificación de cada entrada:**
> `BUG` = error real del backend · `TIPOS` = lo atrapó `tsc` · `PRUEBA` = error mío en los tests/scripts ·
> `ENTORNO` = plataforma o herramientas · `CONTRATO` = supuesto equivocado sobre una API/documentación.

---

## Resumen

| ID | Tipo | Paso | Título | Estado |
|---|---|---|---|---|
| L-01 | ENTORNO | 1 | `npm` está interceptado y ejecuta `pnpm` | Resuelto |
| L-02 | ENTORNO | 1 | pnpm 11 exige aprobar los *build scripts* (`workerd`, `esbuild`) | Resuelto |
| L-03 | ENTORNO | 1 | `tsc --noEmit` sin archivos de entrada (`TS18003`) | Resuelto |
| L-04 | ENTORNO | 1 | `@cloudflare/vitest-pool-workers` deprecado (renombrado) | Resuelto |
| L-05 | ENTORNO | 1 | `pnpm` modificó `pnpm-workspace.yaml` por su cuenta | Asumido |
| L-06 | BUG | 5 | `q=piston` no encontraba "Pistón" (búsqueda con tildes) | Resuelto |
| L-07 | PRUEBA | 5 | Un test mío daba por válido un RUT con DV incorrecto | Resuelto |
| L-08 | TIPOS | 6 | El `Hook` de Zod no aceptaba el `Env` de la app | Resuelto |
| L-09 | TIPOS | 6 | `ExecutionContext` incompatible en `waitUntil` | Resuelto |
| L-10 | BUG | 8 | SKU o enlace repetido devolvía `500` en vez de `409` | Resuelto |
| L-11 | PRUEBA | 7 | El rate limit "cortaba antes" (en realidad yo había gastado el cupo) | Aclarado |
| L-12 | BUG | 9 | `D1_ERROR: too many SQL variables` en la carga masiva | Resuelto |
| L-13 | TIPOS | 9 | Variable `categories` sombreaba la tabla importada | Resuelto |
| L-14 | PRUEBA | 9 | Mi script de prueba no mostraba la respuesta del lote | Resuelto |
| L-15 | PRUEBA | 10 | `wait` sin argumentos colgaba el script (2 interrupciones) | Resuelto |
| L-16 | TIPOS | 10 | `updated` quedaba como `never` al reportar el stock | Resuelto |
| L-17 | BUG (revisión) | 10 | El ítem de pedido buscaba su producto por SKU | Corregido antes de probar |
| L-18 | ENTORNO | 10 | Se perdieron dos ejecuciones por cortes de conexión | Mitigado |
| L-19 | CONTRATO | 11 | Se creía que Khipu firmaba de otra forma / exigía firma en la API | Resuelto |
| L-20 | BUG (revisión) | 11 | Sin pasarela configurada, nadie avisaba a Estrella del pedido | Resuelto |
| L-21 | TIPOS | 11 | Falta de import de `KhipuNotConfiguredError` | Resuelto |
| L-22 | PRUEBA | 12 | Un comentario equivocado en el script de pruebas (stock esperado) | Aclarado |
| L-23 | PRUEBA | 13 | Se asumió aislación de base por test (en realidad es por archivo) | Resuelto |

---

## A. Entorno y herramientas

### L-01 · `npm` está interceptado y ejecuta `pnpm` (ENTORNO · Paso 1)
- **Síntoma:** al correr `npm install` apareció `🚀 Interceptado: Ejecutando pnpm en lugar de npm`.
- **Causa:** este entorno tiene un interceptor que reemplaza `npm` por `pnpm` (v11.5.0).
- **Solución:** se adoptó **pnpm** como gestor oficial del backend (acordado con el cliente) y los scripts de `package.json` se documentan con `pnpm` / `pnpm exec`.
- **Ver `NOTAS.md`:** `H-01`.
- **Regla:** no confiar en `npm run …` en este entorno; usar `pnpm`.

### L-02 · pnpm 11 exige aprobar los *build scripts* (`workerd`, `esbuild`) (ENTORNO · Paso 1)
- **Síntoma:** riesgo de que `workerd`/`esbuild`/`sharp` no ejecutaran su postinstall (y con eso no fallara sólo la instalación, sino el runtime de pruebas).
- **Causa:** pnpm 11 bloquea los scripts de instalación de dependencias por seguridad.
- **Solución:** `pnpm-workspace.yaml` con `allowBuilds: { esbuild: true, sharp: true, workerd: true }` (mismo patrón que usa `/front`). La instalación terminó con `workerd postinstall: Done`.

### L-03 · `tsc --noEmit` sin archivos de entrada (`TS18003`) (ENTORNO · Paso 1)
- **Síntoma previsto:** el `tsconfig.json` incluía sólo `src/**/*.ts` y en el Paso 1 todavía no existía ningún archivo: TypeScript falla con `TS18003` ("No inputs were found in config file").
- **Solución:** se creó `src/index.ts` con un placeholder (`export {}`), que en el Paso 2 se reemplazó por el servidor Hono real. Así el criterio de logro (`tsc` limpio) era verificable desde el primer paso.
- **Regla:** si un paso sólo agrega configuración, dejar al menos un archivo fuente mínimo para que el chequeo de tipos tenga sentido.

### L-04 · `@cloudflare/vitest-pool-workers` deprecado (ENTORNO · Paso 1)
- **Síntoma:** pnpm marcó el paquete como obsoleto: *"has been renamed to `@cloudflare/vitest-plugin`. This package will not receive future updates."*
- **Causa:** Cloudflare renombró el paquete de integración de Vitest y cambió su API (ahora es un *plugin* de Vite: `cloudflareTest()`).
- **Solución:** se reemplazó la dependencia por `@cloudflare/vitest-plugin@^1.4.4` y `vitest.config.ts` se escribió con el estilo nuevo. Se verificó con `vitest run --passWithNoTests` y, más adelante, con la suite completa corriendo en workerd.
- **Ver `NOTAS.md`:** `H-02`.
- **Extra:** se agregó un test que exige `navigator.userAgent === 'Cloudflare-Workers'` para que, si algún día se rompe el plugin, la suite lo avise (y no corra en Node sin que nos demos cuenta).

### L-05 · pnpm modificó `pnpm-workspace.yaml` por su cuenta (ENTORNO · Paso 1)
- **Síntoma:** durante `pnpm install` avisó que agregaba `minimumReleaseAgeExclude: ['@cloudflare/workers-types@5.20261019.1']` al archivo.
- **Causa:** política de "edad mínima de release" de pnpm, con una versión de `workers-types` muy reciente.
- **Solución:** se dejó tal cual (es inofensivo y hace reproducible la instalación). Queda anotado por si se quiere fijar una ventana de días.
- **Ver `NOTAS.md`:** `H-03`.

---

## B. Errores reales del backend

### L-06 · `q=piston` no encontraba "Pistón" (BUG · Paso 7)
- **Síntoma:** `GET /public/catalog?q=piston` devolvía **0** resultados, pero el producto existía como "Kit Pist**ó**n Original Honda XR 250R STD". Con tilde (`q=PISTÓN`) tampoco encontraba por el uso de mayúsculas.
- **Causa:** el `LIKE` de SQLite **no ignora acentos** y su `lower()` sólo cubre ASCII (no convierte `Ó` en `ó`). El cliente escribe sin tildes.
- **Solución:** normalización en la propia consulta, sin tocar el esquema ni migrar:
  - En SQL: `normalizeColumn(products.name)` = `lower(...)` + 14 `replace()` encadenados (á, é, í, ó, ú, ü, ñ en minúscula y mayúscula).
  - En JavaScript: el mismo criterio para el patrón buscado (`normalizeText`).
  - Se aprovechó de eliminar `%`, `_` y `\` del texto del cliente para que no pueda inyectar comodines.
- **Ver `NOTAS.md`:** `H-13` (incluye la alternativa futura: columna generada normalizada o FTS5).
- **Verificación:** `piston`, `PISTÓN`, `xr 250` y hasta búsquedas por código OEM (`13101`) ya funcionan.

### L-10 · SKU o enlace repetido devolvía `500` (BUG · Paso 8)
- **Síntoma:** `POST /admin/products` con un SKU ya existente respondía
  `HTTP 500 {"code":"INTERNAL_ERROR"}` en vez de un error entendible.
- **Causa:** la violación del índice único de SQLite **no estaba manejada**; además Drizzle **envuelve** el error original en `cause` (`DrizzleQueryError`), así que mirar sólo `error.message` no alcanzaba.
- **Solución:** `describeDuplicateError()` + `errorChain()`, que recorren hasta 5 niveles de `cause` y traducen el problema a:
  `409 SKU_ALREADY_EXISTS` ("Ya tienes un repuesto con ese SKU…") o `409 SLUG_ALREADY_EXISTS`.
- **Regla para el futuro:** con Drizzle + D1, **siempre** revisar la cadena de errores completa para detectar `UNIQUE`.

### L-12 · `D1_ERROR: too many SQL variables` en la carga masiva (BUG · Paso 9)
- **Síntoma:** el lote de 400 productos de la planilla devolvía `HTTP 500` y dejaba **sólo 100 productos** guardados. En el log del Worker:
  `D1_ERROR: too many SQL variables at offset 607: SQLITE_ERROR`
- **Causa:** D1 limita los **parámetros ligados por sentencia** (del orden de 100). El upsert de productos no fallaba porque va **una sentencia por producto** (~17 parámetros), pero el insert de compatibilidades agrupaba 100 filas en **una sola sentencia con ~500 parámetros**.
- **Solución:**
  1. `chunkRowsByParams(filas, paramsPorFila)` con `MAX_BOUND_PARAMS_PER_STATEMENT = 90` → las compatibilidades se insertan en tandas de 18 filas.
  2. Los `DELETE` + `INSERT` de compatibilidades del bloque ahora van **en un solo `db.batch()`** (así el bloque no queda a medias).
  3. Los `SELECT … WHERE sku IN (…)` se hacen en grupos de 80.
- **Ver `NOTAS.md`:** `H-15`.
- **Verificación:** 400 productos creados en **567 ms**, 667 compatibilidades, **0 SKUs duplicados**, y reimportar el mismo lote da `created: 0, updated: 400`.

### L-17 · El ítem de pedido buscaba su producto por SKU (BUG detectado en revisión · Paso 10)
- **Síntoma:** ninguno en ejecución (se detectó leyendo el código antes de probar): al insertar los ítems del pedido, el `productId` se resolvía con
  `lines.find((item) => productById.get(item.productId)?.sku === line.sku)`, una búsqueda frágil (rompe si dos productos comparten nombre y depende del orden).
- **Causa:** no incluí el `productId` en `OrderLine`.
- **Solución:** se agregó `productId` a la interfaz `OrderLine` y el insert usa el valor directo.

### L-20 · Sin pasarela configurada, nadie avisaba a Estrella del pedido (BUG de revisión · Paso 11)
- **Síntoma:** en la revisión del Paso 11 noté que, si el comprador elegía **pago en línea** y `KHIPU_API_KEY` no estaba configurada, el pedido quedaba `PENDING` **sin correo a Estrella**: nadie lo iba a confirmar. Además el endpoint de estado del cobro respondía `502` (genérico) en vez de explicar que la pasarela no está configurada.
- **Causa:** en `attachKhipuPayment()` el camino "Khipu no configurado" hacía `return` temprano, antes del aviso a la tienda.
- **Solución:** ese camino ahora también envía el aviso "🟡 Pedido por confirmar" a Estrella (con la nota de que hay que coordinar el pago a mano) y el endpoint responde `503 KHIPU_NOT_CONFIGURED`.

---

## C. Errores de tipos que atrapó `tsc` (todos resueltos antes de dar por cerrado el paso)

### L-08 · El `Hook` de Zod no aceptaba el `Env` de la app (TIPOS · Paso 6)
- **Error:** `TS2559: Type 'Env' has no properties in common with type 'Env'` (el `Env` de Hono —`{ Bindings, Variables }`— contra nuestro `Env` de bindings), y en cascada los tres `zValidator` con `TS2769`.
- **Causa:** el `Hook` genérico exige que su parámetro `Env` **coincida exactamente** con el de la app Hono.
- **Solución:** el hook de validación se declara como `Hook<unknown, any, string>` con un comentario explicando que sirve para cualquier app Hono y no debe acoplarse a un binding en particular.

### L-09 · `ExecutionContext` incompatible en `waitUntil` (TIPOS · Paso 6)
- **Error:** `TS2345: Type 'ExecutionContext' is missing the following properties from type 'ExecutionContext<unknown>': tracing, abort`.
- **Causa:** el `ExecutionContext` que expone Hono no es exactamente el global de `workers-types`, así que mi firma `{ executionCtx: ExecutionContext }` no calzaba.
- **Solución:** en el Paso 6 se tipó el parámetro como `Context` de Hono y en el Paso 11 se centralizó en `src/utils/background.ts` (`runInBackground`), donde el tipo es estructural y el llamado hace un cast explícito.
- **Ver `NOTAS.md`:** `H-17` (punto 8, archivo nuevo).

### L-13 · Una variable local sombreaba la tabla importada (TIPOS · Paso 9)
- **Error:** `TS7022: 'categories' implicitly has type 'any'…` + cuatro `TS2448: Block-scoped variable 'categories' used before its declaration`.
- **Causa:** dentro de `batchUpsertProducts` escribí `const categories = await db.select(...).from(categories)`: la constante local sombreaba la tabla `categories` importada, incluso dentro de su propia consulta.
- **Solución:** renombrar la variable local a `categoryRows`. De paso, el helper `normalizeKey` (que estaba duplicado en el validador) se unificó como `normalizeText` en `src/utils/slug.ts`.

### L-16 · `updated` quedaba como `never` al reportar el stock (TIPOS · Paso 10)
- **Error:** `TS2339: Property 'stock' does not exist on type 'never'`.
- **Causa:** dentro de `if (!updated)` TypeScript ya sabe que `updated` es `null`, así que la rama `updated === null ? 0 : updated.stock` dejaba el `else` como `never`.
- **Solución:** en ese camino se **vuelve a leer** el producto para informar el stock real ("quedan N unidad(es)").

### L-21 · Falta de import de `KhipuNotConfiguredError` (TIPOS · Paso 11)
- **Error:** `TS2304: Cannot find name 'KhipuNotConfiguredError'`.
- **Causa:** usé la clase en `webhooks.routes.ts` sin agregarla al import.
- **Solución:** agregarla al import de `payment-khipu.service`. (Junto con otros casos menores del mismo tipo: `like`, `inArray`, `gte`.)

---

## D. Errores míos en las pruebas o en los scripts

### L-07 · Un test mío daba por válido un RUT con DV incorrecto (PRUEBA · Paso 5)
- **Síntoma:** la suite falló: `expected false to be true` en `isValidRut('12.345.678-k')`.
- **Causa:** mi expectativa estaba mal: el dígito verificador de `12.345.678` es **5**, no `K`. El validador estaba correcto.
- **Solución:** se corrigió el test (se movió ese caso a la lista de inválidos y se agregó `6-k` para cubrir el DV en minúscula).
- **Lección:** cuando un test falla, primero revisar si la expectativa es la equivocada.

### L-11 · El rate limit "cortaba antes de lo esperado" (PRUEBA · Paso 7)
- **Síntoma:** en el aviso de stock, el `429` apareció en el **8º** intento y no en el 11º.
- **Causa:** no era un error del middleware: los tres casos anteriores de la misma prueba ya habían consumido 3 de los 10 permitidos por ventana.
- **Solución:** se aclaró en el reporte. **No había nada que arreglar** (el comportamiento era el correcto).

### L-14 · El script de prueba no mostraba la respuesta del lote (PRUEBA · Paso 9)
- **Síntoma:** un `TypeError: Cannot read properties of undefined (reading 'created')` en el helper `j` al leer `p.data.created`.
- **Causa:** el helper recibía el cuerpo junto con la salida de `curl -w '…HTTP %{http_code}'`, así que el JSON quedaba con texto extra y `JSON.parse` fallaba.
- **Solución:** separar la salida del cuerpo (`-o archivo`) de la del código de estado (`-w`), y sólo parsear el archivo.
- **Relacionado (L-12):** ese mismo error de script fue lo que escondió temporalmente el `500` del lote; al arreglarlo, el log del Worker mostró la causa real (`too many SQL variables`).

### L-15 · `wait` sin argumentos colgaba el script de pruebas (PRUEBA · Paso 10)
- **Síntoma:** el script de verificación se quedaba "pensando" para siempre después del test de concurrencia. Dos ejecuciones consecutivas se interrumpieron ahí y parecía que el backend no hacía nada.
- **Causa:** usé `wait` **sin argumentos** para esperar los dos `curl` simultáneos. `wait` sin argumentos espera **a todos** los procesos hijos del shell… incluido el `wrangler dev` que había arrancado en segundo plano y que nunca termina.
- **Solución:** capturar los PIDs de los dos `curl` y esperar sólo esos: `wait "$CURL_A" "$CURL_B"`.
- **Regla para los próximos scripts:** nunca `wait` sin argumentos si hay un servidor corriendo en segundo plano.
- **Ver `NOTAS.md`:** `H-16` (punto 8).

### L-18 · Se perdieron dos ejecuciones por cortes de conexión (ENTORNO · Paso 10)
- **Síntoma:** el resultado del tool se perdió (`Tool execution interrupted`) mientras corrían las verificaciones; quedaron datos de prueba en la base (4 pedidos) y no se sabía hasta dónde había llegado el script.
- **Solución aplicada (dos medidas):**
  1. **Guardar siempre la salida en un archivo** (`script > /tmp/opencode/pasoN-out.txt 2>&1`), así la evidencia sobrevive aunque se corte la conexión.
  2. **Lanzar las verificaciones largas en segundo plano**, que avisan al terminar en vez de mantener la llamada abierta.
  3. Los scripts ahora **limpian al inicio** (borran pedidos y productos de prueba y re-siembran el stock), así una ejecución interrumpida no contamina la siguiente.

---

## E. Supuestos equivocados sobre APIs externas

### L-19 · Cómo firma Khipu (CONTRATO · Paso 11)
- **Síntoma/riesgo:** `back/AGENTS.md` hablaba de "verificación HMAC-SHA256" del webhook, pero sin decir el formato; quedó anotado como pendiente en `H-11` (¿base64 o hexadecimal? ¿sobre qué contenido?). Además se asumía que la API de pagos exigía firmar las peticiones.
- **Qué hice:** antes de escribir el servicio, **leí la documentación oficial de Khipu** (`docs.khipu.com`) en lugar de inventar el contrato.
- **Lo que realmente dice la documentación:**
  1. La API de pagos v3 (`POST https://payment-api.khipu.com/v3/payments`) se autentica con la cabecera **`x-api-key`** y **no** exige firmar peticiones.
  2. El webhook llega con **`x-khipu-signature: t=<epoch ms>,s=<firma>`** y la firma es **HMAC-SHA256 en base64 sobre `"<timestamp>.<cuerpo crudo>"`** con el **secreto del comercio**.
  3. El cuerpo **no se puede reformatear** antes de validar.
- **Solución:** `verifyKhipuWebhookSignature()` (que ya soportaba base64 gracias a la utilidad del Paso 5) + ventana de frescura de 5 minutos, y **el ejemplo oficial de la documentación quedó como test unitario** (`test/services/payment-khipu.test.ts`).
- **Ver `NOTAS.md`:** `H-11` (cerrado).

---

## F. Errores de ejemplo del negocio (carga de datos, no de código)

### L-22 · Motos y categorías escritas a mano en la planilla (decisión, no error)
- **Situación:** si Estrella escribe una moto o una categoría que no existen (o con un error de tipeo), el lote **no falla**: el repuesto se importa igual y la respuesta trae `warnings` con la fila y el mensaje ("No teníamos registrada la moto X: agrégala en Motos compatibles").
- **Por qué se decidió así:** evitar que un error de tipeo cree motos basura en el selector de la tienda (creación automática descartada).
- **Pendiente:** el panel todavía no muestra esos avisos; hay que resolverlo al integrar el front (ver `H-14`).

---

## G. Estado del entorno tras las pruebas (para dejar todo limpio)

Cada verificación termina limpiando lo que creó. Estado esperado de la base local al cerrar un paso:

```sql
SELECT (SELECT COUNT(*) FROM products)             AS productos,   -- 12
       (SELECT COUNT(*) FROM orders)               AS pedidos,     -- 0
       (SELECT COUNT(*) FROM product_compatibility) AS compat,     -- 20
       (SELECT COUNT(*) FROM motorcycles)          AS motos,       -- 21
       (SELECT COUNT(*) FROM shipping_rates)       AS regiones,    -- 17
       (SELECT COUNT(*) FROM stock_alerts)         AS avisos,      -- 0
       (SELECT COUNT(*) FROM product_images)       AS fotos,       -- 0
       (SELECT COUNT(*) FROM products WHERE stock < 0) AS negativos -- 0
```

Y al terminar cada sesión: `pnpm exec tsc --noEmit` limpio, `pnpm test` en verde y sin procesos `wrangler` colgando.

### L-22 · Un comentario equivocado en mi script de pruebas (PRUEBA · Paso 12)
- **Síntoma:** ninguna falla, pero el script decía "el stock debe volver a 3" cuando en realidad el stock era 0 antes de cancelar.
- **Causa:** creé **tres** pedidos de una unidad cada uno partiendo de un stock de 3, así que el stock llegó a 0 (y al cancelar uno volvió a 1). El comentario del script asumía un solo pedido.
- **Solución:** se aclaró la expectativa. El comportamiento del backend era correcto (devolvió exactamente 1 unidad y la segunda cancelación devolvió 0).

### L-23 · Se asumió aislación de base por test (PRUEBA · Paso 13)
- **Síntoma:** dos tests de integración fallaron:
  `expected [ +0, 5, +0, 1, 1 ] to deeply equal [ 1, 1 ]` y `expected [ { id: 1 } ] to have a length of +0 but got 1`.
- **Causa:** asumí que cada test partía con la base vacía, pero en la integración de Vitest la aislación del almacenamiento es **por archivo, no por test**: los repuestos y pedidos de los tests anteriores seguían ahí, así que consultas como "todos los productos" o "no se creó ningún pedido" contaban filas ajenas.
- **Solución:**
  1. Se agregó **`resetDatabase()`** en `test/integration/helpers.ts` (borra pedidos, ítems, compatibilidades, fotos, productos y tarifas) y se llama en `beforeEach` de los tres archivos de integración.
  2. Aun así, las afirmaciones se acotan a los datos que creó cada prueba (por id o por SKU), para que no dependan del orden de ejecución.
- **Regla para el futuro:** en los tests de integración, **no** dar por hecho que la base arranca limpia; reiniciar explícitamente y afirmar sobre datos propios.
