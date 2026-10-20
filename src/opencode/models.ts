import type { ModelRef } from "../core/canonical.ts"
import { BridgeError } from "../core/errors.ts"
import type { ModelInfo } from "./host.ts"

export const fullId = (m: ModelRef) => `${m.providerID}/${m.id}`

/**
 * Resolve o campo `model` da request para exatamente um modelo.
 * - `provider/model` exato;
 * - ID sem provider apenas se único;
 * - vazio: modelo padrão do OpenCode.
 */
export function resolveModel(raw: string | undefined, models: ModelInfo[], fallback: ModelRef | undefined): ModelInfo {
  const wanted = raw?.trim()
  if (!wanted) {
    if (!fallback) throw BridgeError.invalid("No model specified and OpenCode has no default model", "model_required")
    const m = models.find((x) => x.providerID === fallback.providerID && x.id === fallback.id)
    if (!m) throw BridgeError.notFound("model_not_found", `Default model ${fullId(fallback)} is not available`)
    return m
  }

  const exact = models.find((m) => fullId(m) === wanted)
  if (exact) return exact

  if (!wanted.includes("/")) {
    const matches = models.filter((m) => m.id === wanted)
    if (matches.length === 1) return matches[0]!
    if (matches.length > 1) {
      const candidates = matches.map(fullId)
      throw BridgeError.invalid(
        `Model "${wanted}" is ambiguous; use one of: ${candidates.join(", ")}`,
        "model_ambiguous",
        { candidates },
      )
    }
  }
  throw BridgeError.notFound("model_not_found", `The model "${wanted}" does not exist or is not available`)
}

/** Cache curto para não consultar o OpenCode a cada request. */
export class ModelCatalog {
  private cache: { at: number; models: ModelInfo[] } | undefined

  constructor(
    private readonly load: () => Promise<ModelInfo[]>,
    private readonly ttlMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<ModelInfo[]> {
    if (this.cache && this.now() - this.cache.at < this.ttlMs) return this.cache.models
    const models = await this.load()
    this.cache = { at: this.now(), models }
    return models
  }
}
