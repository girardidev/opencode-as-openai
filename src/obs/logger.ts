import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

export type Level = "debug" | "info" | "warn" | "error"
const RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

export interface Logger {
  debug(msg: string, fields?: Fields): void
  info(msg: string, fields?: Fields): void
  warn(msg: string, fields?: Fields): void
  error(msg: string, fields?: Fields): void
  /** Logger derivado que acrescenta campos fixos (ex.: `reqId`, `sessionID`). */
  child(fields: Fields): Logger
}

export type Fields = Record<string, unknown>

type Sink = (line: string) => void

function make(sink: Sink, min: Level, base: Fields): Logger {
  const emit = (level: Level, msg: string, fields?: Fields) => {
    if (RANK[level] < RANK[min]) return
    try {
      sink(JSON.stringify({ t: new Date().toISOString(), level, msg, ...base, ...fields }, replacer))
    } catch {
      // um log nunca pode derrubar a request
    }
  }
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (f) => make(sink, min, { ...base, ...f }),
  }
}

function replacer(_k: string, v: unknown) {
  if (typeof v === "bigint") return String(v)
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack }
  return v
}

/** Escreve JSON Lines em arquivo. Nunca usa stdout/stderr, para não corromper o TUI do OpenCode. */
export function fileLogger(path: string, min: Level = "info"): Logger {
  let ready = false
  const sink: Sink = (line) => {
    try {
      if (!ready) {
        mkdirSync(dirname(path), { recursive: true })
        ready = true
      }
      appendFileSync(path, line + "\n")
    } catch {
      // sem disco, sem log
    }
  }
  return make(sink, min, {})
}

export function memoryLogger(lines: string[] = [], min: Level = "debug"): Logger & { lines: string[] } {
  return Object.assign(make((l) => void lines.push(l), min, {}), { lines })
}

export const nullLogger: Logger = make(() => {}, "error", {})
