import { createHash, timingSafeEqual } from "node:crypto"
import type { BridgeConfig } from "../config.ts"
import type { Bridge, Turn } from "../core/bridge.ts"
import type { CanonicalEvent } from "../core/canonical.ts"
import { BridgeError, toBridgeError } from "../core/errors.ts"
import type { Logger } from "../obs/logger.ts"
import { decodeChatRequest } from "../protocols/openai-chat/decode.ts"
import { ChunkEncoder, PING, completionBody } from "../protocols/openai-chat/encode.ts"

export interface Registry {
  /** Escolhe a location pelo header `x-opencode-directory` (ou a primeira). Lança `BridgeError`. */
  pick(directoryHeader: string | null): Bridge
  status(): ReturnType<Bridge["health"]>[]
}

export interface ServerDeps {
  config: BridgeConfig
  log: Logger
  registry: Registry
  /** Intervalo do `: ping` em streams ociosos. */
  keepaliveMs?: number
  /** Sobrescreve a porta da configuração (testes usam 0). */
  port?: number
}

const sha = (s: string) => createHash("sha256").update(s).digest()

export function createServer(deps: ServerDeps) {
  const { config, log, registry } = deps
  const keepaliveMs = deps.keepaliveMs ?? 15_000
  const bootSeconds = Math.floor(Date.now() / 1000)

  function corsHeaders(req: Request): Record<string, string> | undefined {
    const origin = req.headers.get("origin")
    if (!origin) return {}
    const allowed = config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)
    if (!allowed) return undefined
    return {
      "access-control-allow-origin": config.corsOrigins.includes("*") ? "*" : origin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "authorization, content-type",
      vary: "origin",
    }
  }

  function authenticate(req: Request) {
    if (config.apiKeys.length === 0) return
    const header = req.headers.get("authorization") ?? ""
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
    const given = sha(token)
    let ok = false
    for (const k of config.apiKeys) if (timingSafeEqual(given, sha(k))) ok = true
    if (!ok) throw BridgeError.unauthorized()
  }

  async function chat(req: Request, reqId: string, headers: Record<string, string>): Promise<Response> {
    const started = Date.now()
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw BridgeError.invalid("The request body is not valid JSON", "invalid_json")
    }
    const canon = decodeChatRequest(body)
    const bridge = registry.pick(req.headers.get("x-opencode-directory"))
    const rlog = log.child({ reqId })
    if (canon.ignored.length) rlog.info("ignored request fields", { fields: canon.ignored })

    const ac = new AbortController()
    req.signal.addEventListener("abort", () => ac.abort(), { once: true })
    const total = setTimeout(
      () => ac.abort(BridgeError.timeout("The request exceeded the maximum duration", "total_timeout")),
      config.timeouts.totalMs,
    )

    let turn: Turn
    try {
      turn = await bridge.begin(canon, ac.signal, rlog)
    } catch (e) {
      clearTimeout(total)
      throw e
    }
    const id = `chatcmpl-${reqId}`
    const stats = { toolCalls: 0, finish: "unknown" as string }
    const track = (e: CanonicalEvent) => {
      if (e.type === "tool_call") stats.toolCalls++
      if (e.type === "finish") stats.finish = e.reason
    }
    const done = (status: number, error?: unknown) =>
      rlog.info("chat completion finished", {
        status,
        durationMs: Date.now() - started,
        finishReason: stats.finish,
        toolCalls: stats.toolCalls,
        model: turn.model,
        sessionID: turn.sessionID,
        stream: canon.stream,
        ...(error ? { error } : {}),
      })

    if (!canon.stream) {
      try {
        const events: CanonicalEvent[] = []
        for await (const e of turn.events) {
          track(e)
          events.push(e)
        }
        done(200)
        return Response.json(completionBody(id, turn.model, events), { headers })
      } catch (e) {
        done(toBridgeError(e).status, e)
        throw e
      } finally {
        clearTimeout(total)
      }
    }

    const te = new TextEncoder()
    const enc = new ChunkEncoder(id, turn.model, canon.includeUsage)
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let lastWrite = Date.now()
        let open = true
        const write = (chunks: string[]) => {
          if (!open) return
          try {
            for (const c of chunks) controller.enqueue(te.encode(c))
            lastWrite = Date.now()
          } catch {
            open = false
          }
        }
        const ping = setInterval(() => {
          if (Date.now() - lastWrite >= keepaliveMs - 50) write([PING])
        }, Math.max(10, Math.floor(keepaliveMs / 3)))
        try {
          write(enc.start())
          for await (const e of turn.events) {
            track(e)
            write(enc.encode(e))
          }
          write(enc.end())
          done(200)
        } catch (e) {
          const be = toBridgeError(e)
          if (be.type === "cancelled") done(499)
          else {
            write(enc.error(be))
            done(be.status, e)
          }
        } finally {
          clearInterval(ping)
          clearTimeout(total)
          try {
            controller.close()
          } catch {}
        }
      },
      cancel() {
        ac.abort()
      },
    })
    return new Response(stream, {
      headers: { ...headers, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" },
    })
  }

  async function route(req: Request, reqId: string, headers: Record<string, string>): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, "") || "/"

    if (path === "/health" && req.method === "GET") {
      const locations = registry.status()
      return Response.json(
        locations.length ? { status: "ok", locations } : { status: "unavailable", reason: "no OpenCode location is registered" },
        { status: locations.length ? 200 : 503, headers },
      )
    }

    if (path.startsWith("/v1/")) authenticate(req)

    if (path === "/v1/models" && req.method === "GET") {
      const bridge = registry.pick(req.headers.get("x-opencode-directory"))
      const models = await bridge.models()
      return Response.json(
        {
          object: "list",
          data: models.map((m) => ({ id: `${m.providerID}/${m.id}`, object: "model", created: bootSeconds, owned_by: m.providerID })),
        },
        { headers },
      )
    }
    if (path === "/v1/chat/completions" && req.method === "POST") return chat(req, reqId, headers)

    throw BridgeError.notFound("not_found", `No route for ${req.method} ${path}`)
  }

  return Bun.serve({
    hostname: config.host,
    port: deps.port ?? config.port,
    // streams longos não podem cair por idle timeout; os timeouts por fase são do bridge
    idleTimeout: 0,
    async fetch(req) {
      const reqId = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      const cors = corsHeaders(req)
      if (req.method === "OPTIONS") {
        return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 })
      }
      const headers = { ...(cors ?? {}), "x-request-id": reqId }
      try {
        return await route(req, reqId, headers)
      } catch (e) {
        const be = toBridgeError(e)
        if (be.status >= 500) log.error("request failed", { reqId, error: e })
        else log.info("request rejected", { reqId, status: be.status, code: be.code, message: be.message })
        return Response.json(be.toBody(), { status: be.status, headers })
      }
    },
  })
}
