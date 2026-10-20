import type { CanonicalEvent, FinishReason, ToolCall, Usage } from "../../core/canonical.ts"
import type { BridgeError } from "../../core/errors.ts"

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`
export const DONE = "data: [DONE]\n\n"
export const PING = ": ping\n\n"

const finishOf = (r: FinishReason) => (r === "content_filter" ? "content_filter" : r)

/** Constrói os chunks SSE de `chat.completion.chunk` a partir dos eventos canônicos. */
export class ChunkEncoder {
  private started = false
  private usage: Usage | undefined
  private finished = false
  private readonly created = Math.floor(Date.now() / 1000)

  constructor(
    private readonly id: string,
    private readonly model: string,
    private readonly includeUsage: boolean,
  ) {}

  private chunk(delta: Record<string, unknown>, finish: string | null) {
    return sse({
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })
  }

  private head(): string[] {
    if (this.started) return []
    this.started = true
    return [this.chunk({ role: "assistant", content: "" }, null)]
  }

  /** Primeiro chunk (papel do assistant). Idempotente. */
  start(): string[] {
    return this.head()
  }

  encode(e: CanonicalEvent): string[] {
    const out = this.head()
    switch (e.type) {
      case "text":
        out.push(this.chunk({ content: e.delta }, null))
        break
      case "reasoning":
        out.push(this.chunk({ reasoning_content: e.delta }, null))
        break
      case "tool_call":
        // como a OpenAI: primeiro nome (arguments vazio), depois os argumentos
        out.push(
          this.chunk(
            { tool_calls: [{ index: e.index, id: e.call.id, type: "function", function: { name: e.call.name, arguments: "" } }] },
            null,
          ),
          this.chunk({ tool_calls: [{ index: e.index, function: { arguments: e.call.arguments } }] }, null),
        )
        break
      case "usage":
        this.usage = e.usage
        break
      case "finish":
        this.finished = true
        out.push(this.chunk({}, finishOf(e.reason)))
        break
    }
    return out
  }

  /** Chunk de usage (se pedido) e `[DONE]`. */
  end(): string[] {
    const out: string[] = []
    if (this.includeUsage && this.usage && this.finished) {
      out.push(
        sse({
          id: this.id,
          object: "chat.completion.chunk",
          created: this.created,
          model: this.model,
          choices: [],
          usage: usageBody(this.usage),
        }),
      )
    }
    out.push(DONE)
    return out
  }

  /** Erro no meio do stream: chunk de erro seguido de `[DONE]`. */
  error(e: BridgeError): string[] {
    return [...this.head(), sse(e.toBody()), DONE]
  }
}

const usageBody = (u: Usage) => ({
  prompt_tokens: u.promptTokens,
  completion_tokens: u.completionTokens,
  total_tokens: u.promptTokens + u.completionTokens,
})

/** Resposta não-streaming a partir da sequência de eventos. */
export function completionBody(id: string, model: string, events: CanonicalEvent[]) {
  let content = ""
  const toolCalls: ToolCall[] = []
  let finish: FinishReason = "stop"
  let usage: Usage | undefined
  for (const e of events) {
    if (e.type === "text") content += e.delta
    else if (e.type === "tool_call") toolCalls.push(e.call)
    else if (e.type === "finish") finish = e.reason
    else if (e.type === "usage") usage = e.usage
  }
  const message: Record<string, unknown> = { role: "assistant", content: content === "" && toolCalls.length ? null : content }
  if (toolCalls.length) {
    message.tool_calls = toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } }))
  }
  return {
    id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishOf(finish) }],
    ...(usage ? { usage: usageBody(usage) } : {}),
  }
}
