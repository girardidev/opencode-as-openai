import type { Logger } from "../obs/logger.ts"
import type { HostEvent, OpenCodeHost } from "./host.ts"

export type Next = { kind: "event"; event: HostEvent } | { kind: "timeout" } | { kind: "closed"; reason?: string }

/** Fila assíncrona de um consumidor com espera limitada. */
export class Channel {
  private items: HostEvent[] = []
  private waiter: ((n: Next) => void) | undefined
  private closedReason: string | undefined
  private isClosed = false

  push(event: HostEvent) {
    if (this.isClosed) return
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w({ kind: "event", event })
    } else {
      this.items.push(event)
    }
  }

  close(reason?: string) {
    if (this.isClosed) return
    this.isClosed = true
    this.closedReason = reason
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w({ kind: "closed", reason })
    }
  }

  get closed() {
    return this.isClosed
  }

  /** Aguarda o próximo evento por no máximo `ms`. Eventos já enfileirados são entregues mesmo após `close`. */
  next(ms: number): Promise<Next> {
    const queued = this.items.shift()
    if (queued) return Promise.resolve({ kind: "event", event: queued })
    if (this.isClosed) return Promise.resolve({ kind: "closed", reason: this.closedReason })
    return new Promise<Next>((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = undefined
        resolve({ kind: "timeout" })
      }, ms)
      this.waiter = (n) => {
        clearTimeout(timer)
        resolve(n)
      }
    })
  }
}

export const STREAM_LOST = "bridge.stream.lost"

/**
 * Uma única assinatura de eventos do OpenCode, despachada por `sessionID` para canais por conversa.
 * Se a assinatura cair, os canais abertos recebem `bridge.stream.lost` (eventos podem ter sido perdidos).
 */
export class EventMux {
  private channels = new Map<string, Channel>()
  private ac = new AbortController()
  private running: Promise<void> | undefined

  constructor(
    private readonly host: OpenCodeHost,
    private readonly log: Logger,
  ) {}

  start() {
    if (this.running) return
    this.running = this.loop()
  }

  async stop() {
    this.ac.abort()
    for (const c of this.channels.values()) c.close("mux-stopped")
    this.channels.clear()
    await this.running?.catch(() => {})
  }

  /** Abre o canal ANTES de enviar o prompt, para não perder eventos. */
  open(sessionID: string): Channel {
    const ch = new Channel()
    this.channels.set(sessionID, ch)
    return ch
  }

  release(sessionID: string) {
    const ch = this.channels.get(sessionID)
    this.channels.delete(sessionID)
    ch?.close("released")
  }

  get size() {
    return this.channels.size
  }

  private async loop() {
    let delay = 250
    while (!this.ac.signal.aborted) {
      try {
        for await (const ev of this.host.subscribe(this.ac.signal)) {
          delay = 250
          const sid = ev?.data?.sessionID
          if (typeof sid === "string") this.channels.get(sid)?.push(ev)
        }
      } catch (e) {
        if (this.ac.signal.aborted) return
        this.log.warn("event stream failed", { error: e })
      }
      if (this.ac.signal.aborted) return
      this.log.warn("event stream ended, reconnecting", { delay, open: this.channels.size })
      for (const c of this.channels.values()) c.push({ type: STREAM_LOST, data: {} })
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 5000)
    }
  }
}
