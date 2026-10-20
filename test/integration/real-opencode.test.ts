/**
 * Integração contra um OpenCode v2 REAL com o plugin carregado. Opt-in:
 *
 *   OPENCODE_BRIDGE_URL=http://127.0.0.1:4010 \
 *   OPENCODE_BRIDGE_DIR=/caminho/do/projeto   (diretório onde o OpenCode foi aberto; opcional)
 *   OPENCODE_BRIDGE_MODEL=opencode/minimax-m3.1-flash-free   (opcional)
 *   bun test test/integration
 *
 * Os modelos são não determinísticos: as asserções verificam a estrutura do protocolo e, quando possível,
 * um fato que só existe no projeto (o conteúdo de um arquivo lido por uma tool nativa).
 */
import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import OpenAI from "openai"

const URL = process.env.OPENCODE_BRIDGE_URL
const MODEL = process.env.OPENCODE_BRIDGE_MODEL ?? "opencode/minimax-m3.1-flash-free"
const DIR = process.env.OPENCODE_BRIDGE_DIR
const TIMEOUT = 180_000

const client = new OpenAI({ baseURL: `${URL}/v1`, apiKey: process.env.OPENCODE_BRIDGE_KEY ?? "test", maxRetries: 0, timeout: TIMEOUT })

const weather = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Returns the current weather for a city. The client executes it.",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"], additionalProperties: false },
  },
}

describe.skipIf(!URL)("OpenCode real", () => {
  test("models inclui o modelo de teste", async () => {
    const list = await client.models.list()
    expect(list.data.map((m) => m.id)).toContain(MODEL)
  })

  test("texto sem streaming respeita o system do cliente", async () => {
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: "Always answer with exactly the word PINEAPPLE and nothing else." },
        { role: "user", content: "hello" },
      ],
    })
    expect(r.choices[0]!.finish_reason).toBe("stop")
    expect(r.choices[0]!.message.content?.toUpperCase()).toContain("PINEAPPLE")
    expect(r.usage?.prompt_tokens).toBeGreaterThan(0)
  }, TIMEOUT)

  test("streaming com usage", async () => {
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "Count from 1 to 3." }],
    })
    let text = ""
    let usage: unknown
    let finish: unknown
    for await (const c of stream) {
      text += c.choices[0]?.delta.content ?? ""
      finish ??= c.choices[0]?.finish_reason
      if (c.usage) usage = c.usage
    }
    expect(text).toMatch(/1/)
    expect(finish).toBe("stop")
    expect(usage).toBeTruthy()
  }, TIMEOUT)

  test.skipIf(!DIR)("tool NATIVA do OpenCode lê um arquivo do projeto (server-executed)", async () => {
    const secret = `SECRET-${Math.random().toString(36).slice(2, 8)}`
    writeFileSync(join(DIR!, "bridge-secret.txt"), secret)
    const r = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: "Read the file bridge-secret.txt in the project and reply with its exact content only." }],
    })
    expect(r.choices[0]!.finish_reason).toBe("stop")
    expect(r.choices[0]!.message.tool_calls).toBeUndefined()
    expect(r.choices[0]!.message.content).toContain(secret)
  }, TIMEOUT)

  test("tools do CLIENTE: tool_calls, resultado e retomada na mesma sessão", async () => {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "user", content: "Use the get_weather tool for Paris and for Tokyo (both calls in the same response), then say which city is warmer in one sentence." },
    ]
    const first = await client.chat.completions.create({ model: MODEL, messages, tools: [weather] })
    const choice = first.choices[0]!
    expect(choice.finish_reason).toBe("tool_calls")
    const calls = choice.message.tool_calls ?? []
    expect(calls.length).toBeGreaterThanOrEqual(1)
    const cities: string[] = []
    for (const c of calls) {
      expect(c.type).toBe("function")
      if (c.type !== "function") continue
      expect(c.function.name).toBe("get_weather")
      cities.push(JSON.parse(c.function.arguments).city)
    }
    expect(cities.every((c) => typeof c === "string")).toBe(true)

    const temps: Record<string, string> = { Paris: "12C, cloudy", Tokyo: "31C, sunny" }
    messages.push(choice.message)
    for (const c of calls) {
      if (c.type !== "function") continue
      const city = JSON.parse(c.function.arguments).city as string
      messages.push({ role: "tool", tool_call_id: c.id, content: temps[city] ?? "20C" })
    }
    // cada rodada pode pedir mais tools (o modelo é livre); fechamos o loop com no máximo 3 rodadas
    let reply = await client.chat.completions.create({ model: MODEL, messages, tools: [weather] })
    for (let i = 0; i < 3 && reply.choices[0]!.finish_reason === "tool_calls"; i++) {
      messages.push(reply.choices[0]!.message)
      for (const c of reply.choices[0]!.message.tool_calls ?? []) {
        if (c.type === "function") messages.push({ role: "tool", tool_call_id: c.id, content: "20C" })
      }
      reply = await client.chat.completions.create({ model: MODEL, messages, tools: [weather] })
    }
    expect(reply.choices[0]!.finish_reason).toBe("stop")
    expect(reply.choices[0]!.message.content ?? "").toMatch(/tokyo|paris/i)
  }, TIMEOUT * 2)

  test("tools do cliente em streaming (tool_calls agregadas pelo SDK)", async () => {
    const final = await client.chat.completions
      .stream({
        model: MODEL,
        messages: [{ role: "user", content: "Call get_weather for Lisbon." }],
        tools: [weather],
        tool_choice: { type: "function", function: { name: "get_weather" } },
      })
      .finalChatCompletion()
    expect(final.choices[0]!.finish_reason).toBe("tool_calls")
    const call = final.choices[0]!.message.tool_calls?.[0]
    expect(call?.type === "function" && call.function.name).toBe("get_weather")
  }, TIMEOUT)

  test("nenhuma sessão [bridge] fica para trás", async () => {
    await new Promise((r) => setTimeout(r, 1500))
    const h: any = await (await fetch(`${URL}/health`)).json()
    expect(h.locations[0].conversations).toBeLessThanOrEqual(1) // a do tool_call em streaming aguarda o TTL
  })
})

// evita aviso de import não usado quando a suíte está pulada
void mkdtempSync
