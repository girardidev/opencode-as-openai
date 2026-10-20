import { describe, expect, test } from "bun:test"
import { BridgeError } from "../src/core/errors.ts"
import { nullLogger } from "../src/obs/logger.ts"
import { FakeHost, textScript, toolScript, type Script } from "./fake-host.ts"
import { assistantCalls, collect, finish, live, makeBridge, req, sleep, text, toolCalls, toolMsg, user, weatherTool } from "./helpers.ts"

/** Gerador pseudoaleatório determinístico (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dispatcher: Script = async (api) => {
  const kind = api.text.split(":")[1]
  if (kind === "slow") return textScript(["a", "b", "c", "d", "e", "f"], { delayMs: 12 })(api)
  if (kind === "pair")
    return toolScript(
      [
        { name: "get_weather", input: { city: "A" } },
        { name: "get_weather", input: { city: "B" } },
      ],
      "pair-done",
    )(api)
  if (kind === "tool" || kind === "abandon" || kind === "abort-resume") return toolScript([{ name: "get_weather", input: { city: "X" } }], "tool-done")(api)
  return textScript(["ok"], { delayMs: 1 })(api)
}

describe("soak", () => {
  test("300 conversas concorrentes com cancelamentos, abandono e retomadas não vazam nada", async () => {
    const TTL = 80
    const { bridge, host } = await makeBridge({ timeouts: { pendingTtlMs: TTL, idleMs: 2000, firstEventMs: 2000 } })
    host.script = dispatcher
    const rand = rng(42)
    const kinds = ["text", "slow", "tool", "abandon", "pair", "abort-resume"] as const
    const outcome: Record<string, number> = {}
    const bump = (k: string) => (outcome[k] = (outcome[k] ?? 0) + 1)

    const resumeMessages = (prompt: string, calls: { id: string; name: string }[]) => [
      user(prompt),
      assistantCalls(calls.map((c) => ({ id: c.id, name: c.name, args: {} }))),
      ...calls.map((c) => toolMsg(c.id, "res")),
    ]

    const run = async (i: number) => {
      const kind = kinds[i % kinds.length]!
      const prompt = `scenario:${kind}:${i}`
      await sleep(Math.floor(rand() * 30))
      const base = req({ messages: [user(prompt)], tools: [weatherTool] })

      if (kind === "slow") {
        const ac = live()
        const turn = await bridge.begin(base, ac.signal, nullLogger)
        const done = collect(turn.events).catch((e) => e)
        await sleep(Math.floor(rand() * 40))
        ac.abort()
        const r = await done
        bump(r instanceof BridgeError ? `slow:${r.type}` : "slow:completed")
        return
      }
      const first = await collect((await bridge.begin(base, live().signal, nullLogger)).events)
      if (kind === "text") {
        expect(text(first)).toBe("ok")
        return bump("text")
      }
      const calls = toolCalls(first).map((c) => ({ id: c.call.id, name: c.call.name }))
      expect(finish(first)).toEqual({ type: "finish", reason: "tool_calls" })
      if (kind === "abandon") return bump("abandon") // o TTL limpa

      if (kind === "pair") {
        const partial = await bridge.begin(req({ tools: [weatherTool], messages: resumeMessages(prompt, calls).slice(0, 3) }), live().signal, nullLogger).catch((e) => e)
        expect(partial).toBeInstanceOf(BridgeError)
      }
      const ac = live()
      const resumed = await bridge.begin(req({ tools: [weatherTool], messages: resumeMessages(prompt, calls) }), ac.signal, nullLogger)
      const done = collect(resumed.events).catch((e) => e)
      if (kind === "abort-resume") {
        await sleep(Math.floor(rand() * 5))
        ac.abort()
      }
      const r = await done
      if (r instanceof BridgeError) return bump(`${kind}:${r.type}`)
      expect(text(r)).toContain("done")
      bump(kind)
    }

    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        run(i).catch((e) => {
          throw new Error(`scenario ${kinds[i % kinds.length]} #${i} failed: ${e}`)
        }),
      ),
    )
    await sleep(TTL * 3) // deixa os TTLs das conversas abandonadas expirarem

    const h = bridge.health()
    expect(h.conversations).toBe(0)
    expect(h.awaitingClient).toBe(0)
    expect(h.pendingCalls).toBe(0)
    expect(h.channels).toBe(0)
    expect(host.tools.size).toBe(0)
    // toda sessão criada foi removida exatamente uma vez
    expect(host.sessions.size).toBeGreaterThan(250)
    expect(new Set(host.removed).size).toBe(host.sessions.size)
    expect(host.removed.length).toBe(host.sessions.size)
    expect(host.contextHooks).toHaveLength(1)
    // a contabilidade fecha: cada conversa iniciada foi finalizada
    const c = h.metrics.counters
    const finished = Object.entries(c)
      .filter(([k]) => k.startsWith("conversations.finished."))
      .reduce((a, [, v]) => a + v, 0)
    expect(c["conversations.started"]).toBe(finished)
    expect(outcome.text).toBeGreaterThan(40)
    expect(outcome.abandon).toBeGreaterThan(40)
  }, 30_000)
})

describe("métricas", () => {
  test("contadores e latências por resposta", async () => {
    const { bridge, host } = await makeBridge()
    host.script = textScript(["a"])
    await collect((await bridge.begin(req(), live().signal, nullLogger)).events)
    const m = bridge.health().metrics
    expect(m.counters).toMatchObject({
      "conversations.started": 1,
      "responses.started": 1,
      "responses.done": 1,
      "conversations.finished.done": 1,
      "tokens.prompt": 150,
      "tokens.completion": 10,
    })
    expect(m.latency.response_ms?.count).toBe(1)
    expect(m.latency.first_event_ms?.count).toBe(1)
  })

  test("erros são contados por código", async () => {
    const { bridge, host } = await makeBridge({ timeouts: { firstEventMs: 20 } })
    host.script = async () => {}
    await collect((await bridge.begin(req(), live().signal, nullLogger)).events).catch(() => {})
    expect(bridge.health().metrics.counters["errors.first_event_timeout"]).toBe(1)
  })
})
