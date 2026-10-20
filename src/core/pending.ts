/**
 * Resultados de tools do cliente. O `execute` (chamado pelo OpenCode) espera aqui; a request seguinte do cliente
 * entrega o resultado. É simétrico: se o resultado chegar antes do `execute`, ele fica guardado.
 */
export class PendingCalls {
  private waiters = new Map<string, { resolve: (text: string) => void; reject: (e: Error) => void }>()
  private early = new Map<string, string | Error>()

  wait(id: string, signal?: AbortSignal): Promise<string> {
    const early = this.early.get(id)
    if (early !== undefined) {
      this.early.delete(id)
      return early instanceof Error ? Promise.reject(early) : Promise.resolve(early)
    }
    return new Promise<string>((resolve, reject) => {
      const done = () => signal?.removeEventListener("abort", onAbort)
      const onAbort = () => {
        this.waiters.delete(id)
        reject(new Error("Tool call cancelled"))
      }
      if (signal?.aborted) return onAbort()
      signal?.addEventListener("abort", onAbort, { once: true })
      this.waiters.set(id, {
        resolve: (t) => (done(), resolve(t)),
        reject: (e) => (done(), reject(e)),
      })
    })
  }

  resolve(id: string, text: string) {
    const w = this.waiters.get(id)
    if (w) {
      this.waiters.delete(id)
      w.resolve(text)
    } else this.early.set(id, text)
  }

  reject(id: string, error: Error) {
    const w = this.waiters.get(id)
    if (w) {
      this.waiters.delete(id)
      w.reject(error)
    } else this.early.set(id, error)
  }

  /** Descarta tudo que pertence às chamadas indicadas (cancelamento, expiração, fim da conversa). */
  discard(ids: Iterable<string>, error: Error) {
    for (const id of ids) {
      const w = this.waiters.get(id)
      this.waiters.delete(id)
      this.early.delete(id)
      w?.reject(error)
    }
  }

  get size() {
    return this.waiters.size
  }
}
