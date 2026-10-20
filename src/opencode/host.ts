import type { ModelRef } from "../core/canonical.ts"

/** Evento público do OpenCode (`ctx.event.subscribe`). `data.sessionID` identifica a sessão. */
export interface HostEvent {
  type: string
  data: any
}

export interface ModelInfo extends ModelRef {
  name: string
  /** O modelo aceita `temperature`? */
  temperature: boolean
  tools: boolean
}

export interface Disposable {
  dispose(): Promise<void>
}

export type NativeMessage = { role: string; content: unknown[]; [k: string]: unknown }

/** Rascunho mutável passado ao hook `session.context`. */
export interface ContextDraft {
  readonly sessionID: string
  system: Array<{ type: "text"; text: string }>
  messages: NativeMessage[]
  options: Record<string, unknown>
  tools: Record<string, unknown>
}

/** Rascunho mutável passado ao hook `permission.evaluate`. */
export interface PermissionDraft {
  readonly sessionID: string
  readonly action: string
  readonly resources: readonly string[]
  effect: "allow" | "deny" | "ask"
  message?: string
}

export interface ToolCallInfo {
  id: string
  sessionID: string
  signal: AbortSignal
}

export interface ClientToolDef {
  /** Nome efetivo registrado no OpenCode (já com o prefixo do bridge). */
  name: string
  description: string
  schema: Record<string, unknown>
  /** Executado pelo OpenCode quando o modelo chama a tool; resolve com o texto do resultado. */
  execute(input: unknown, call: ToolCallInfo): Promise<string>
}

/** Superfície mínima do OpenCode usada pelo bridge. Implementada sobre o `ctx` do plugin e por um fake nos testes. */
export interface OpenCodeHost {
  readonly directory: string
  listModels(): Promise<ModelInfo[]>
  defaultModel(): Promise<ModelRef | undefined>
  createSession(input: { title: string; agent: string; model: ModelRef }): Promise<string>
  prompt(sessionID: string, text: string): Promise<void>
  interrupt(sessionID: string): Promise<void>
  removeSession(sessionID: string): Promise<void>
  subscribe(signal: AbortSignal): AsyncIterable<HostEvent>
  registerTools(defs: ClientToolDef[]): Promise<Disposable>
  onContext(fn: (draft: ContextDraft) => void): Promise<Disposable>
  onPermission(fn: (draft: PermissionDraft) => void): Promise<Disposable>
}
