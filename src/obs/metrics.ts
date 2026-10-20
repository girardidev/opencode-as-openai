/** Contadores e janelas de latência em memória, expostos em `/health`. */
export class Metrics {
  private counters = new Map<string, number>()
  private windows = new Map<string, number[]>()

  constructor(private readonly windowSize = 200) {}

  inc(name: string, n = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + n)
  }

  observe(name: string, ms: number) {
    const w = this.windows.get(name) ?? []
    w.push(ms)
    if (w.length > this.windowSize) w.shift()
    this.windows.set(name, w)
  }

  snapshot() {
    const counters: Record<string, number> = {}
    for (const [k, v] of [...this.counters].sort(([a], [b]) => a.localeCompare(b))) counters[k] = v
    const latency: Record<string, { count: number; p50: number; p95: number; max: number }> = {}
    for (const [k, w] of this.windows) {
      const s = [...w].sort((a, b) => a - b)
      const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0
      latency[k] = { count: s.length, p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 }
    }
    return { counters, latency }
  }
}
