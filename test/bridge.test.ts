import { describe, expect, test } from "bun:test"
import { BridgeError } from "../src/core/errors.ts"
import { nullLogger } from "../src/obs/logger.ts"
import { FakeHost, textScript, toolScript } from "./fake-host.ts"
import {
  assistantCalls,
  collect,
  finish,
  live,
  makeBridge,
  req,
  sleep,
  system,
  text,
  toolCalls,
  toolMsg,
  user,
  weatherTool,
} from "./helpers.ts"

describe("turn de texto", () => {
  test("emite texto, usage e finish; remove a sessão", async () => {
    const { bridge, host } = await makeBridge()
    host.script = textScript(["Olá", ", ", "mundo"])
    const turn = await bridge.begin(req({ messages: [user("oi")] }), live().signal, nullLogger)
    const events = await collect(turn.events)

    expect(text(events)).toBe("Olá, mundo")
    expect(finish(events)).toEqual({ type: "finish", reason: "stop" })
    expect(events.find((e) => e.type === "usage")).toEqual({ type: "usage", usage: { promptTokens: 150, completionTokens: 10 } })
    expect(turn.model).toBe("opencode/fast")
    expect(host.prompts).toEqual([{ sid: "ses_1", text: "oi" }])
    expect([...host.sessions.values()][0]).toMatchObject({ agent: "build", title: expect.stringContaining("[bridge]") })
    expect(host.removed).toEqual(["ses_1"])
    expect(host.interrupts).toEqual([])
    expect(bridge.health().conversations).toBe(0)
  })

  test("usa o agent configurado e mantém a sessão com keepSessions", async () => {
    const { bridge, host } = await makeBridge({ defaultAgent: "plan", keepSessions: true })
    const turn = await bridge.begin(req(), live().signal, nullLogger)
    await collect(turn.events)
    expect([...host.sessions.values()][0]?.agent).toBe("plan")
    expect(host.removed).toEqual([])
  })

  test("finish length vindo do OpenCode", async () => {
    const { bridge, host } = await makeBridge()
    host.script = textScript(["x"], { finish: "length" })
    const events = await collect((await bridge.begin(req(), live().signal, nullLogger)).events)
    expect(finish(events)).toEqual({ type: "finish", reason: "length" })
  })

  test("falha ao criar sessão vira 502 sem vazar conversa", async () => {
    const { bridge, host } = await makeBridge()
    host.failCreate = true
    const err = await bridge.begin(req(), live().signal, nullLogger).catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: "session_create_failed" })
    expect(err.message).toContain("create failed")
    expect(bridge.health().conversations).toBe(0)
  })

  test("modelo ambíguo, inexistente e explícito", async () => {
    const { bridge, host } = await makeBridge()
    const ambiguous = await bridge.begin(req({ model: "fast" }), live().signal, nullLogger).catch((e) => e)
    expect(ambiguous).toBeInstanceOf(BridgeError)
    expect(ambiguous).toMatchObject({ status: 400, code: "model_ambiguous" })
    const missing = await bridge.begin(req({ model: "nope/none" }), live().signal, nullLogger).catch((e) => e)
    expect(missing).toMatchObject({ status: 404, code: "model_not_found" })
    const turn = await bridge.begin(req({ model: "anthropic/fast" }), live().signal, nullLogger)
    await collect(turn.events)
    expect(turn.model).toBe("anthropic/fast")
    expect([...host.sessions.values()].at(-1)?.model).toEqual({ providerID: "anthropic", id: "fast" })
  })
})

describe("hook context", () => {
  test("system do cliente, parâmetros e filtro de tools", async () => {
    const { bridge, host } = await makeBridge()
    await collect(
      (
        await bridge.begin(
          req({
            messages: [system("Seja breve."), user("oi")],
            params: { temperature: 0.2, maxTokens: 64, topP: 0.9, stop: ["END"] },
          }),
          live().signal,
          nullLogger,
        )
      ).events,
    )
    const d = host.lastContexts[0]!
    expect(d.system.map((s) => s.text)).toEqual(["base system", "Seja breve."])
    expect(d.options).toMatchObject({ temperature: 0.2, maxTokens: 64, topP: 0.9, stop: ["END"] })
    // tool de outra conversa some; nativas ficam
    expect(Object.keys(d.tools).sort()).toEqual(["execute", "read", "shell"])
  })

  test("temperature é omitida quando o modelo não suporta", async () => {
    const { bridge, host } = await makeBridge()
    await collect((await bridge.begin(req({ model: "openai/gpt", params: { temperature: 0.2 } }), live().signal, nullLogger)).events)
    expect(host.lastContexts[0]!.options.temperature).toBeUndefined()
  })

  test("não mexe em sessões que não são do bridge", async () => {
    const { host } = await makeBridge()
    const d = { sessionID: "ses_outra", system: [], messages: [], options: {}, tools: { br_x_y: {} } }
    for (const h of host.contextHooks) h(d as never)
    expect(d.system).toEqual([])
    expect(Object.keys(d.tools)).toEqual(["br_x_y"])
  })

  test("histórico anterior vira mensagens nativas com tool-call e tool-result", async () => {
    const { bridge, host } = await makeBridge()
    const history = [
      user("Meu nome é Zé."),
      assistantCalls([{ id: "call_a", name: "get_weather", args: { city: "Paris" } }], "Vou consultar."),
      toolMsg("call_a", "31C"),
      user("Qual foi o clima?"),
    ]
    await collect((await bridge.begin(req({ messages: history, tools: [weatherTool] }), live().signal, nullLogger)).events)

    expect(host.prompts[0]!.text).toBe("Qual foi o clima?")
    const m = host.lastContexts[0]!.messages as any[]
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "tool", "user"])
    const call = m[1].content.find((p: any) => p.type === "tool-call")
    expect(call).toMatchObject({ id: "call_a", input: { city: "Paris" } })
    expect(call.name).toMatch(/^br_[0-9a-f]{8}_get_weather$/)
    expect(m[2].content[0]).toEqual({ type: "tool-result", id: "call_a", name: call.name, result: { type: "text", value: "31C" } })
    expect(m[3].content[0].text).toBe("Qual foi o clima?")
  })

  test("tool calls sem resultado ganham resultado sintético e resultados órfãos são descartados", async () => {
    const { bridge, host } = await makeBridge()
    const history = [
      user("a"),
      assistantCalls([{ id: "c1", name: "get_weather", args: { city: "X" } }]),
      toolMsg("zzz", "órfão"),
      user("b"),
    ]
    await collect((await bridge.begin(req({ messages: history, tools: [weatherTool] }), live().signal, nullLogger)).events)
    const m = host.lastContexts[0]!.messages as any[]
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "tool", "user"])
    expect(m[2].content[0].result.value).toContain("No result")
    expect(JSON.stringify(m)).not.toContain("órfão")
  })

  test("tool_choice none não registra tools; required acrescenta instrução", async () => {
    const a = await makeBridge()
    await collect((await a.bridge.begin(req({ tools: [weatherTool], toolChoice: "none" }), live().signal, nullLogger)).events)
    expect(a.host.tools.size).toBe(0)
    expect(a.host.lastContexts[0]!.system.map((s) => s.text).join("\n")).not.toContain("br_")

    const b = await makeBridge()
    b.host.script = textScript(["ok"])
    await collect((await b.bridge.begin(req({ tools: [weatherTool], toolChoice: "required" }), live().signal, nullLogger)).events)
    const sys = b.host.lastContexts[0]!.system.map((s) => s.text).join("\n")
    expect(sys).toContain("directly as functions")
    expect(sys).toContain("must call one of the client tools")
  })
})

describe("tool calling do cliente", () => {
  const weather = req({ tools: [weatherTool], messages: [user("clima em Paris?")] })

  test("ciclo completo: tool_call, pendência, retomada na mesma sessão", async () => {
    const { bridge, host } = await makeBridge()
    const results: string[] = []
    host.script = toolScript([{ name: "get_weather", input: { city: "Paris" } }], "Está sol.", { preamble: "Vou ver. ", results })

    const first = await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    expect(text(first)).toBe("Vou ver. ")
    const calls = toolCalls(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.call).toMatchObject({ name: "get_weather", arguments: '{"city":"Paris"}' })
    expect(finish(first)).toEqual({ type: "finish", reason: "tool_calls" })
    // a conversa continua viva: sessão, tools e pendência
    expect(host.removed).toEqual([])
    expect(host.tools.size).toBe(1)
    expect(bridge.health()).toMatchObject({ conversations: 1, awaitingClient: 1, pendingCalls: 1 })

    const id = calls[0]!.call.id
    const resumed = await bridge.begin(
      req({
        tools: [weatherTool],
        messages: [user("clima em Paris?"), assistantCalls([{ id, name: "get_weather", args: { city: "Paris" } }]), toolMsg(id, "22C sol")],
      }),
      live().signal,
      nullLogger,
    )
    const second = await collect(resumed.events)
    expect(text(second)).toBe("Está sol.")
    expect(finish(second)).toEqual({ type: "finish", reason: "stop" })
    expect(results).toEqual(["get_weather=22C sol"])
    expect(host.prompts).toHaveLength(1) // sem novo prompt: mesma sessão
    expect(host.sessions.size).toBe(1)
    expect(host.removed).toEqual(["ses_1"])
    expect(host.disposedTools).toHaveLength(1)
    expect(bridge.health()).toMatchObject({ conversations: 0, pendingCalls: 0 })
  })

  test("chamadas paralelas: índices, IDs e retomada com todos os resultados", async () => {
    const { bridge, host } = await makeBridge()
    const results: string[] = []
    host.script = toolScript(
      [
        { name: "get_weather", input: { city: "Paris" } },
        { name: "get_weather", input: { city: "Tokyo" } },
      ],
      "Ambos ok.",
      { results },
    )
    const first = await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    const calls = toolCalls(first)
    expect(calls.map((c) => c.index)).toEqual([0, 1])
    expect(new Set(calls.map((c) => c.call.id)).size).toBe(2)

    const [a, b] = calls.map((c) => c.call)
    const resumed = await bridge.begin(
      req({
        tools: [weatherTool],
        messages: [
          user("x"),
          assistantCalls([
            { id: a!.id, name: "get_weather", args: { city: "Paris" } },
            { id: b!.id, name: "get_weather", args: { city: "Tokyo" } },
          ]),
          toolMsg(a!.id, "PA"),
          toolMsg(b!.id, "TK"),
        ],
      }),
      live().signal,
      nullLogger,
    )
    expect(text(await collect(resumed.events))).toBe("Ambos ok.")
    expect(results.sort()).toEqual(["get_weather=PA", "get_weather=TK"])
  })

  test("resultados parciais ou desconhecidos retornam 400 e a conversa segue retomável", async () => {
    const { bridge, host } = await makeBridge()
    host.script = toolScript(
      [
        { name: "get_weather", input: { city: "A" } },
        { name: "get_weather", input: { city: "B" } },
      ],
      "fim",
    )
    const calls = toolCalls(await collect((await bridge.begin(weather, live().signal, nullLogger)).events))
    const [a, b] = calls.map((c) => c.call.id) as [string, string]
    const mk = (...ids: string[]) =>
      req({ tools: [weatherTool], messages: [user("x"), assistantCalls([]), ...ids.map((i) => toolMsg(i, "r"))] })

    const partial = await bridge.begin(mk(a), live().signal, nullLogger).catch((e) => e)
    expect(partial).toMatchObject({ status: 400, code: "tool_results_mismatch" })
    expect(partial.message).toContain(b)
    const unknown = await bridge.begin(mk(a, b, a + "x"), live().signal, nullLogger).catch((e) => e)
    expect(unknown).toMatchObject({ status: 400 })

    const ok = await bridge.begin(mk(a, b), live().signal, nullLogger)
    expect(text(await collect(ok.events))).toBe("fim")
  })

  test("mistura de tool nativa e do cliente: só a do cliente é devolvida", async () => {
    const { bridge, host } = await makeBridge()
    const results: string[] = []
    host.script = toolScript(
      [
        { name: "read", input: { path: "a" } },
        { name: "get_weather", input: { city: "Paris" } },
      ],
      "pronto",
      { results },
    )
    const first = await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    expect(toolCalls(first).map((c) => c.call.name)).toEqual(["get_weather"])
  })

  test("argumentos inválidos não chegam ao cliente e o modelo recebe o erro", async () => {
    const { bridge, host } = await makeBridge({}, new FakeHost())
    const results: string[] = []
    host.script = toolScript([{ name: "get_weather", input: { city: 42 } }], "corrigi", { results })
    const events = await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    expect(toolCalls(events)).toHaveLength(0)
    expect(text(events)).toBe("corrigi")
    expect(finish(events)).toEqual({ type: "finish", reason: "stop" })
    expect(results[0]).toContain('Invalid arguments for tool "get_weather"')
  })

  test("TTL: pendência expira, sessão é interrompida e removida; retomada tardia faz replay", async () => {
    const { bridge, host } = await makeBridge({ timeouts: { pendingTtlMs: 30 } })
    host.script = toolScript([{ name: "get_weather", input: { city: "Paris" } }], "tarde")
    const first = await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    const id = toolCalls(first)[0]!.call.id
    await sleep(120)
    expect(host.interrupts).toEqual(["ses_1"])
    expect(host.removed).toEqual(["ses_1"])
    expect(host.disposedTools).toHaveLength(1)
    expect(bridge.health().conversations).toBe(0)

    // o cliente responde depois do TTL: nova sessão com o histórico injetado, sem prompt de usuário real
    host.script = textScript(["retomei"])
    const late = await bridge.begin(
      req({
        tools: [weatherTool],
        messages: [user("clima?"), assistantCalls([{ id, name: "get_weather", args: { city: "Paris" } }]), toolMsg(id, "22C")],
      }),
      live().signal,
      nullLogger,
    )
    expect(text(await collect(late.events))).toBe("retomei")
    expect(host.prompts.at(-1)).toEqual({ sid: "ses_2", text: "Continue." })
    const m = host.lastContexts.at(-1)!.messages as any[]
    expect(m.map((x) => x.role)).toEqual(["user", "assistant", "tool"]) // placeholder descartado
    expect(m[2].content[0].result.value).toBe("22C")
  })

  test("cancelamento durante a resposta interrompe, rejeita pendências e limpa", async () => {
    const { bridge, host } = await makeBridge()
    host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {}) // nunca termina
    }
    const ac = live()
    const turn = await bridge.begin(req(), ac.signal, nullLogger)
    const done = collect(turn.events).catch((e) => e)
    await sleep(20)
    ac.abort()
    const err = await done
    expect(err).toBeInstanceOf(BridgeError)
    expect(err.type).toBe("cancelled")
    expect(host.interrupts).toEqual(["ses_1"])
    expect(host.removed).toEqual(["ses_1"])
  })

  test("cancelamento com `execute` suspenso rejeita a chamada", async () => {
    const { bridge, host } = await makeBridge()
    let callError: unknown
    host.script = async (api) => {
      api.emit("session.execution.started")
      api.emit("session.step.started")
      const name = api.clientToolName("get_weather")!
      api.emit("session.tool.input.started", { id: "call_x", name })
      api.emit("session.tool.called", { id: "call_x", input: { city: "A" } })
      // a chamada é do modelo, mas o cliente nunca verá o step.streamed: o `execute` fica suspenso
      api.callToolWithId(name, { city: "A" }, "call_x").catch((e) => (callError = e))
      await new Promise(() => {})
    }
    const ac = live()
    const done = collect((await bridge.begin(weather, ac.signal, nullLogger)).events).catch((e) => e)
    await sleep(20)
    ac.abort()
    await done
    await sleep(10)
    expect(String(callError)).toContain("Conversation ended")
    expect(bridge.health().pendingCalls).toBe(0)
  })

  test("stop() descarta conversas aguardando o cliente", async () => {
    const { bridge, host } = await makeBridge()
    host.script = toolScript([{ name: "get_weather", input: { city: "Paris" } }], "x")
    await collect((await bridge.begin(weather, live().signal, nullLogger)).events)
    expect(bridge.health().awaitingClient).toBe(1)
    await bridge.stop()
    expect(host.interrupts).toEqual(["ses_1"])
    expect(host.removed).toEqual(["ses_1"])
    expect(host.disposedTools).toHaveLength(1)
    expect(host.contextHooks).toHaveLength(0)
  })

  test("conversas simultâneas com a mesma tool e schemas diferentes não se misturam", async () => {
    const { bridge, host } = await makeBridge()
    const strict = { name: "lookup", description: "", parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } }
    const numeric = { name: "lookup", description: "", parameters: { type: "object", properties: { q: { type: "number" } }, required: ["q"] } }
    const seen: Array<{ keys: string[] }> = []
    host.script = async (api) => {
      api.emit("session.execution.started")
      api.emit("session.step.started")
      const d = api.context()
      seen.push({ keys: Object.keys(d.tools).filter((k) => k.startsWith("br_")) })
      api.emit("session.step.streamed")
      api.emit("session.step.ended", { finish: "stop" })
      api.emit("session.execution.succeeded")
    }
    const [a, b] = await Promise.all([
      bridge.begin(req({ tools: [strict] }), live().signal, nullLogger),
      bridge.begin(req({ tools: [numeric] }), live().signal, nullLogger),
    ])
    await Promise.all([collect(a.events), collect(b.events)])
    expect(host.tools.size).toBe(0)
    // cada conversa só enxerga a própria versão de `lookup`
    expect(seen.map((s) => s.keys.length)).toEqual([1, 1])
    expect(seen[0]!.keys[0]).not.toBe(seen[1]!.keys[0])
  })
})

describe("permissões sem interface", () => {
  async function ctxWith(over = {}) {
    const t = await makeBridge(over)
    t.host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {})
    }
    await t.bridge.begin(req(), live().signal, nullLogger) // abre a sessão ses_1
    return t
  }
  const ask = (host: FakeHost, action: string, effect: "allow" | "deny" | "ask" = "ask") => {
    const d = { sessionID: "ses_1", action, resources: ["x"], effect } as any
    for (const h of host.permissionHooks) h(d)
    return d as { effect: string; message?: string }
  }

  test("ask é negado por padrão com mensagem; allow e deny das regras são preservados", async () => {
    const { host } = await ctxWith()
    expect(ask(host, "edit")).toMatchObject({ effect: "deny", message: expect.stringContaining("no interactive user") })
    expect(ask(host, "read", "allow").effect).toBe("allow")
    expect(ask(host, "shell", "deny").effect).toBe("deny")
  })

  test("autoApprove edit e all", async () => {
    const edit = await ctxWith({ autoApprove: "edit" })
    expect(ask(edit.host, "edit").effect).toBe("allow")
    expect(ask(edit.host, "shell").effect).toBe("deny")
    const all = await ctxWith({ autoApprove: "all" })
    expect(ask(all.host, "shell").effect).toBe("allow")
  })

  test("readOnly nega edit e shell mesmo permitidos", async () => {
    const { host } = await ctxWith({ readOnly: true, autoApprove: "all" })
    expect(ask(host, "edit", "allow").effect).toBe("deny")
    expect(ask(host, "shell", "allow").effect).toBe("deny")
    expect(ask(host, "read", "allow").effect).toBe("allow")
  })

  test("sessões que não são do bridge não são tocadas", async () => {
    const { host } = await ctxWith()
    const d = { sessionID: "ses_999", action: "edit", resources: [], effect: "ask" } as any
    for (const h of host.permissionHooks) h(d)
    expect(d.effect).toBe("ask")
  })
})

describe("timeouts e falhas do OpenCode", () => {
  test("sem primeiro evento: 504 e limpeza", async () => {
    const { bridge, host } = await makeBridge({ timeouts: { firstEventMs: 30 } })
    host.script = async () => {}
    const err = await collect((await bridge.begin(req(), live().signal, nullLogger)).events).catch((e) => e)
    expect(err).toMatchObject({ status: 504, code: "first_event_timeout" })
    expect(host.interrupts).toEqual(["ses_1"])
    expect(host.removed).toEqual(["ses_1"])
  })

  test("silêncio entre eventos: idle_timeout", async () => {
    const { bridge, host } = await makeBridge({ timeouts: { idleMs: 30 } })
    host.script = async (api) => {
      api.emit("session.execution.started")
    }
    const err = await collect((await bridge.begin(req(), live().signal, nullLogger)).events).catch((e) => e)
    expect(err).toMatchObject({ status: 504, code: "idle_timeout" })
  })

  test("step.failed vira erro upstream", async () => {
    const { bridge, host } = await makeBridge()
    host.script = async (api) => {
      api.emit("session.execution.started")
      api.emit("session.step.failed", { error: { type: "provider", message: "rate limited" } })
    }
    const err = await collect((await bridge.begin(req(), live().signal, nullLogger)).events).catch((e) => e)
    expect(err).toMatchObject({ status: 502, code: "step_failed", message: "rate limited" })
    expect(host.removed).toEqual(["ses_1"])
  })

  test("abort com BridgeError (timeout total) propaga o erro", async () => {
    const { bridge, host } = await makeBridge()
    host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {})
    }
    const ac = live()
    const done = collect((await bridge.begin(req(), ac.signal, nullLogger)).events).catch((e) => e)
    await sleep(10)
    ac.abort(BridgeError.timeout("too long", "total_timeout"))
    expect(await done).toMatchObject({ status: 504, code: "total_timeout" })
  })

  test("perda da assinatura de eventos falha a turn", async () => {
    const { bridge, host } = await makeBridge()
    host.script = async (api) => {
      api.emit("session.execution.started")
      await new Promise(() => {})
    }
    const done = collect((await bridge.begin(req(), live().signal, nullLogger)).events).catch((e) => e)
    await sleep(10)
    host.emit({ type: "bridge.stream.lost", data: { sessionID: "ses_1" } })
    expect(await done).toMatchObject({ code: "event_stream_lost" })
  })
})
