import Ajv, { type ValidateFunction } from "ajv"
import type { BridgeConfig } from "../config.ts"
import type { Logger } from "../obs/logger.ts"
import { Metrics } from "../obs/metrics.ts"
import { Channel, EventMux, STREAM_LOST } from "../opencode/event-mux.ts"
import type { ContextDraft, Disposable, ModelInfo, OpenCodeHost, PermissionDraft } from "../opencode/host.ts"
import { ModelCatalog, fullId, resolveModel } from "../opencode/models.ts"
import type { CanonicalEvent, CanonicalRequest, ClientTool, FinishReason, ModelRef, ToolCall } from "./canonical.ts"
import { BridgeError } from "./errors.ts"
import { splitConversation, toNativeMessages, type SplitConversation } from "./history.ts"
import { PendingCalls } from "./pending.ts"

export interface Turn {
  /** ID público do modelo (`provider/model`). */
  model: string
  conversationId: string
  sessionID: string
  /** Eventos da resposta. Lança `BridgeError` em falha; a limpeza acontece quando o iterador termina. */
  events: AsyncGenerator<CanonicalEvent>
}

const CODE_MODE_HINT =
  "Tools whose names start with `br_` are regular function tools provided by the client: call them directly as " +
  "functions, never through the code-mode `execute` tool."

const WRITE_ACTIONS = new Set(["edit", "write", "shell", "bash"])

interface BridgeTool {
  prefixed: string
  original: string
  validate: ValidateFunction | undefined
}

interface Outstanding {
  prefixed: string
  original: string
}

type Status = "running" | "awaiting" | "done"

class Conversation {
  status: Status = "running"
  channel!: Channel
  toolReg: Disposable | undefined
  ttl: ReturnType<typeof setTimeout> | undefined
  /** Chamadas entregues ao cliente que aguardam resultado. */
  outstanding = new Map<string, Outstanding>()
  /** IDs de chamadas com `execute` suspenso (para descartar no fim). */
  waiting = new Set<string>()
  tools = new Map<string, BridgeTool>()
  originalToPrefixed = new Map<string, string>()
  interruptedByUs = false
  finished = false
  usage = { prompt: 0, completion: 0 }
  lastFinish: FinishReason = "stop"

  constructor(
    readonly id: string,
    readonly sessionID: string,
    readonly model: ModelInfo,
    readonly prefix: string,
    readonly req: CanonicalRequest,
    readonly systemText: string,
    readonly seed: ReturnType<typeof toNativeMessages>,
    readonly dropPersistedFirst: boolean,
  ) {}
}

export class Bridge {
  private readonly mux: EventMux
  private readonly catalog: ModelCatalog
  private readonly pending = new PendingCalls()
  private readonly bySession = new Map<string, Conversation>()
  private readonly byCall = new Map<string, Conversation>()
  private readonly hooks: Disposable[] = []
  private readonly ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false })
  private started = false
  readonly metrics = new Metrics()

  constructor(
    private readonly host: OpenCodeHost,
    private readonly config: BridgeConfig,
    private readonly log: Logger,
  ) {
    this.mux = new EventMux(host, log)
    this.catalog = new ModelCatalog(() => host.listModels())
  }

  get directory() {
    return this.host.directory
  }

  async start() {
    if (this.started) return
    this.started = true
    this.hooks.push(await this.host.onContext((d) => this.onContext(d)))
    this.hooks.push(await this.host.onPermission((d) => this.onPermission(d)))
    this.mux.start()
  }

  async stop() {
    const all = [...new Set(this.bySession.values())]
    await Promise.allSettled(all.map((c) => this.finish(c, "shutdown")))
    await this.mux.stop()
    await Promise.allSettled(this.hooks.splice(0).map((h) => h.dispose()))
    this.started = false
  }

  models(): Promise<ModelInfo[]> {
    return this.catalog.list()
  }

  health() {
    const convs = [...this.bySession.values()]
    return {
      directory: this.host.directory,
      conversations: convs.length,
      awaitingClient: convs.filter((c) => c.status === "awaiting").length,
      pendingCalls: this.pending.size,
      channels: this.mux.size,
      metrics: this.metrics.snapshot(),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Entrada
  // ---------------------------------------------------------------------------------------------------------------

  async begin(req: CanonicalRequest, signal: AbortSignal, log: Logger): Promise<Turn> {
    const split = splitConversation(req.messages)

    if (split.tail.length > 0) {
      const owners = new Set<Conversation>()
      for (const t of split.tail) {
        const c = this.byCall.get(t.toolCallId)
        if (c) owners.add(c)
      }
      if (owners.size > 1) throw BridgeError.invalid("tool results belong to different conversations", "tool_results_mismatch")
      const conv = [...owners][0]
      if (conv) return this.resume(conv, split, signal, log)
      log.info("no pending call for tool results, replaying history", { tools: split.tail.length })
    }
    return this.startConversation(req, split, signal, log)
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Nova conversa
  // ---------------------------------------------------------------------------------------------------------------

  private async startConversation(
    req: CanonicalRequest,
    split: SplitConversation,
    signal: AbortSignal,
    log: Logger,
  ): Promise<Turn> {
    const [models, fallback] = await Promise.all([this.models(), this.host.defaultModel().catch(() => undefined)])
    const model = resolveModel(req.model, models, fallback)

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    const prefix = `br_${id}_`
    const clientTools = req.toolChoice === "none" ? [] : req.tools
    const tools = this.buildTools(prefix, clientTools)
    const rename = (original: string) => tools.originalToPrefixed.get(original) ?? uniqueName(prefix, original, new Set())
    const seed = toNativeMessages(split.history, rename)

    if (signal.aborted) throw abortReason(signal)
    let sessionID: string
    try {
      sessionID = await this.host.createSession({
        title: `[bridge] ${id}`,
        agent: this.config.defaultAgent,
        model: { providerID: model.providerID, id: model.id },
      })
    } catch (e) {
      throw BridgeError.upstream(`Failed to create an OpenCode session: ${e instanceof Error ? e.message : String(e)}`, "session_create_failed")
    }
    const conv = new Conversation(id, sessionID, model, prefix, req, buildSystem(split.systemText, req, tools.byPrefixed), seed, split.promptIsPlaceholder)
    conv.tools = tools.byPrefixed
    conv.originalToPrefixed = tools.originalToPrefixed
    const clog = log.child({ conversationId: id, sessionID, model: fullId(model) })

    this.bySession.set(sessionID, conv)
    conv.channel = this.mux.open(sessionID)
    try {
      if (tools.byPrefixed.size > 0) {
        conv.toolReg = await this.host.registerTools(
          [...tools.byPrefixed.values()].map((t) => this.toolDef(conv, t, clientTools)),
        )
      }
      await this.host.prompt(sessionID, split.prompt)
    } catch (e) {
      await this.finish(conv, "error")
      throw BridgeError.upstream(`Failed to start the OpenCode turn: ${e instanceof Error ? e.message : String(e)}`)
    }
    this.metrics.inc("conversations.started")
    clog.info("conversation started", { tools: tools.byPrefixed.size, seeded: seed.length })
    return this.turnOf(conv, signal, clog)
  }

  private buildTools(prefix: string, defs: ClientTool[]) {
    const byPrefixed = new Map<string, BridgeTool>()
    const originalToPrefixed = new Map<string, string>()
    const used = new Set<string>()
    for (const d of defs) {
      const prefixed = uniqueName(prefix, d.name, used)
      used.add(prefixed)
      let validate: ValidateFunction | undefined
      try {
        validate = this.ajv.compile(d.parameters)
      } catch (e) {
        this.log.warn("tool schema not compilable, arguments will not be validated", { tool: d.name, error: e })
      }
      byPrefixed.set(prefixed, { prefixed, original: d.name, validate })
      originalToPrefixed.set(d.name, prefixed)
    }
    return { byPrefixed, originalToPrefixed }
  }

  private toolDef(conv: Conversation, t: BridgeTool, defs: ClientTool[]) {
    const def = defs.find((d) => d.name === t.original)!
    return {
      name: t.prefixed,
      description: def.description ? `${def.description}\n(client tool "${t.original}")` : `Client tool "${t.original}"`,
      schema: def.parameters,
      execute: async (input: unknown, call: { id: string; signal: AbortSignal }) => {
        const bad = validationError(t, input)
        if (bad) return bad
        conv.waiting.add(call.id)
        try {
          return await this.pending.wait(call.id, call.signal)
        } finally {
          conv.waiting.delete(call.id)
        }
      },
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Retomada
  // ---------------------------------------------------------------------------------------------------------------

  private resume(conv: Conversation, split: SplitConversation, signal: AbortSignal, log: Logger): Turn {
    if (conv.status !== "awaiting") throw BridgeError.invalid("The conversation is not waiting for tool results", "not_awaiting")
    const given = new Map(split.tail.map((t) => [t.toolCallId, t.text]))
    const missing = [...conv.outstanding.keys()].filter((id) => !given.has(id))
    const unknown = [...given.keys()].filter((id) => !conv.outstanding.has(id))
    if (missing.length || unknown.length) {
      throw BridgeError.invalid(
        missing.length
          ? `Missing results for tool calls: ${missing.join(", ")}`
          : `Unknown tool call ids: ${unknown.join(", ")}`,
        "tool_results_mismatch",
        { missing, unknown },
      )
    }
    clearTimeout(conv.ttl)
    conv.ttl = undefined
    conv.status = "running"
    conv.usage = { prompt: 0, completion: 0 }
    for (const id of conv.outstanding.keys()) {
      this.byCall.delete(id)
      this.pending.resolve(id, given.get(id) ?? "")
    }
    conv.outstanding.clear()
    const clog = log.child({ conversationId: conv.id, sessionID: conv.sessionID, model: fullId(conv.model) })
    this.metrics.inc("conversations.resumed")
    clog.info("conversation resumed", { results: given.size })
    return this.turnOf(conv, signal, clog)
  }

  private turnOf(conv: Conversation, signal: AbortSignal, log: Logger): Turn {
    return {
      model: fullId(conv.model),
      conversationId: conv.id,
      sessionID: conv.sessionID,
      events: this.drive(conv, signal, log),
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Execução de uma resposta
  // ---------------------------------------------------------------------------------------------------------------

  private async *drive(conv: Conversation, signal: AbortSignal, log: Logger): AsyncGenerator<CanonicalEvent> {
    const t = this.config.timeouts
    const names = new Map<string, string>()
    let collected: Array<{ id: string; tool: BridgeTool; input: unknown }> = []
    let first = true
    let index = 0
    const onAbort = () => conv.channel.close("aborted")
    signal.addEventListener("abort", onAbort, { once: true })
    let outcome: "done" | "awaiting" | "cancelled" | "error" = "error"
    const startedAt = Date.now()
    this.metrics.inc("responses.started")
    try {
      for (;;) {
        if (signal.aborted) {
          outcome = "cancelled"
          throw abortReason(signal)
        }
        const n = await conv.channel.next(first ? t.firstEventMs : t.idleMs)
        if (n.kind === "timeout") {
          throw BridgeError.timeout(
            first ? "Timed out waiting for the first event from OpenCode" : "Timed out waiting for OpenCode events",
            first ? "first_event_timeout" : "idle_timeout",
          )
        }
        if (n.kind === "closed") {
          if (signal.aborted) {
            outcome = "cancelled"
            throw abortReason(signal)
          }
          throw BridgeError.upstream("The OpenCode event channel closed unexpectedly", "channel_closed")
        }
        if (first) this.metrics.observe("first_event_ms", Date.now() - startedAt)
        first = false
        const { type, data } = n.event
        switch (type) {
          case "session.text.delta":
            if (data.delta) yield { type: "text", delta: String(data.delta) }
            break
          case "session.reasoning.delta":
            if (this.config.exposeReasoning && data.delta) yield { type: "reasoning", delta: String(data.delta) }
            break
          case "session.tool.input.started":
            names.set(String(data.id), String(data.name))
            break
          case "session.tool.called": {
            const tool = conv.tools.get(names.get(String(data.id)) ?? "")
            if (!tool) break // tool nativa: o OpenCode executa
            const input = typeof data.input === "string" ? safeParse(data.input) : data.input
            if (validationError(tool, input)) {
              log.warn("client tool call rejected: invalid arguments", { tool: tool.original, callId: data.id })
              break
            }
            collected.push({ id: String(data.id), tool, input })
            break
          }
          case "session.step.streamed": {
            if (collected.length === 0) break
            for (const c of collected) {
              const call: ToolCall = { id: c.id, name: c.tool.original, arguments: JSON.stringify(c.input ?? {}) }
              conv.outstanding.set(c.id, { prefixed: c.tool.prefixed, original: c.tool.original })
              this.byCall.set(c.id, conv)
              this.metrics.inc("tool_calls.handed_to_client")
              yield { type: "tool_call", index: index++, call }
            }
            collected = []
            conv.status = "awaiting"
            conv.ttl = setTimeout(() => {
              log.warn("client tool results expired", { calls: conv.outstanding.size })
              void this.finish(conv, "expired")
            }, t.pendingTtlMs)
            yield { type: "usage", usage: { promptTokens: conv.usage.prompt, completionTokens: conv.usage.completion } }
            yield { type: "finish", reason: "tool_calls" }
            outcome = "awaiting"
            return
          }
          case "session.step.ended": {
            const tk = data.tokens ?? {}
            conv.usage.prompt += num(tk.input) + num(tk.cache?.read) + num(tk.cache?.write)
            conv.usage.completion += num(tk.output) + num(tk.reasoning)
            conv.lastFinish = mapFinish(String(data.finish ?? "stop"))
            break
          }
          case "session.step.failed": {
            const err = data.error ?? {}
            if (err.type === "aborted" && (conv.interruptedByUs || signal.aborted)) break
            throw BridgeError.upstream(String(err.message ?? "The OpenCode step failed"), "step_failed")
          }
          case "session.execution.succeeded":
            yield { type: "usage", usage: { promptTokens: conv.usage.prompt, completionTokens: conv.usage.completion } }
            yield { type: "finish", reason: conv.lastFinish === "tool_calls" ? "stop" : conv.lastFinish }
            outcome = "done"
            return
          case "session.execution.interrupted":
            if (signal.aborted) {
              outcome = "cancelled"
              throw abortReason(signal)
            }
            throw BridgeError.upstream("The OpenCode session was interrupted", "interrupted")
          case STREAM_LOST:
            throw BridgeError.upstream("The OpenCode event stream was interrupted", "event_stream_lost")
          default:
            if (/^session\.execution\.(failed|errored)$/.test(type)) {
              throw BridgeError.upstream(String(data.error?.message ?? "The OpenCode execution failed"), "execution_failed")
            }
        }
      }
    } catch (e) {
      this.metrics.inc(`errors.${e instanceof BridgeError ? e.code : "unknown"}`)
      throw e
    } finally {
      signal.removeEventListener("abort", onAbort)
      this.metrics.inc(`responses.${outcome}`)
      this.metrics.observe("response_ms", Date.now() - startedAt)
      this.metrics.inc("tokens.prompt", conv.usage.prompt)
      this.metrics.inc("tokens.completion", conv.usage.completion)
      if (outcome !== "awaiting") await this.finish(conv, outcome === "done" ? "done" : outcome)
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Limpeza
  // ---------------------------------------------------------------------------------------------------------------

  /** Idempotente. Interrompe a sessão se necessário, descarta pendências, tools e a sessão. */
  async finish(conv: Conversation, reason: "done" | "cancelled" | "error" | "expired" | "shutdown") {
    if (conv.finished) return
    conv.finished = true
    conv.status = "done"
    this.metrics.inc(`conversations.finished.${reason}`)
    clearTimeout(conv.ttl)
    conv.ttl = undefined
    const log = this.log.child({ conversationId: conv.id, sessionID: conv.sessionID })
    const ids = new Set([...conv.waiting, ...conv.outstanding.keys()])
    this.pending.discard(ids, new Error(`Conversation ended (${reason})`))
    for (const id of conv.outstanding.keys()) this.byCall.delete(id)
    conv.outstanding.clear()
    this.bySession.delete(conv.sessionID)

    if (reason !== "done") {
      conv.interruptedByUs = true
      await this.host.interrupt(conv.sessionID).catch((e) => log.warn("interrupt failed", { error: e }))
    }
    this.mux.release(conv.sessionID)
    await conv.toolReg?.dispose().catch((e) => log.warn("tool dispose failed", { error: e }))
    if (!this.config.keepSessions) {
      await this.host.removeSession(conv.sessionID).catch((e) => log.warn("session remove failed", { error: e }))
    }
    log.info("conversation finished", { reason })
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Hooks do OpenCode
  // ---------------------------------------------------------------------------------------------------------------

  private onContext(d: ContextDraft) {
    const conv = this.bySession.get(d.sessionID)
    if (!conv) return
    if (conv.systemText) d.system.push({ type: "text", text: conv.systemText })

    const p = conv.req.params
    const o = d.options
    if (p.temperature !== undefined && conv.model.temperature) o.temperature = p.temperature
    if (p.topP !== undefined) o.topP = p.topP
    if (p.maxTokens !== undefined) o.maxTokens = p.maxTokens
    if (p.stop?.length) o.stop = p.stop
    if (p.seed !== undefined) o.seed = p.seed
    if (p.frequencyPenalty !== undefined) o.frequencyPenalty = p.frequencyPenalty
    if (p.presencePenalty !== undefined) o.presencePenalty = p.presencePenalty

    // Só as tools desta conversa: as de outras conversas ficam registradas na location, mas invisíveis aqui.
    for (const key of Object.keys(d.tools)) {
      if (key.startsWith("br_") && !conv.tools.has(key)) delete d.tools[key]
    }
    if (conv.dropPersistedFirst) d.messages.shift()
    if (conv.seed.length) d.messages.splice(0, 0, ...conv.seed)
  }

  private onPermission(d: PermissionDraft) {
    if (!this.bySession.has(d.sessionID)) return
    const before = d.effect
    let effect = before
    if (this.config.readOnly && WRITE_ACTIONS.has(d.action) && before !== "deny") {
      effect = "deny"
    } else if (before === "ask") {
      const a = this.config.autoApprove
      effect = a === "all" || (a === "edit" && d.action === "edit") ? "allow" : "deny"
    }
    if (effect !== before) {
      d.effect = effect
      if (effect === "deny") d.message = `Denied by opencode-bridge: "${d.action}" needs approval and this session has no interactive user.`
      this.log.info("permission resolved", { sessionID: d.sessionID, action: d.action, from: before, to: effect })
    }
  }
}

// -------------------------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------------------------

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0)

function mapFinish(f: string): FinishReason {
  if (f === "length") return "length"
  if (f === "content-filter") return "content_filter"
  if (f === "tool-calls") return "tool_calls"
  return "stop"
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

function abortReason(signal: AbortSignal): BridgeError {
  const r = (signal as { reason?: unknown }).reason
  return r instanceof BridgeError ? r : new BridgeError(499, "cancelled", "client_closed_request", "Client closed the request")
}

function sanitize(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, "_")
}

/** `br_<conv>_<nome>` com no máximo 64 caracteres e único dentro da conversa. */
function uniqueName(prefix: string, original: string, used: Set<string>): string {
  const max = 64 - prefix.length
  let base = sanitize(original).slice(0, max) || "tool"
  let candidate = prefix + base
  for (let i = 2; used.has(candidate); i++) {
    const suffix = `_${i}`
    candidate = prefix + base.slice(0, max - suffix.length) + suffix
  }
  return candidate
}

function validationError(tool: BridgeTool, input: unknown): string | undefined {
  if (!tool.validate) return undefined
  if (tool.validate(input)) return undefined
  const detail = (tool.validate.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")
  return `Invalid arguments for tool "${tool.original}": ${detail}. Call the tool again with valid arguments.`
}

function buildSystem(systemText: string, req: CanonicalRequest, tools: Map<string, BridgeTool>): string {
  const parts: string[] = []
  if (systemText) parts.push(systemText)
  if (tools.size > 0) {
    parts.push(CODE_MODE_HINT)
    const tc = req.toolChoice
    if (tc === "required") parts.push("You must call one of the client tools in your next response.")
    else if (typeof tc === "object") {
      const forced = [...tools.values()].find((t) => t.original === tc.name)
      if (forced) parts.push(`You must call the tool \`${forced.prefixed}\` in your next response.`)
    }
  }
  return parts.join("\n\n")
}

export type { ModelRef }
