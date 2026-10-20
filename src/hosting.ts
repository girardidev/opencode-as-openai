import { realpathSync } from "node:fs"
import { ConfigError, defaultLogFile, parseConfig, type BridgeConfig } from "./config.ts"
import { Bridge } from "./core/bridge.ts"
import { BridgeError } from "./core/errors.ts"
import { createServer, type Registry } from "./http/server.ts"
import { fileLogger, nullLogger, type Logger } from "./obs/logger.ts"
import type { OpenCodeHost } from "./opencode/host.ts"

const canonical = (dir: string) => {
  try {
    return realpathSync(dir)
  } catch {
    return dir
  }
}

/**
 * Estado compartilhado por todas as locations de um processo OpenCode: um servidor HTTP e um `Bridge` por location.
 * O plugin é carregado uma vez por location, então esta instância vive em `globalThis` (ver `sharedHosting`).
 */
export class Hosting implements Registry {
  private locations = new Map<string, Bridge>()
  private server: ReturnType<typeof createServer> | undefined
  private config: BridgeConfig | undefined
  private log: Logger = nullLogger

  constructor(private readonly serverOptions: { keepaliveMs?: number; port?: number } = {}) {}

  get port(): number | undefined {
    return this.server?.port
  }

  get registered(): string[] {
    return [...this.locations.keys()]
  }

  /** Registra uma location e devolve a função de limpeza do plugin. Nunca lança: o OpenCode precisa seguir carregando. */
  async register(host: OpenCodeHost, options: unknown): Promise<() => Promise<void>> {
    const noop = async () => {}
    try {
      if (!this.config) {
        this.config = parseConfig(options)
        this.log = this.config.logFile ? fileLogger(this.config.logFile) : nullLogger
      }
    } catch (e) {
      const log = fileLogger(defaultLogFile())
      log.error(e instanceof ConfigError ? "invalid plugin options, bridge disabled" : "bridge setup failed", { error: e })
      return noop
    }

    const dir = canonical(host.directory)
    if (this.locations.has(dir)) {
      this.log.warn("location already registered", { directory: dir })
      return noop
    }
    try {
      const bridge = new Bridge(host, this.config, this.log.child({ location: dir }))
      await bridge.start()
      this.locations.set(dir, bridge)
      this.log.info("location registered", { directory: dir, locations: this.locations.size })
    } catch (e) {
      this.log.error("failed to start the bridge for this location", { directory: dir, error: e })
      return noop
    }

    if (!this.server) this.startServer()
    return () => this.unregister(dir)
  }

  private startServer() {
    const config = this.config!
    try {
      this.server = createServer({ config, log: this.log, registry: this, ...this.serverOptions })
      this.log.info("server listening", { host: config.host, port: this.server.port })
    } catch (e) {
      // porta ocupada (outro OpenCode) ou sem permissão: o OpenCode continua normalmente
      this.log.warn("could not start the HTTP server; another process may be using the port", {
        host: config.host,
        port: config.port,
        error: e,
      })
    }
  }

  async unregister(dir: string) {
    const bridge = this.locations.get(dir)
    if (!bridge) return
    this.locations.delete(dir)
    await bridge.stop().catch((e) => this.log.warn("bridge stop failed", { directory: dir, error: e }))
    this.log.info("location unregistered", { directory: dir, locations: this.locations.size })
    if (this.locations.size === 0) {
      this.server?.stop(true)
      this.server = undefined
      this.config = undefined
      this.log.info("server stopped")
    }
  }

  pick(directoryHeader: string | null): Bridge {
    if (this.locations.size === 0) {
      throw new BridgeError(503, "api_error", "no_location", "No OpenCode location is registered in this process")
    }
    if (directoryHeader) {
      const bridge = this.locations.get(canonical(directoryHeader))
      if (!bridge) {
        throw BridgeError.notFound("location_not_found", `No OpenCode location is loaded for "${directoryHeader}"`, {
          available: [...this.locations.keys()],
        })
      }
      return bridge
    }
    return this.locations.values().next().value as Bridge
  }

  status() {
    return [...this.locations.values()].map((b) => b.health())
  }
}

const KEY = Symbol.for("opencode-bridge.hosting")

/** Instância única por processo, compartilhada entre as locations em que o plugin é carregado. */
export function sharedHosting(): Hosting {
  const g = globalThis as Record<symbol, unknown>
  return (g[KEY] ??= new Hosting()) as Hosting
}
