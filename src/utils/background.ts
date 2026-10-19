/**
 * Ejecuta una promesa en segundo plano sin bloquear la respuesta HTTP.
 *
 * En Cloudflare Workers se usa `ctx.waitUntil`, que garantiza que el Worker siga vivo
 * hasta que el envío termine. Cuando no hay contexto de ejecución (por ejemplo en una
 * prueba que llama a la app con `app.request`), simplemente se deja la promesa corriendo.
 */
export interface BackgroundContextLike {
  executionCtx: { waitUntil(promise: Promise<unknown>): void };
}

export function runInBackground(context: BackgroundContextLike, promise: Promise<unknown>): void {
  try {
    context.executionCtx.waitUntil(promise);
  } catch {
    void promise;
  }
}
