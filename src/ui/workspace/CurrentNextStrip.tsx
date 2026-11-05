"use client";

import clsx from "clsx";
import { LiveText } from "@/ui/workspace/LiveText";

export interface ChordSummary {
  symbol: string;
  /** e.g. note names or degrees "C E G" / "1 3 5". */
  detail?: string;
}

export interface CurrentNextStripProps {
  current?: ChordSummary | null;
  next?: ChordSummary | null;
  /** One short learning prompt. */
  prompt?: string;
  /** Polled per frame for the beat position (never React state). */
  getPositionLabel?: () => string;
  positionLabel?: string;
  className?: string;
}

export function CurrentNextStrip({ current, next, prompt, getPositionLabel, positionLabel = "", className }: CurrentNextStripProps): JSX.Element {
  return (
    <div className={clsx("pls-current-next", className)} role="group" aria-label="Current and next chord">
      <div className="pls-current-next__item pls-current-next__item--current" aria-live="polite" aria-atomic="true">
        <span className="pls-current-next__kicker">Now</span>
        <span className="pls-current-next__symbol">{current?.symbol ?? "—"}</span>
        {current?.detail ? <span className="pls-current-next__detail">{current.detail}</span> : null}
      </div>
      <div className="pls-current-next__item pls-current-next__item--next">
        <span className="pls-current-next__kicker">Next</span>
        <span className="pls-current-next__symbol">{next?.symbol ?? "—"}</span>
        {next?.detail ? <span className="pls-current-next__detail">{next.detail}</span> : null}
      </div>
      <div className="pls-current-next__item pls-current-next__item--position">
        <span className="pls-current-next__kicker">Position</span>
        <LiveText className="pls-current-next__position" getText={getPositionLabel} fallback={positionLabel} />
      </div>
      {prompt ? <p className="pls-current-next__prompt">{prompt}</p> : null}
    </div>
  );
}
