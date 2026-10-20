import { describe, expect, test } from "bun:test"
import { ConfigError, defaultLogFile, parseConfig } from "../src/config.ts"
import { PendingCalls } from "../src/core/pending.ts"
import { BridgeError } from "../src/core/errors.ts"
import { CONTINUE_PROMPT, splitConversation, toNativeMessages } from "../src/core/history.ts"
import { nullLogger } from "../src/obs/logger.ts"
import { Channel, EventMux, STREAM_LOST } from "../src/opencode/event-mux.ts"
import { ModelCatalog, resolveModel } from "../src/opencode/models.ts"
import { decodeChatRequest } from "../src/protocols/openai-chat/decode.ts"
import { ChunkEncoder, DONE, completionBody } from "../src/protocols/openai-chat/encode.ts"
import { FakeHost, MODELS } from "./fake-host.ts"
import { assistantCalls, sleep, system, toolMsg, user } from "./helpers.ts"

describe("config", () => {
  test("padrões seguros", () => {
    const c = parseConfig(undefined)
    expect(c).toMatchObject({ host: "127.0.0.1", port: 4010, defaultAgent: "build", autoApprove: "none", readOnly: false })
    expect(c.logFile).toBe(defaultLogFile())
    expect(parseConfig({ logFile: false }).logFile).toBeUndefined()
  })
  test("valida e acumula problemas", () => {
    try {
      parseConfig({ port: "x", autoApprove: "yes", timeouts: { idleMs: -1 }, apiKeys: [1] })
      throw new Error("should fail")
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      const p = (e as ConfigError).problems.join("|")
      expect(p).toContain("port")
      expect(p).toContain("autoApprove")
      expect(p).toContain("timeouts.idleMs")
      expect(p).toContain("apiKeys")
    }
  })
  test("bind fora de loopback exige chave", () => {
    expect(() => parseConfig({ host: "0.0.0.0" })).toThrow(/apiKeys is required/)
    expect(parseConfig({ host: "0.0.0.0", apiKeys: ["k"] }).host).toBe("0.0.0.0")
  })
})

describe("resolveModel", () => {
  const def = { providerID: "opencode", id: "fast" }
  test("exato, único sem provider, padrão", () => {
    expect(resolveModel("openai/gpt", MODELS, def).id).toBe("gpt")
    expect(resolveModel("gpt", MODELS, def).providerID).toBe("openai")
    expect(resolveModel(undefined, MODELS, def)).toMatchObject({ providerID: "opencode", id: "fast" })
    expect(resolveModel("  ", MODELS, def).id).toBe("fast")
  })
  test("ambíguo lista candidatos; inexistente é 404; sem padrão é 400", () => {
    try {
      resolveModel("fast", MODELS, def)
      throw new Error("x")
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: "model_ambiguous", extra: { candidates: ["opencode/fast", "anthropic/fast"] } })
    }
    expect(() => resolveModel("a/b", MODELS, def)).toThrow(BridgeError)
    expect(() => resolveModel(undefined, MODELS, undefined)).toThrow(/no default/)
  })
  test("id com barra: só casa exato", () => {
    const m = [{ providerID: "openrouter", id: "anthropic/claude", name: "c", temperature: true, tools: true }]
    expect(resolveModel("openrouter/anthropic/claude", m, undefined).id).toBe("anthropic/claude")
    expect(() => resolveModel("anthropic/claude", m, undefined)).toThrow(/does not exist/)
  })
  test("catálogo usa cache curto", async () => {
    let calls = 0
    let now = 0
    const c = new ModelCatalog(async () => (calls++, MODELS), 100, () => now)
    await c.list()
    await c.list()
    expect(calls).toBe(1)
    now = 200
    await c.list()
    expect(calls).toBe(2)
  })
})

describe("decodeChatRequest", () => {
  const base = { model: "m", messages: [{ role: "user", content: "oi" }] }
  test("caso simples e flags", () => {
    const r = decodeChatRequest({ ...base, stream: true, stream_options: { include_usage: true }, max_completion_tokens: 10, stop: "x", temperature: 0.5 })
    expect(r).toMatchObject({ model: "m", stream: true, includeUsage: true, params: { maxTokens: 10, stop: ["x"], temperature: 0.5 } })
  })
  test("conteúdo em partes, developer vira system, partes não textuais são ignoradas", () => {
    const r = decodeChatRequest({
      messages: [
        { role: "developer", content: "dev" },
        { role: "user", content: [{ type: "text", text: "a" }, { type: "image_url", image_url: { url: "u" } }, { type: "text", text: "b" }] },
      ],
    })
    expect(r.messages).toEqual([
      { role: "system", text: "dev" },
      { role: "user", text: "ab" },
    ])
    expect(r.ignored.join()).toContain("image_url")
  })
  test("campos desconhecidos são ignorados, n>1 é registrado", () => {
    const r = decodeChatRequest({ ...base, logprobs: true, user: "u", n: 2 })
    expect(r.ignored).toEqual(expect.arrayContaining(["logprobs", "user", expect.stringContaining("n(")]))
  })
  test("tools, tool_choice, tool_calls e mensagens tool", () => {
    const r = decodeChatRequest({
      messages: [
        { role: "user", content: "x" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: '{"a":1}' } }] },
        { role: "tool", tool_call_id: "c1", content: "res" },
      ],
      tools: [{ type: "function", function: { name: "f", description: "d", parameters: { type: "object" } } }, { type: "web_search" }],
      tool_choice: { type: "function", function: { name: "f" } },
    })
    expect(r.tools).toEqual([{ name: "f", description: "d", parameters: { type: "object" } }])
    expect(r.toolChoice).toEqual({ name: "f" })
    expect(r.messages[1]).toEqual({ role: "assistant", text: "", toolCalls: [{ id: "c1", name: "f", arguments: '{"a":1}' }] })
    expect(r.messages[2]).toEqual({ role: "tool", toolCallId: "c1", text: "res" })
    expect(r.ignored.join()).toContain("web_search")
  })
  test("tool sem parâmetros recebe schema vazio", () => {
    const r = decodeChatRequest({ ...base, tools: [{ type: "function", function: { name: "noargs" } }] })
    expect(r.tools[0]!.parameters).toEqual({ type: "object", properties: {} })
  })
  test.each([
    [null, "JSON object"],
    [{}, "messages"],
    [{ messages: [] }, "messages"],
    [{ messages: [{ role: "robot", content: "x" }] }, "role"],
    [{ messages: [{ role: "tool", content: "x" }] }, "tool_call_id"],
    [{ ...base, tools: [{ type: "function", function: {} }] }, "name"],
    [{ ...base, tools: [{ type: "function", function: { name: "a" } }, { type: "function", function: { name: "a" } }] }, "duplicate"],
    [{ ...base, tool_choice: { type: "function", function: { name: "zz" } } }, "unknown tool"],
    [{ ...base, temperature: "hot" }, "temperature"],
    [{ ...base, stop: 5 }, "stop"],
  ])("rejeita entrada inválida %#", (body, fragment) => {
    try {
      decodeChatRequest(body)
      throw new Error("should throw")
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError)
      expect((e as BridgeError).status).toBe(400)
      expect((e as BridgeError).message + JSON.stringify((e as BridgeError).extra)).toContain(fragment)
    }
  })
})

describe("encode", () => {
  const parse = (chunks: string[]) =>
    chunks.filter((c) => c.startsWith("data: {")).map((c) => JSON.parse(c.slice(6)))

  test("sequência de chunks: role, texto, finish, usage e DONE", () => {
    const enc = new ChunkEncoder("chatcmpl-1", "p/m", true)
    const out = [
      ...enc.encode({ type: "text", delta: "Oi" }),
      ...enc.encode({ type: "usage", usage: { promptTokens: 3, completionTokens: 2 } }),
      ...enc.encode({ type: "finish", reason: "stop" }),
      ...enc.end(),
    ]
    const objs = parse(out)
    expect(objs[0].choices[0].delta).toEqual({ role: "assistant", content: "" })
    expect(objs[1].choices[0].delta).toEqual({ content: "Oi" })
    expect(objs[2].choices[0]).toMatchObject({ delta: {}, finish_reason: "stop" })
    expect(objs[3]).toMatchObject({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } })
    expect(out.at(-1)).toBe(DONE)
    expect(objs.every((o) => o.object === "chat.completion.chunk" && o.model === "p/m")).toBe(true)
  })
  test("sem include_usage não há chunk de usage", () => {
    const enc = new ChunkEncoder("i", "m", false)
    const out = [...enc.encode({ type: "usage", usage: { promptTokens: 1, completionTokens: 1 } }), ...enc.encode({ type: "finish", reason: "stop" }), ...enc.end()]
    expect(parse(out).some((o) => o.usage)).toBe(false)
  })
  test("tool call: nome com arguments vazio e depois os argumentos", () => {
    const enc = new ChunkEncoder("i", "m", false)
    const out = parse(enc.encode({ type: "tool_call", index: 1, call: { id: "c", name: "f", arguments: '{"a":1}' } }))
    expect(out[1].choices[0].delta.tool_calls[0]).toEqual({ index: 1, id: "c", type: "function", function: { name: "f", arguments: "" } })
    expect(out[2].choices[0].delta.tool_calls[0]).toEqual({ index: 1, function: { arguments: '{"a":1}' } })
  })
  test("erro no meio do stream: chunk de erro e DONE", () => {
    const enc = new ChunkEncoder("i", "m", false)
    const out = enc.error(BridgeError.upstream("falhou", "x"))
    expect(parse(out).at(-1)).toMatchObject({ error: { message: "falhou", type: "api_error", code: "x" } })
    expect(out.at(-1)).toBe(DONE)
  })
  test("resposta não-streaming com tool_calls tem content null", () => {
    const body = completionBody("id", "m", [
      { type: "tool_call", index: 0, call: { id: "c", name: "f", arguments: "{}" } },
      { type: "usage", usage: { promptTokens: 1, completionTokens: 2 } },
      { type: "finish", reason: "tool_calls" },
    ])
    expect(body.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{}" } }] } })
    expect(body.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
  })
})

describe("history", () => {
  test("split: system, histórico e prompt", () => {
    const s = splitConversation([system("a"), user("1"), { role: "assistant", text: "r", toolCalls: [] }, system("b"), user("2")])
    expect(s.systemText).toBe("a\n\nb")
    expect(s.prompt).toBe("2")
    expect(s.history).toHaveLength(2)
    expect(s.promptIsPlaceholder).toBe(false)
  })
  test("split: cauda de tool results usa placeholder", () => {
    const s = splitConversation([user("1"), assistantCalls([{ id: "c", name: "f", args: {} }]), toolMsg("c", "r")])
    expect(s).toMatchObject({ prompt: CONTINUE_PROMPT, promptIsPlaceholder: true })
    expect(s.tail.map((t) => t.toolCallId)).toEqual(["c"])
    expect(s.history).toHaveLength(3)
  })
  test("split: última mensagem do assistant ou conversa vazia é 400", () => {
    expect(() => splitConversation([user("1"), { role: "assistant", text: "x", toolCalls: [] }])).toThrow(/last message/)
    expect(() => splitConversation([system("só system")])).toThrow(/at least one/)
  })
  test("argumentos inválidos de tool call são preservados em _raw", () => {
    const n = toNativeMessages([assistantCalls([]), { role: "assistant", text: "", toolCalls: [{ id: "c", name: "f", arguments: "{oops" }] }], (x) => `p_${x}`)
    expect((n[0] as any).content[0]).toMatchObject({ type: "tool-call", name: "p_f", input: { _raw: "{oops" } })
  })
})

describe("PendingCalls", () => {
  test("resolve depois e antes do wait", async () => {
    const p = new PendingCalls()
    const w = p.wait("a")
    p.resolve("a", "x")
    expect(await w).toBe("x")
    p.resolve("b", "early")
    expect(await p.wait("b")).toBe("early")
    expect(p.size).toBe(0)
  })
  test("signal e discard rejeitam", async () => {
    const p = new PendingCalls()
    const ac = new AbortController()
    const w = p.wait("a", ac.signal).catch((e) => e)
    ac.abort()
    expect(String(await w)).toContain("cancelled")
    const w2 = p.wait("b").catch((e) => e)
    p.discard(["b"], new Error("bye"))
    expect(String(await w2)).toContain("bye")
    p.resolve("c", "x")
    p.discard(["c"], new Error("n/a"))
    expect(p.size).toBe(0)
  })
})

describe("Channel e EventMux", () => {
  test("entrega fila, timeout e fechamento", async () => {
    const c = new Channel()
    c.push({ type: "a", data: {} })
    expect(await c.next(10)).toMatchObject({ kind: "event" })
    expect(await c.next(10)).toEqual({ kind: "timeout" })
    const waiting = c.next(1000)
    c.close("fim")
    expect(await waiting).toEqual({ kind: "closed", reason: "fim" })
    c.push({ type: "ignored", data: {} })
    expect(await c.next(10)).toEqual({ kind: "closed", reason: "fim" })
  })
  test("despacha por sessionID e avisa canais quando a assinatura cai", async () => {
    const host = new FakeHost()
    const mux = new EventMux(host, nullLogger)
    mux.start()
    const a = mux.open("A")
    const b = mux.open("B")
    await sleep(5)
    host.emit({ type: "t1", data: { sessionID: "A" } })
    host.emit({ type: "t2", data: { sessionID: "B" } })
    host.emit({ type: "sem-sessao", data: {} })
    expect(await a.next(100)).toMatchObject({ event: { type: "t1" } })
    expect(await b.next(100)).toMatchObject({ event: { type: "t2" } })
    expect(await a.next(10)).toEqual({ kind: "timeout" })
    mux.release("A")
    expect(a.closed).toBe(true)
    expect(mux.size).toBe(1)
    await mux.stop()
    expect(b.closed).toBe(true)
  })
  test("reconecta quando o iterador termina", async () => {
    let subs = 0
    const host = new FakeHost()
    const orig = host.subscribe.bind(host)
    host.subscribe = (signal) => {
      subs++
      if (subs === 1) return (async function* () {})() // termina na hora
      return orig(signal)
    }
    const mux = new EventMux(host, nullLogger)
    mux.start()
    const ch = mux.open("A")
    expect(await ch.next(1000)).toMatchObject({ event: { type: STREAM_LOST } })
    await sleep(300)
    expect(subs).toBe(2)
    host.emit({ type: "ok", data: { sessionID: "A" } })
    expect(await ch.next(500)).toMatchObject({ event: { type: "ok" } })
    await mux.stop()
  })
})
