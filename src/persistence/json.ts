/** JSON parsing with typed failures and deterministic pretty serialisation. */

import { fail, ok, type Result } from "./result";
import { isRecord } from "./guards";

/** Parse JSON text; empty or malformed text fails with code "corrupt" (never throws). */
export function parseJson(text: unknown, label: string): Result<unknown> {
  if (typeof text !== "string") {
    return fail("invalid", `The ${label} must be provided as JSON text.`);
  }
  if (text.trim() === "") {
    return fail("corrupt", `The ${label} is empty.`, { preserved: text });
  }
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("corrupt", `The ${label} is not valid JSON and could not be read (${message}).`, {
      original: error,
      preserved: text
    });
  }
}

/** Keys emitted first (in this order) at every object level; all others follow alphabetically. */
export const DEFAULT_KEY_PRIORITY: readonly string[] = ["schemaVersion", "kind", "id", "version", "name", "title"];

function sortValue(value: unknown, priority: readonly string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item, priority));
  if (isRecord(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    keys.sort((a, b) => {
      const pa = priority.indexOf(a);
      const pb = priority.indexOf(b);
      if (pa !== -1 || pb !== -1) {
        if (pa === -1) return 1;
        if (pb === -1) return -1;
        return pa - pb;
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = sortValue(value[key], priority);
    return out;
  }
  return value;
}

/** Pretty (2-space) JSON with a stable key order, terminated by a newline. */
export function stableStringify(value: unknown, priority: readonly string[] = DEFAULT_KEY_PRIORITY): string {
  return `${JSON.stringify(sortValue(value, priority), null, 2)}\n`;
}
