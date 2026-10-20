import { homedir } from "node:os"
import { join } from "node:path"

export type AutoApprove = "none" | "edit" | "all"

export interface BridgeConfig {
  host: string
  port: number
  apiKeys: string[]
  defaultAgent: string
  autoApprove: AutoApprove
  readOnly: boolean
  keepSessions: boolean
  exposeReasoning: boolean
  corsOrigins: string[]
  logFile: string | undefined
  timeouts: {
    /** Até o primeiro evento da turn. */
    firstEventMs: number
    /** Silêncio máximo entre eventos. */
    idleMs: number
    /** Duração total de uma resposta HTTP. */
    totalMs: number
    /** Tempo que uma tool call do cliente pode ficar sem resultado. */
    pendingTtlMs: number
  }
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid opencode-bridge options: ${problems.join("; ")}`)
    this.name = "ConfigError"
  }
}

export function defaultLogFile(): string {
  const state = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")
  return join(state, "opencode-bridge", "bridge.log")
}

export const defaults: BridgeConfig = {
  host: "127.0.0.1",
  port: 4010,
  apiKeys: [],
  defaultAgent: "build",
  autoApprove: "none",
  readOnly: false,
  keepSessions: false,
  exposeReasoning: false,
  corsOrigins: [],
  logFile: undefined,
  timeouts: { firstEventMs: 120_000, idleMs: 300_000, totalMs: 1_800_000, pendingTtlMs: 600_000 },
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"])

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host)
}

/** Valida `ctx.options` do plugin e aplica os padrões. Lança `ConfigError` com todos os problemas. */
export function parseConfig(raw: unknown): BridgeConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const problems: string[] = []
  const str = (k: string, d: string) => {
    const v = o[k]
    if (v === undefined) return d
    if (typeof v !== "string" || v.length === 0) problems.push(`${k} must be a non-empty string`)
    return typeof v === "string" ? v : d
  }
  const bool = (k: string, d: boolean) => {
    const v = o[k]
    if (v === undefined) return d
    if (typeof v !== "boolean") problems.push(`${k} must be a boolean`)
    return typeof v === "boolean" ? v : d
  }
  const strList = (k: string) => {
    const v = o[k]
    if (v === undefined) return []
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x)) {
      problems.push(`${k} must be an array of non-empty strings`)
      return []
    }
    return v as string[]
  }
  const posInt = (src: Record<string, unknown>, k: string, d: number, label = k, min = 1) => {
    const v = src[k]
    if (v === undefined) return d
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) problems.push(`${label} must be an integer >= ${min}`)
    return typeof v === "number" && Number.isInteger(v) && v >= min ? v : d
  }

  const host = str("host", defaults.host)
  const port = posInt(o, "port", defaults.port, "port", 0)
  if (typeof o.port === "number" && o.port > 65535) problems.push("port must be <= 65535")
  const apiKeys = strList("apiKeys")
  const autoApprove = str("autoApprove", defaults.autoApprove) as AutoApprove
  if (!["none", "edit", "all"].includes(autoApprove)) problems.push('autoApprove must be "none", "edit" or "all"')

  const t = (o.timeouts && typeof o.timeouts === "object" ? o.timeouts : {}) as Record<string, unknown>
  const timeouts = {
    firstEventMs: posInt(t, "firstEventMs", defaults.timeouts.firstEventMs, "timeouts.firstEventMs"),
    idleMs: posInt(t, "idleMs", defaults.timeouts.idleMs, "timeouts.idleMs"),
    totalMs: posInt(t, "totalMs", defaults.timeouts.totalMs, "timeouts.totalMs"),
    pendingTtlMs: posInt(t, "pendingTtlMs", defaults.timeouts.pendingTtlMs, "timeouts.pendingTtlMs"),
  }

  if (!isLoopback(host) && apiKeys.length === 0) problems.push("apiKeys is required when host is not a loopback address")
  if (problems.length) throw new ConfigError(problems)

  return {
    host,
    port,
    apiKeys,
    defaultAgent: str("defaultAgent", defaults.defaultAgent),
    autoApprove,
    readOnly: bool("readOnly", defaults.readOnly),
    keepSessions: bool("keepSessions", defaults.keepSessions),
    exposeReasoning: bool("exposeReasoning", defaults.exposeReasoning),
    corsOrigins: strList("corsOrigins"),
    // `false` desliga o log em arquivo
    logFile: o.logFile === false ? undefined : typeof o.logFile === "string" ? o.logFile : defaultLogFile(),
    timeouts,
  }
}
