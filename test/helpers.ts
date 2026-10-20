import { defaults, parseConfig, type BridgeConfig } from "../src/config.ts"
import { Bridge } from "../src/core/bridge.ts"
import type { CanonicalEvent, CanonicalMessage, CanonicalRequest, ClientTool } from "../src/core/canonical.ts"
import { memoryLogger } from "../src/obs/logger.ts"
import { FakeHost } from "./fake-host.ts"

export function makeConfig(over: Omit<Partial<BridgeConfig>, "timeouts"> & { timeouts?: Partial<BridgeConfig["timeouts"]> } = {}): BridgeConfig {
  return { ...parseConfig({}), ...over, timeouts: { ...defaults.timeouts, ...over.timeouts }, logFile: undefined }
}

export async function makeBridge(over: Parameters<typeof makeConfig>[0] = {}, host = new FakeHost()) {
  const logs: string[] = []
  const log = memoryLogger(logs)
  const bridge = new Bridge(host, makeConfig(over), log)
  await bridge.start()
  return { bridge, host, log, logs }
}

export const user = (text: string): CanonicalMessage => ({ role: "user", text })
export const system = (text: string): CanonicalMessage => ({ role: "system", text })
export const assistantCalls = (calls: Array<{ id: string; name: string; args: unknown }>, text = ""): CanonicalMessage => ({
  role: "assistant",
  text,
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.args) })),
})
export const toolMsg = (id: string, text: string): CanonicalMessage => ({ role: "tool", toolCallId: id, text })

export function req(over: Partial<CanonicalRequest> = {}): CanonicalRequest {
  return {
    model: undefined,
    messages: [user("hi")],
    tools: [],
    toolChoice: "auto",
    params: {},
    stream: false,
    includeUsage: false,
    ignored: [],
    ...over,
  }
}

export const weatherTool: ClientTool = {
  name: "get_weather",
  description: "Weather for a city",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
}

export async function collect(gen: AsyncIterable<CanonicalEvent>): Promise<CanonicalEvent[]> {
  const out: CanonicalEvent[] = []
  for await (const e of gen) out.push(e)
  return out
}

export const text = (events: CanonicalEvent[]) =>
  events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("")
export const finish = (events: CanonicalEvent[]) => events.find((e) => e.type === "finish")
export const toolCalls = (events: CanonicalEvent[]) =>
  events.flatMap((e) => (e.type === "tool_call" ? [e] : []))

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const live = () => new AbortController()
