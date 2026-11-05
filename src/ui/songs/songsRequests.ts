/**
 * Cross-view request to open a chart in the Songs view (owned by Songs, used by Learn,
 * Practice review, My Practice ...). React-free module store:
 *
 *   requestChart("dorian-drift", { arrangementId: "dorian-drift-simple", sectionId: "A" });
 *   runtime.navigate.openEntry("songs");
 *
 * SongsView consumes the pending request on mount (and listens while mounted).
 */
export interface ChartRequest {
  chartId: string;
  arrangementId?: string;
  sectionId?: string;
  /** Increments with every request. */
  requestId: number;
}

type Listener = (request: ChartRequest) => void;

let pending: ChartRequest | null = null;
let counter = 0;
const listeners = new Set<Listener>();

/** Ask the Songs view to open a chart (optionally an arrangement and a section to loop). */
export function requestChart(chartId: string, options: { arrangementId?: string; sectionId?: string } = {}): ChartRequest {
  counter += 1;
  const request: ChartRequest = { chartId, requestId: counter };
  if (options.arrangementId !== undefined) request.arrangementId = options.arrangementId;
  if (options.sectionId !== undefined) request.sectionId = options.sectionId;
  pending = request;
  listeners.forEach((listener) => listener(request));
  return request;
}

/** Take (and clear) the pending request. */
export function consumeChartRequest(): ChartRequest | null {
  const request = pending;
  pending = null;
  return request;
}

/** Look at the pending request without clearing it. */
export function peekChartRequest(): ChartRequest | null {
  return pending;
}

/** Called for requests made while a Songs view is mounted. */
export function subscribeChartRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
