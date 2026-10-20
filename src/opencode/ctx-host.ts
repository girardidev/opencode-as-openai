import type {
  ClientToolDef,
  ContextDraft,
  Disposable,
  HostEvent,
  ModelInfo,
  OpenCodeHost,
  PermissionDraft,
} from "./host.ts"
import type { ModelRef } from "../core/canonical.ts"

/**
 * Adapter do `ctx` do plugin v2 para `OpenCodeHost`.
 * O `ctx` é tipado como `any` aqui de propósito: é o único arquivo que conhece a forma da API de plugin,
 * então uma mudança nela fica isolada neste adapter.
 */
export class CtxHost implements OpenCodeHost {
  readonly directory: string

  constructor(private readonly ctx: any) {
    this.directory = String(ctx.location?.directory ?? "")
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await this.ctx.model.list()
    const data: any[] = Array.isArray(res) ? res : (res?.data ?? [])
    return data
      .filter((m) => m.enabled !== false && (m.status === undefined || m.status === "active"))
      .map((m) => ({
        providerID: String(m.providerID),
        id: String(m.id),
        name: String(m.name ?? m.id),
        temperature: m.capabilities?.temperature !== false,
        tools: m.capabilities?.tools !== false,
      }))
  }

  async defaultModel(): Promise<ModelRef | undefined> {
    const res = await this.ctx.model.default()
    const m = res?.data ?? res
    return m?.id ? { providerID: String(m.providerID), id: String(m.id) } : undefined
  }

  async createSession(input: { title: string; agent: string; model: ModelRef }): Promise<string> {
    const s = await this.ctx.session.create({ title: input.title, agent: input.agent, model: input.model })
    return String(s.id)
  }

  async prompt(sessionID: string, text: string): Promise<void> {
    await this.ctx.session.prompt({ sessionID, text })
  }

  async interrupt(sessionID: string): Promise<void> {
    await this.ctx.session.interrupt({ sessionID, continue: false })
  }

  async removeSession(sessionID: string): Promise<void> {
    await this.ctx.session.remove({ sessionID })
  }

  subscribe(signal: AbortSignal): AsyncIterable<HostEvent> {
    return this.ctx.event.subscribe({ signal })
  }

  async registerTools(defs: ClientToolDef[]): Promise<Disposable> {
    const reg = await this.ctx.tool.transform((editor: any) => {
      for (const d of defs) {
        editor.add({
          name: d.name,
          description: d.description,
          input: d.schema,
          // sem isso a tool entra no catálogo "code mode" e o modelo só a alcança via `execute`
          options: { codemode: false },
          execute: async (input: unknown, c: any) => ({
            content: await d.execute(input, { id: String(c.id), sessionID: String(c.sessionID), signal: c.signal }),
          }),
        })
      }
    })
    return { dispose: () => reg.dispose() }
  }

  async onContext(fn: (draft: ContextDraft) => void): Promise<Disposable> {
    const reg = await this.ctx.session.hook("context", fn)
    return { dispose: () => reg.dispose() }
  }

  async onPermission(fn: (draft: PermissionDraft) => void): Promise<Disposable> {
    const reg = await this.ctx.permission.hook("evaluate", fn)
    return { dispose: () => reg.dispose() }
  }
}
