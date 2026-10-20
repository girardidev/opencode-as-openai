import type { ModelRef } from "../src/core/canonical.ts"
import type {
  ClientToolDef,
  ContextDraft,
  Disposable,
  HostEvent,
  ModelInfo,
  OpenCodeHost,
  PermissionDraft,
} from "../src/opencode/host.ts"

export const MODELS: ModelInfo[] = [
  { providerID: "opencode", id: "fast", name: "Fast", temperature: true, tools: true },
  { providerID: "openai", id: "gpt", name: "GPT", temperature: false, tools: true },
  { providerID: "anthropic", id: "fast", name: "Fast (anthropic)", temperature: true, tools: true },
]

export interface ScriptApi {
  sid: string
  text: string
  /** Emite um evento do OpenCode para a sessão. */
  emit(type: string, data?: Record<string, unknown>): void
  /** Simula uma chamada ao modelo: roda os hooks `context` e devolve o rascunho resultante. */
  context(initialMessages?: unknown[]): ContextDraft
  /** Chama uma tool registrada (pelo nome original ou prefixado), como o OpenCode faria. */
  callTool(name: string, input: unknown): Promise<string>
  /** Como `callTool`, mas com o ID da chamada definido pelo script (igual ao do evento `tool.called`). */
  callToolWithId(name: string, input: unknown, id: string): Promise<string>
  /** Nome efetivo (prefixado) da tool do cliente registrada para este nome original, se existir. */
  clientToolName(original: string): string | undefined
  /** Roda os hooks de permissão e devolve o efeito final. */
  ask(action: string, effect?: "allow" | "deny" | "ask"): PermissionDraft
  signal: AbortSignal
  id(): string
}

export type Script = (api: ScriptApi) => Promise<void>

interface FakeSession {
  id: string
  title: string
  agent: string
  model: ModelRef
  ac: AbortController
  removed: boolean
}

export class FakeHost implements OpenCodeHost {
  directory = "/tmp/fake-project"
  models = MODELS
  defaultRef: ModelRef | undefined = { providerID: "opencode", id: "fast" }
  sessions = new Map<string, FakeSession>()
  prompts: Array<{ sid: string; text: string }> = []
  interrupts: string[] = []
  removed: string[] = []
  script: Script = textScript(["ok"])
  contextHooks: Array<(d: ContextDraft) => void> = []
  permissionHooks: Array<(d: PermissionDraft) => void> = []
  tools = new Map<string, ClientToolDef>()
  disposedTools: string[] = []
  failCreate = false
  private subscribers = new Set<(e: HostEvent) => void>()
  private n = 0
  private callN = 0
  private modelCalls: ContextDraft[] = []

  get lastContexts() {
    return this.modelCalls
  }

  async listModels() {
    return this.models
  }
  async defaultModel() {
    return this.defaultRef
  }

  async createSession(input: { title: string; agent: string; model: ModelRef }) {
    if (this.failCreate) throw new Error("create failed")
    const id = `ses_${++this.n}`
    this.sessions.set(id, { id, ...input, ac: new AbortController(), removed: false })
    return id
  }

  async prompt(sid: string, text: string) {
    this.prompts.push({ sid, text })
    const s = this.sessions.get(sid)!
    const api: ScriptApi = {
      sid,
      text,
      signal: s.ac.signal,
      id: () => `call_${++this.callN}`,
      emit: (type, data = {}) => this.emit({ type, data: { sessionID: sid, ...data } }),
      context: (initial = [{ role: "user", content: [{ type: "text", text }] }]) => {
        const d: ContextDraft = {
          sessionID: sid,
          system: [{ type: "text", text: "base system" }],
          messages: structuredClone(initial) as ContextDraft["messages"],
          options: { maxTokens: 256000 },
          tools: { read: {}, shell: {}, execute: {}, br_other999_foreign: {} },
        }
        // como no OpenCode: todas as tools registradas na location aparecem, de qualquer conversa
        for (const name of this.tools.keys()) d.tools[name] = {}
        for (const h of this.contextHooks) h(d)
        this.modelCalls.push(d)
        return d
      },
      // como no OpenCode: a sessão só enxerga as tools que sobram depois dos hooks `context`
      clientToolName: (original) => {
        const d: ContextDraft = { sessionID: sid, system: [], messages: [], options: {}, tools: {} }
        for (const name of this.tools.keys()) d.tools[name] = {}
        for (const h of this.contextHooks) h(d)
        return Object.keys(d.tools).find((k) => k.startsWith("br_") && k.endsWith(`_${original}`) && this.tools.has(k))
      },
      callTool: (name, input) => {
        const def = [...this.tools.values()].find((t) => t.name === name || t.name.endsWith(`_${name}`))
        if (!def) return Promise.reject(new Error(`tool ${name} is not registered`))
        return def.execute(input, { id: api.id(), sessionID: sid, signal: s.ac.signal })
      },
      callToolWithId: (name, input, id) => {
        const def = this.tools.get(name)
        if (!def) return Promise.reject(new Error(`tool ${name} is not registered`))
        return def.execute(input, { id, sessionID: sid, signal: s.ac.signal })
      },
      ask: (action, effect = "ask") => {
        const d: PermissionDraft = { sessionID: sid, action, resources: ["x"], effect }
        for (const h of this.permissionHooks) h(d)
        return d
      },
    }
    // roda o script de forma assíncrona, como o loop do OpenCode
    queueMicrotask(() => {
      this.script(api).catch((e) => {
        if (!s.ac.signal.aborted) api.emit("session.execution.failed", { error: { message: String(e) } })
      })
    })
  }

  async interrupt(sid: string) {
    this.interrupts.push(sid)
    const s = this.sessions.get(sid)
    if (!s || s.ac.signal.aborted) return
    s.ac.abort()
    this.emit({ type: "session.step.failed", data: { sessionID: sid, error: { type: "aborted", message: "Step interrupted" } } })
    this.emit({ type: "session.execution.interrupted", data: { sessionID: sid, reason: "user" } })
  }

  async removeSession(sid: string) {
    this.removed.push(sid)
    const s = this.sessions.get(sid)
    if (s) s.removed = true
  }

  subscribe(signal: AbortSignal): AsyncIterable<HostEvent> {
    const queue: HostEvent[] = []
    let wake: (() => void) | undefined
    const push = (e: HostEvent) => {
      queue.push(e)
      wake?.()
    }
    this.subscribers.add(push)
    signal.addEventListener("abort", () => wake?.())
    const subscribers = this.subscribers
    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (!signal.aborted) {
            const e = queue.shift()
            if (e) yield e
            else await new Promise<void>((r) => (wake = r))
          }
        } finally {
          subscribers.delete(push)
        }
      },
    }
  }

  async registerTools(defs: ClientToolDef[]): Promise<Disposable> {
    for (const d of defs) this.tools.set(d.name, d)
    return {
      dispose: async () => {
        for (const d of defs) {
          this.tools.delete(d.name)
          this.disposedTools.push(d.name)
        }
      },
    }
  }

  async onContext(fn: (d: ContextDraft) => void): Promise<Disposable> {
    this.contextHooks.push(fn)
    return { dispose: async () => void this.contextHooks.splice(this.contextHooks.indexOf(fn), 1) }
  }

  async onPermission(fn: (d: PermissionDraft) => void): Promise<Disposable> {
    this.permissionHooks.push(fn)
    return { dispose: async () => void this.permissionHooks.splice(this.permissionHooks.indexOf(fn), 1) }
  }

  emit(e: HostEvent) {
    for (const s of this.subscribers) s(e)
  }
}

const tokens = { input: 100, output: 10, reasoning: 0, cache: { read: 50, write: 0 } }

/** Sequência de eventos de uma turn de texto, como gravado em test/fixtures/text-simple.json. */
export function textScript(chunks: string[], opts: { finish?: string; delayMs?: number } = {}): Script {
  return async (api) => {
    api.emit("session.execution.started")
    api.emit("session.step.started", { assistantMessageID: "msg_a" })
    api.context()
    api.emit("session.text.started", { ordinal: 0 })
    for (const c of chunks) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
      api.emit("session.text.delta", { ordinal: 0, delta: c })
    }
    api.emit("session.text.ended", { ordinal: 0, text: chunks.join("") })
    api.emit("session.step.streamed")
    api.emit("session.step.ended", { finish: opts.finish ?? "stop", tokens })
    api.emit("session.execution.succeeded")
  }
}

export interface ToolStep {
  name: string
  input: unknown
}

/**
 * Uma step em que o modelo chama tools (do cliente e/ou nativas) em paralelo, seguida de uma step final de texto.
 * Reproduz a ordem observada no OpenCode: input.started -> called (todas) -> step.streamed -> execute das tools.
 * Tools do cliente são executadas via `registerTools` (ficam suspensas até o resultado); as demais são nativas.
 */
export function toolScript(calls: ToolStep[], finalText: string, opts: { preamble?: string; results?: string[] } = {}): Script {
  return async (api) => {
    api.emit("session.execution.started")
    api.emit("session.step.started", { assistantMessageID: "msg_1" })
    if (opts.preamble) {
      api.emit("session.text.started", { ordinal: 0 })
      api.emit("session.text.delta", { ordinal: 0, delta: opts.preamble })
      api.emit("session.text.ended", { ordinal: 0, text: opts.preamble })
    }
    api.context()
    const planned = calls.map((c) => ({ ...c, id: api.id(), effective: api.clientToolName(c.name) }))
    for (const c of planned) api.emit("session.tool.input.started", { id: c.id, name: c.effective ?? c.name })
    for (const c of planned) api.emit("session.tool.called", { id: c.id, input: c.input, executed: false })
    api.emit("session.step.streamed")
    await Promise.all(
      planned.map(async (c) => {
        const text = c.effective
          ? await api.callToolWithId(c.effective, c.input, c.id)
          : `native:${c.name}`
        opts.results?.push(`${c.name}=${text}`)
        api.emit("session.tool.success", { id: c.id, content: [{ type: "text", text }] })
      }),
    )
    api.emit("session.step.ended", { finish: "tool-calls", tokens })
    api.emit("session.step.started", { assistantMessageID: "msg_2" })
    api.context()
    api.emit("session.text.started", { ordinal: 0 })
    api.emit("session.text.delta", { ordinal: 0, delta: finalText })
    api.emit("session.text.ended", { ordinal: 0, text: finalText })
    api.emit("session.step.streamed")
    api.emit("session.step.ended", { finish: "stop", tokens })
    api.emit("session.execution.succeeded")
  }
}
