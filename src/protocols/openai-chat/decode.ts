import type { CanonicalMessage, CanonicalRequest, ClientTool, GenerationParams, ToolCall, ToolChoice } from "../../core/canonical.ts"
import { BridgeError } from "../../core/errors.ts"

const KNOWN = new Set([
  "model",
  "messages",
  "tools",
  "tool_choice",
  "stream",
  "stream_options",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "seed",
  "frequency_penalty",
  "presence_penalty",
])

const bad = (message: string, param: string) => BridgeError.invalid(message, "invalid_request", { param })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/** Extrai o texto de `content` (string ou partes). Partes não textuais são registradas em `ignored`. */
function textOf(content: unknown, param: string, ignored: string[]): string {
  if (content === null || content === undefined) return ""
  if (typeof content === "string") return content
  if (!Array.isArray(content)) throw bad("content must be a string or an array of parts", param)
  const out: string[] = []
  for (const part of content) {
    if (typeof part === "string") out.push(part)
    else if (isObj(part) && (part.type === "text" || part.type === "input_text") && typeof part.text === "string") out.push(part.text)
    else ignored.push(`${param}[${String(isObj(part) ? part.type : typeof part)}]`)
  }
  return out.join("")
}

function decodeToolCalls(raw: unknown, param: string): ToolCall[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw bad("tool_calls must be an array", param)
  return raw.map((c, i) => {
    const p = `${param}[${i}]`
    if (!isObj(c) || typeof c.id !== "string" || !c.id) throw bad("tool call needs an id", `${p}.id`)
    const fn = c.function
    if (!isObj(fn) || typeof fn.name !== "string" || !fn.name) throw bad("tool call needs function.name", `${p}.function.name`)
    const args = fn.arguments
    return { id: c.id, name: fn.name, arguments: typeof args === "string" ? args : args === undefined ? "{}" : JSON.stringify(args) }
  })
}

function decodeMessages(raw: unknown, ignored: string[]): CanonicalMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw bad("messages must be a non-empty array", "messages")
  return raw.map((m, i): CanonicalMessage => {
    const p = `messages[${i}]`
    if (!isObj(m) || typeof m.role !== "string") throw bad("each message needs a role", `${p}.role`)
    switch (m.role) {
      case "system":
      case "developer":
        return { role: "system", text: textOf(m.content, `${p}.content`, ignored) }
      case "user":
        return { role: "user", text: textOf(m.content, `${p}.content`, ignored) }
      case "assistant":
        return {
          role: "assistant",
          text: textOf(m.content, `${p}.content`, ignored),
          toolCalls: decodeToolCalls(m.tool_calls, `${p}.tool_calls`),
        }
      case "tool":
        if (typeof m.tool_call_id !== "string" || !m.tool_call_id) throw bad("tool message needs tool_call_id", `${p}.tool_call_id`)
        return { role: "tool", toolCallId: m.tool_call_id, text: textOf(m.content, `${p}.content`, ignored) }
      default:
        throw bad(`unsupported message role "${m.role}"`, `${p}.role`)
    }
  })
}

function decodeTools(raw: unknown, ignored: string[]): ClientTool[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw bad("tools must be an array", "tools")
  const out: ClientTool[] = []
  const seen = new Set<string>()
  raw.forEach((t, i) => {
    const p = `tools[${i}]`
    if (!isObj(t) || t.type !== "function") {
      ignored.push(`${p}(${isObj(t) ? String(t.type) : typeof t})`)
      return
    }
    const fn = t.function
    if (!isObj(fn) || typeof fn.name !== "string" || !fn.name) throw bad("function tool needs a name", `${p}.function.name`)
    if (seen.has(fn.name)) throw bad(`duplicate tool name "${fn.name}"`, `${p}.function.name`)
    seen.add(fn.name)
    const parameters = isObj(fn.parameters) ? fn.parameters : { type: "object", properties: {} }
    out.push({ name: fn.name, description: typeof fn.description === "string" ? fn.description : "", parameters })
  })
  return out
}

function decodeToolChoice(raw: unknown): ToolChoice {
  if (raw === undefined || raw === null || raw === "auto") return "auto"
  if (raw === "none" || raw === "required") return raw
  if (isObj(raw) && raw.type === "function" && isObj(raw.function) && typeof raw.function.name === "string") {
    return { name: raw.function.name }
  }
  throw bad("unsupported tool_choice", "tool_choice")
}

function num(raw: unknown, param: string): number | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw bad(`${param} must be a number`, param)
  return raw
}

function decodeParams(b: Record<string, unknown>): GenerationParams {
  const params: GenerationParams = {}
  const temperature = num(b.temperature, "temperature")
  if (temperature !== undefined) params.temperature = temperature
  const topP = num(b.top_p, "top_p")
  if (topP !== undefined) params.topP = topP
  const maxTokens = num(b.max_completion_tokens ?? b.max_tokens, "max_tokens")
  if (maxTokens !== undefined) params.maxTokens = Math.max(1, Math.floor(maxTokens))
  const seed = num(b.seed, "seed")
  if (seed !== undefined) params.seed = seed
  const fp = num(b.frequency_penalty, "frequency_penalty")
  if (fp !== undefined) params.frequencyPenalty = fp
  const pp = num(b.presence_penalty, "presence_penalty")
  if (pp !== undefined) params.presencePenalty = pp
  if (typeof b.stop === "string") params.stop = [b.stop]
  else if (Array.isArray(b.stop) && b.stop.every((s) => typeof s === "string")) params.stop = b.stop as string[]
  else if (b.stop !== undefined && b.stop !== null) throw bad("stop must be a string or an array of strings", "stop")
  return params
}

export function decodeChatRequest(body: unknown): CanonicalRequest {
  if (!isObj(body)) throw BridgeError.invalid("The request body must be a JSON object", "invalid_json")
  const ignored: string[] = []
  for (const k of Object.keys(body)) if (!KNOWN.has(k)) ignored.push(k)
  if (typeof body.n === "number" && body.n !== 1) ignored.push("n(only 1 choice is supported)")

  const messages = decodeMessages(body.messages, ignored)
  const tools = decodeTools(body.tools, ignored)
  const toolChoice = decodeToolChoice(body.tool_choice)
  if (typeof toolChoice === "object" && !tools.some((t) => t.name === toolChoice.name)) {
    throw bad(`tool_choice references unknown tool "${toolChoice.name}"`, "tool_choice")
  }
  const streamOptions = isObj(body.stream_options) ? body.stream_options : {}

  return {
    model: typeof body.model === "string" ? body.model : undefined,
    messages,
    tools,
    toolChoice,
    params: decodeParams(body),
    stream: body.stream === true,
    includeUsage: streamOptions.include_usage === true,
    ignored,
  }
}
