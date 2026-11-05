/**
 * Typed results and errors for local persistence.
 *
 * Persistence never throws into the app: every store method returns a `Result`. Adapters
 * may throw `PersistenceError` internally; stores catch and convert.
 */

export type PersistenceErrorCode = "quota" | "unavailable" | "corrupt" | "unsupportedVersion" | "invalid";

export interface PersistenceErrorOptions {
  details?: string[];
  /** The underlying thrown value (DOMException, SyntaxError, ...). */
  original?: unknown;
  /**
   * For "unsupportedVersion"/"corrupt": the untouched input so the UI can offer to save it
   * elsewhere. Never mutated by persistence code.
   */
  preserved?: unknown;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly details: string[];
  readonly original?: unknown;
  readonly preserved?: unknown;

  constructor(code: PersistenceErrorCode, message: string, options: PersistenceErrorOptions = {}) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.details = options.details ?? [];
    this.original = options.original;
    this.preserved = options.preserved;
  }
}

export interface Success<T> {
  ok: true;
  value: T;
  /** Non-blocking notes (migrations applied, entries skipped, index rebuilt ...). */
  warnings: string[];
}

export interface Failure {
  ok: false;
  error: PersistenceError;
}

export type Result<T> = Success<T> | Failure;

export function ok<T>(value: T, warnings: string[] = []): Success<T> {
  return { ok: true, value, warnings };
}

export function fail(code: PersistenceErrorCode, message: string, options: PersistenceErrorOptions = {}): Failure {
  return { ok: false, error: new PersistenceError(code, message, options) };
}

export function failWith(error: PersistenceError): Failure {
  return { ok: false, error };
}

/** True for the QuotaExceededError variants thrown by browsers' Web Storage. */
export function isQuotaError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error !== null && typeof error === "object") {
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    if (typeof name === "string" || typeof message === "string") {
      return `${typeof name === "string" ? name : "Error"}: ${typeof message === "string" ? message : ""}`;
    }
  }
  return String(error);
}

/** Convert anything thrown by a storage backend into a typed PersistenceError. */
export function toPersistenceError(error: unknown, context: string): PersistenceError {
  if (error instanceof PersistenceError) return error;
  if (isQuotaError(error)) {
    return new PersistenceError(
      "quota",
      `Local storage is full while ${context}. Nothing was overwritten; export a backup or remove old projects to free space.`,
      { original: error }
    );
  }
  return new PersistenceError("unavailable", `Local storage is not available while ${context} (${describeThrown(error)}).`, {
    original: error
  });
}
