import { BridgeError } from "./errors.ts"
import type { CanonicalMessage, ToolCall } from "./canonical.ts"
import type { NativeMessage } from "../opencode/host.ts"

export const CONTINUE_PROMPT = "Continue."

export interface SplitConversation {
  /** system/developer, na ordem, separados por linha em branco. */
  systemText: string
  /** Histórico a apresentar ao modelo como mensagens nativas. */
  history: CanonicalMessage[]
  /** Resultados de tools no fim da conversa (possível retomada). */
  tail: Extract<CanonicalMessage, { role: "tool" }>[]
  /** Texto enviado como prompt da sessão. */
  prompt: string
  /** O prompt é só um gatilho: a mensagem persistida deve ser descartada no hook. */
  promptIsPlaceholder: boolean
}

export function splitConversation(messages: CanonicalMessage[]): SplitConversation {
  const systemText = messages
    .filter((m): m is Extract<CanonicalMessage, { role: "system" }> => m.role === "system")
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n\n")
  const convo = messages.filter((m) => m.role !== "system")
  if (convo.length === 0) throw BridgeError.invalid("messages must contain at least one non-system message", "empty_conversation")

  const tail: SplitConversation["tail"] = []
  for (let i = convo.length - 1; i >= 0; i--) {
    const m = convo[i]!
    if (m.role !== "tool") break
    tail.unshift(m)
  }

  if (tail.length > 0) {
    return { systemText, history: convo, tail, prompt: CONTINUE_PROMPT, promptIsPlaceholder: true }
  }
  const last = convo[convo.length - 1]!
  if (last.role !== "user") {
    throw BridgeError.invalid("The last message must have role user or tool", "invalid_last_message")
  }
  return {
    systemText,
    history: convo.slice(0, -1),
    tail,
    prompt: last.text.trim() ? last.text : "(empty message)",
    promptIsPlaceholder: false,
  }
}

function parseArgs(args: string): unknown {
  if (!args.trim()) return {}
  try {
    return JSON.parse(args)
  } catch {
    return { _raw: args }
  }
}

/**
 * Converte o histórico do cliente em mensagens nativas do OpenCode (`tool-call` / `tool-result`).
 * Garante que toda tool call tenha um resultado e descarta resultados órfãos, que os providers rejeitam.
 */
export function toNativeMessages(history: CanonicalMessage[], rename: (original: string) => string): NativeMessage[] {
  const out: NativeMessage[] = []
  const callNames = new Map<string, string>()
  let awaiting = new Map<string, string>()

  const flush = () => {
    for (const [id, name] of awaiting) out.push(toolResult(id, name, "No result was provided for this tool call."))
    awaiting = new Map()
  }

  for (const m of history) {
    if (m.role === "tool") {
      const name = callNames.get(m.toolCallId)
      if (!name || !awaiting.has(m.toolCallId)) continue // órfão ou duplicado
      awaiting.delete(m.toolCallId)
      out.push(toolResult(m.toolCallId, name, m.text))
      continue
    }
    flush()
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.text }] })
    } else if (m.role === "assistant") {
      const content: unknown[] = []
      if (m.text) content.push({ type: "text", text: m.text })
      for (const c of m.toolCalls) {
        const name = rename(c.name)
        callNames.set(c.id, name)
        awaiting.set(c.id, name)
        content.push({ type: "tool-call", id: c.id, name, input: parseArgs(c.arguments) })
      }
      if (content.length) out.push({ role: "assistant", content })
    }
  }
  flush()
  return out
}

function toolResult(id: string, name: string, text: string): NativeMessage {
  return { role: "tool", content: [{ type: "tool-result", id, name, result: { type: "text", value: text } }] }
}

export function callsOf(messages: CanonicalMessage[]): ToolCall[] {
  return messages.flatMap((m) => (m.role === "assistant" ? m.toolCalls : []))
}
