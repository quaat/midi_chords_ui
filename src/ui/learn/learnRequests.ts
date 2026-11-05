/**
 * Requests for the Learn view from other views (Songs → "Learn this concept").
 * Practice review uses `consumeConceptRequest` in src/ui/practice/practiceRequests.ts;
 * LearnView reads both on mount.
 */
export type LearnRequest = { kind: "concept"; id: string } | { kind: "path"; id: string };

type Listener = (request: LearnRequest) => void;

let pending: LearnRequest | null = null;
const listeners = new Set<Listener>();

export function requestLearnPage(request: LearnRequest): void {
  pending = request;
  listeners.forEach((listener) => listener(request));
}

export function consumeLearnRequest(): LearnRequest | null {
  const request = pending;
  pending = null;
  return request;
}

export function subscribeLearnRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
