/** Small shared helpers for persistence modules (no external dependencies). */

/** Deep clone of JSON-shaped data. Persistence only ever stores JSON, so this is lossless for it. */
export function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Collision-resistant local id; uses crypto.randomUUID when the platform provides it. */
export function generateId(prefix: string): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike !== undefined && typeof cryptoLike.randomUUID === "function") {
    return `${prefix}-${cryptoLike.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/**
 * ISO timestamp for "now" that is strictly later than `previous` (when given), so that
 * updatedAt always increases even when two saves land in the same millisecond.
 */
export function bumpTimestamp(previous: string | undefined, now: Date): string {
  const current = now.getTime();
  const prior = previous === undefined ? Number.NaN : Date.parse(previous);
  const next = Number.isFinite(prior) && prior >= current ? prior + 1 : current;
  return new Date(next).toISOString();
}

export function toEpochMs(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export interface StoreOptions {
  /** Clock injection for deterministic tests. */
  now?: () => Date;
  /** Id factory injection for deterministic tests. */
  newId?: (prefix: string) => string;
}

export interface ResolvedStoreOptions {
  now: () => Date;
  newId: (prefix: string) => string;
}

export function resolveStoreOptions(options: StoreOptions = {}): ResolvedStoreOptions {
  return {
    now: options.now ?? (() => new Date()),
    newId: options.newId ?? generateId
  };
}
