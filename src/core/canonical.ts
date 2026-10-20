/** Modelo interno independente de protocolo. Os codecs em `protocols/*` convertem de/para ele. */

export interface ModelRef {
  providerID: string
  id: string
}

export interface ToolCall {
  id: string
  name: string
  /** Argumentos como string JSON (formato OpenAI). */
  arguments: string
}

export type CanonicalMessage =
  | { role: "system"; text: string }
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; text: string }

export interface ClientTool {
  name: string
  description: string
  /** JSON Schema dos argumentos, exatamente como o cliente enviou. */
  parameters: Record<string, unknown>
}

export type ToolChoice = "auto" | "none" | "required" | { name: string }

export interface GenerationParams {
  temperature?: number
  topP?: number
  maxTokens?: number
  stop?: string[]
  seed?: number
  frequencyPenalty?: number
  presencePenalty?: number
}

export interface CanonicalRequest {
  /** Valor bruto de `model` (pode ser vazio: usa o padrão do OpenCode). */
  model: string | undefined
  messages: CanonicalMessage[]
  tools: ClientTool[]
  toolChoice: ToolChoice
  params: GenerationParams
  stream: boolean
  includeUsage: boolean
  /** Campos recebidos mas ignorados (para log). */
  ignored: string[]
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter"

export interface Usage {
  promptTokens: number
  completionTokens: number
}

export type CanonicalEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; index: number; call: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; reason: FinishReason }
