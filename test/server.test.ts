import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import OpenAI from "openai"
import { Hosting } from "../src/hosting.ts"
import { FakeHost, textScript, toolScript } from "./fake-host.ts"
import { sleep } from "./helpers.ts"

const open: Hosting[] = []

async function boot(options: Record<string, unknown> = {}, host = new FakeHost(), serverOptions: { keepaliveMs?: number } = { keepaliveMs: 80 }) {
  const hosting = new Hosting({ port: 0, ...serverOptions })
  open.push(hosting)
  await hosting.register(host, { logFile: false, port: 0, ...options })
  const base = `http://127.0.0.1:${hosting.port}`
  return { hosting, host, base, client: new OpenAI({ baseURL: `${base}/v1`, apiKey: "test", maxRetries: 0 }) }
}

afterEach(async () => {
  for (const h of open.splice(0)) for (const d of h.registered) await h.unregister(d)
})

const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })

const weatherTool = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Weather",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
}

describe("rotas básicas", () => {
  test("/v1/models no formato OpenAI", async () => {
    const { base } = await boot()
    const r = await fetch(`${base}/v1/models`)
    const j: any = await r.json()
    expect(r.status).toBe(200)
    expect(j.object).toBe("list")
    expect(j.data.map((m: any) => m.id)).toEqual(["opencode/fast", "openai/gpt", "anthropic/fast"])
    expect(j.data[0]).toMatchObject({ object: "model", owned_by: "opencode", created: expect.any(Number) })
    expect(r.headers.get("x-request-id")).toBeTruthy()
  })

  test("chat completion JSON", async () => {
    const { base, host } = await boot()
    host.script = textScript(["Olá ", "mundo"])
    const r = await post(base, { model: "opencode/fast", messages: [{ role: "user", content: "oi" }] })
    const j: any = await r.json()
    expect(r.status).toBe(200)
    expect(j).toMatchObject({
      object: "chat.completion",
      model: "opencode/fast",
      choices: [{ index: 0, message: { role: "assistant", content: "Olá mundo" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 },
    })
    expect(j.id).toStartWith("chatcmpl-")
  })

  test("streaming SSE: ordem dos chunks, include_usage e [DONE]", async () => {
    const { base, host } = await boot()
    host.script = textScript(["a", "b"])
    const r = await post(base, { messages: [{ role: "user", content: "oi" }], stream: true, stream_options: { include_usage: true } })
    expect(r.headers.get("content-type")).toStartWith("text/event-stream")
    const raw = await r.text()
    const events = raw.split("\n\n").filter(Boolean)
    expect(events.at(-1)).toBe("data: [DONE]")
    const objs = events.slice(0, -1).map((e) => JSON.parse(e.replace(/^data: /, "")))
    expect(objs[0].choices[0].delta.role).toBe("assistant")
    expect(objs.slice(1, 3).map((o) => o.choices[0].delta.content)).toEqual(["a", "b"])
    expect(objs[3].choices[0].finish_reason).toBe("stop")
    expect(objs[4]).toMatchObject({ choices: [], usage: { total_tokens: 160 } })
  })

  test("health e 404", async () => {
    const { base, hosting } = await boot()
    const h = await fetch(`${base}/health`)
    expect(h.status).toBe(200)
    expect(await h.json()).toMatchObject({ status: "ok", locations: [{ conversations: 0 }] })
    const nf = await fetch(`${base}/v1/nada`)
    expect(nf.status).toBe(404)
    expect(((await nf.json()) as any).error.code).toBe("not_found")
    await hosting.unregister(hosting.registered[0]!)
  })
})

describe("erros no formato OpenAI", () => {
  test("JSON inválido, messages ausente, modelo inexistente e ambíguo", async () => {
    const { base } = await boot()
    const bad = await fetch(`${base}/v1/chat/completions`, { method: "POST", body: "{nope" })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: { type: "invalid_request_error", code: "invalid_json" } })
    const nomsg = await post(base, { model: "x" })
    expect(nomsg.status).toBe(400)
    expect(((await nomsg.json()) as any).error).toMatchObject({ param: "messages", type: "invalid_request_error" })
    const missing = await post(base, { model: "nope/x", messages: [{ role: "user", content: "a" }] })
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as any).error.code).toBe("model_not_found")
    const amb = await post(base, { model: "fast", messages: [{ role: "user", content: "a" }] })
    expect(amb.status).toBe(400)
    expect(((await amb.json()) as any).error).toMatchObject({ code: "model_ambiguous", candidates: ["opencode/fast", "anthropic/fast"] })
  })

  test("erro do OpenCode durante o stream vira chunk de erro + [DONE]", async () => {
    const { base, host } = await boot()
    host.script = async (api) => {
      api.emit("session.execution.started")
      api.emit("session.text.delta", { delta: "parcial" })
      api.emit("session.step.failed", { error: { type: "provider", message: "quebrou" } })
    }
    const raw = await (await post(base, { messages: [{ role: "user", content: "a" }], stream: true })).text()
    expect(raw).toContain('"content":"parcial"')
    expect(raw).toContain('"message":"quebrou"')
    expect(raw.trimEnd().endsWith("data: [DONE]")).toBe(true)
  })

  test("erro antes do stream usa status HTTP", async () => {
    const { base, host } = await boot()
    host.failCreate = true
    const r = await post(base, { messages: [{ role: "user", content: "a" }], stream: true })
    expect(r.status).toBe(502)
  })
})

describe("autenticação e CORS", () => {
  test("apiKeys: 401 sem chave ou com chave errada; /health é livre", async () => {
    const { base } = await boot({ apiKeys: ["segredo", "outra"] })
    expect((await fetch(`${base}/v1/models`)).status).toBe(401)
    expect((await fetch(`${base}/v1/models`, { headers: { authorization: "Bearer errada" } })).status).toBe(401)
    expect((await fetch(`${base}/v1/models`, { headers: { authorization: "Bearer outra" } })).status).toBe(200)
    expect((await fetch(`${base}/health`)).status).toBe(200)
    const j: any = await (await fetch(`${base}/v1/models`)).json()
    expect(j.error).toMatchObject({ type: "authentication_error", code: "invalid_api_key" })
  })

  test("sem chaves em loopback aceita qualquer Authorization", async () => {
    const { base } = await boot()
    expect((await fetch(`${base}/v1/models`, { headers: { authorization: "Bearer qualquer" } })).status).toBe(200)
  })

  test("CORS só para origens configuradas", async () => {
    const { base } = await boot({ corsOrigins: ["https://app.example"] })
    const ok = await fetch(`${base}/v1/models`, { method: "OPTIONS", headers: { origin: "https://app.example", "access-control-request-method": "POST" } })
    expect(ok.status).toBe(204)
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://app.example")
    const no = await fetch(`${base}/v1/models`, { method: "OPTIONS", headers: { origin: "https://evil.example" } })
    expect(no.status).toBe(403)
    const get = await fetch(`${base}/v1/models`, { headers: { origin: "https://evil.example" } })
    expect(get.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("tool calling por HTTP", () => {
  test("round-trip não-streaming", async () => {
    const { base, host } = await boot()
    host.script = toolScript([{ name: "get_weather", input: { city: "Paris" } }], "Sol em Paris.")
    const first: any = await (await post(base, { messages: [{ role: "user", content: "clima?" }], tools: [weatherTool] })).json()
    expect(first.choices[0].finish_reason).toBe("tool_calls")
    const call = first.choices[0].message.tool_calls[0]
    expect(call).toMatchObject({ type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } })
    expect(first.choices[0].message.content).toBeNull()

    const second: any = await (
      await post(base, {
        tools: [weatherTool],
        messages: [{ role: "user", content: "clima?" }, first.choices[0].message, { role: "tool", tool_call_id: call.id, content: "22C" }],
      })
    ).json()
    expect(second.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: "Sol em Paris." } })
  })

  test("resultado parcial devolve 400", async () => {
    const { base, host } = await boot()
    host.script = toolScript([{ name: "get_weather", input: { city: "A" } }, { name: "get_weather", input: { city: "B" } }], "ok")
    const first: any = await (await post(base, { messages: [{ role: "user", content: "x" }], tools: [weatherTool] })).json()
    const [a] = first.choices[0].message.tool_calls
    const r = await post(base, {
      tools: [weatherTool],
      messages: [{ role: "user", content: "x" }, first.choices[0].message, { role: "tool", tool_call_id: a.id, content: "r" }],
    })
    expect(r.status).toBe(400)
    expect(((await r.json()) as any).error.code).toBe("tool_results_mismatch")
  })
})

describe("SDK oficial da OpenAI", () => {
  test("create sem streaming", async () => {
    const { client, host } = await boot()
    host.script = textScript(["via sdk"])
    const r = await client.chat.completions.create({ model: "opencode/fast", messages: [{ role: "user", content: "oi" }] })
    expect(r.choices[0]!.message.content).toBe("via sdk")
    expect(r.usage?.total_tokens).toBe(160)
  })

  test("create com stream e include_usage", async () => {
    const { client, host } = await boot()
    host.script = textScript(["a", "b", "c"])
    const stream = await client.chat.completions.create({
      model: "opencode/fast",
      messages: [{ role: "user", content: "oi" }],
      stream: true,
      stream_options: { include_usage: true },
    })
    let content = ""
    let usage: unknown
    let finish: unknown
    for await (const chunk of stream) {
      content += chunk.choices[0]?.delta.content ?? ""
      finish ??= chunk.choices[0]?.finish_reason
      if (chunk.usage) usage = chunk.usage
    }
    expect(content).toBe("abc")
    expect(finish).toBe("stop")
    expect(usage).toMatchObject({ total_tokens: 160 })
  })

  test("helper stream() agrega tool_calls paralelas e o ciclo completo funciona", async () => {
    const { client, host } = await boot()
    host.script = toolScript(
      [
        { name: "get_weather", input: { city: "Paris" } },
        { name: "get_weather", input: { city: "Tokyo" } },
      ],
      "Os dois estão ensolarados.",
      { preamble: "Consultando. " },
    )
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: "clima em Paris e Tokyo?" }]
    const first = await client.chat.completions.stream({ model: "opencode/fast", messages, tools: [weatherTool] }).finalChatCompletion()
    const msg = first.choices[0]!.message
    expect(first.choices[0]!.finish_reason).toBe("tool_calls")
    expect(msg.content).toBe("Consultando. ")
    expect(msg.tool_calls).toHaveLength(2)
    expect(msg.tool_calls!.map((c) => (c.type === "function" ? JSON.parse(c.function.arguments).city : "")).sort()).toEqual(["Paris", "Tokyo"])

    messages.push(msg, ...msg.tool_calls!.map((c) => ({ role: "tool" as const, tool_call_id: c.id, content: "ensolarado" })))
    const second = await client.chat.completions.stream({ model: "opencode/fast", messages, tools: [weatherTool] }).finalChatCompletion()
    expect(second.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: "Os dois estão ensolarados." } })
  })

  test("erros viram APIError tipados", async () => {
    const { client } = await boot()
    const err = await client.chat.completions.create({ model: "nope/x", messages: [{ role: "user", content: "a" }] }).catch((e) => e)
    expect(err).toBeInstanceOf(OpenAI.APIError)
    expect(err.status).toBe(404)
    expect(err.code).toBe("model_not_found")
  })
})

describe("ciclo de vida", () => {
  test("keepalive: pings em stream ocioso", async () => {
    const { base, host } = await boot()
    host.script = textScript(["a", "b"], { delayMs: 250 })
    const raw = await (await post(base, { messages: [{ role: "user", content: "x" }], stream: true })).text()
    expect(raw).toContain(": ping")
    expect(raw).toContain('"content":"a"')
  })

  test("desconexão do cliente interrompe e remove a sessão", async () => {
    const { base, host } = await boot()
    host.script = async (api) => {
      api.emit("session.execution.started")
      api.emit("session.text.delta", { delta: "começo" })
      await new Promise(() => {})
    }
    const ac = new AbortController()
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      signal: ac.signal,
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }], stream: true }),
    })
    const reader = r.body!.getReader()
    await reader.read() // primeiro chunk
    ac.abort()
    await reader.cancel().catch(() => {})
    await sleep(100)
    expect(host.interrupts).toEqual(["ses_1"])
    expect(host.removed).toEqual(["ses_1"])
  })

  test("timeout total devolve 504", async () => {
    const { base, host } = await boot({ timeouts: { totalMs: 60 } })
    host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {})
    }
    const r = await post(base, { messages: [{ role: "user", content: "x" }] })
    expect(r.status).toBe(504)
    expect(((await r.json()) as any).error).toMatchObject({ type: "timeout_error", code: "total_timeout" })
    expect(host.interrupts).toEqual(["ses_1"])
  })

  test("timeout do primeiro evento devolve 504", async () => {
    const { base, host } = await boot({ timeouts: { firstEventMs: 40 } })
    host.script = async () => {}
    const r = await post(base, { messages: [{ role: "user", content: "x" }] })
    expect(r.status).toBe(504)
    expect(((await r.json()) as any).error.code).toBe("first_event_timeout")
  })
})

describe("hospedagem", () => {
  test("um servidor para várias locations e seleção por header (com link simbólico)", async () => {
    const hosting = new Hosting({ port: 0 })
    open.push(hosting)
    const root = mkdtempSync(join(tmpdir(), "ocb-"))
    const real = join(root, "real")
    Bun.spawnSync(["mkdir", real])
    const link = join(root, "link")
    symlinkSync(real, link)
    const a = new FakeHost()
    a.directory = real
    const b = new FakeHost()
    b.directory = join(root, "other")
    a.script = textScript(["from-a"])
    b.script = textScript(["from-b"])
    await hosting.register(a, { logFile: false, port: 0 })
    const port = hosting.port
    await hosting.register(b, { logFile: false, port: 0 })
    expect(hosting.port).toBe(port)
    expect(hosting.registered).toHaveLength(2)

    const base = `http://127.0.0.1:${port}`
    const body = { messages: [{ role: "user", content: "x" }] }
    const viaLink = (await (await post(base, body, { "x-opencode-directory": link })).json()) as any
    expect(viaLink.choices[0].message.content).toBe("from-a")
    const viaB = (await (await post(base, body, { "x-opencode-directory": b.directory })).json()) as any
    expect(viaB.choices[0].message.content).toBe("from-b")
    const dflt = (await (await post(base, body)).json()) as any
    expect(dflt.choices[0].message.content).toBe("from-a") // primeira location
    const unknown = await post(base, body, { "x-opencode-directory": "/nao/existe" })
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as any).error.code).toBe("location_not_found")
  })

  test("descarregar a última location para o servidor e libera a porta", async () => {
    const { hosting, base, host } = await boot()
    expect((await fetch(`${base}/health`)).status).toBe(200)
    host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {})
    }
    await hosting.unregister(hosting.registered[0]!)
    expect(await fetch(`${base}/health`).catch(() => "down")).toBe("down")
    expect(hosting.port).toBeUndefined()
    expect(host.contextHooks).toHaveLength(0)
  })

  test("porta ocupada não derruba o registro", async () => {
    const squatter = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") })
    try {
      const hosting = new Hosting()
      open.push(hosting)
      const cleanup = await hosting.register(new FakeHost(), { logFile: false, port: squatter.port })
      expect(hosting.registered).toHaveLength(1)
      expect(hosting.port).toBeUndefined()
      await cleanup()
      expect(hosting.registered).toHaveLength(0)
    } finally {
      squatter.stop(true)
    }
  })

  test("opções inválidas desabilitam o bridge sem lançar", async () => {
    const hosting = new Hosting({ port: 0 })
    open.push(hosting)
    const tmp = mkdtempSync(join(tmpdir(), "ocb-state-"))
    const prev = process.env.XDG_STATE_HOME
    process.env.XDG_STATE_HOME = tmp
    try {
      const cleanup = await hosting.register(new FakeHost(), { port: "abc" })
      expect(hosting.registered).toHaveLength(0)
      expect(hosting.port).toBeUndefined()
      await cleanup()
      expect(await Bun.file(join(tmp, "opencode-bridge", "bridge.log")).text()).toContain("invalid plugin options")
    } finally {
      process.env.XDG_STATE_HOME = prev
      if (prev === undefined) delete process.env.XDG_STATE_HOME
    }
  })

  test("sem locations o servidor responde 503 na health", async () => {
    const { hosting, base } = await boot()
    // simula o estado em que há servidor mas nenhuma location (race de descarga)
    ;(hosting as any).locations.clear()
    const h = await fetch(`${base}/health`)
    expect(h.status).toBe(503)
    const r = await post(base, { messages: [{ role: "user", content: "x" }] })
    expect(r.status).toBe(503)
    expect(((await r.json()) as any).error.code).toBe("no_location")
  })
})
