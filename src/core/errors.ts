export type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "not_found_error"
  | "timeout_error"
  | "api_error"
  | "cancelled"

/** Erro com status HTTP e formato OpenAI (`{ error: { message, type, code } }`). */
export class BridgeError extends Error {
  constructor(
    public readonly status: number,
    public readonly type: ErrorType,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "BridgeError"
  }

  toBody() {
    return { error: { message: this.message, type: this.type, code: this.code, param: null, ...this.extra } }
  }

  static invalid(message: string, code = "invalid_request", extra?: Record<string, unknown>) {
    return new BridgeError(400, "invalid_request_error", code, message, extra)
  }
  static notFound(code: string, message: string, extra?: Record<string, unknown>) {
    return new BridgeError(404, "not_found_error", code, message, extra)
  }
  static unauthorized(message = "Invalid or missing API key") {
    return new BridgeError(401, "authentication_error", "invalid_api_key", message)
  }
  static timeout(message: string, code = "timeout") {
    return new BridgeError(504, "timeout_error", code, message)
  }
  static upstream(message: string, code = "upstream_error") {
    return new BridgeError(502, "api_error", code, message)
  }
  static internal(message: string, code = "internal_error") {
    return new BridgeError(500, "api_error", code, message)
  }
}

export function toBridgeError(e: unknown): BridgeError {
  if (e instanceof BridgeError) return e
  const msg = e instanceof Error ? e.message : String(e)
  return BridgeError.internal(msg)
}
