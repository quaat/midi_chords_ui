"use client";

import { useEffect, useRef } from "react";

export interface LiveTextProps {
  /** Polled every animation frame; the DOM text is only touched when it changes. */
  getText?: () => string;
  fallback?: string;
  className?: string;
}

/**
 * High-frequency text (beat position, clock) written straight to the DOM so React never
 * re-renders per frame. Not an ARIA live region on purpose.
 */
export function LiveText({ getText, fallback = "", className }: LiveTextProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    if (!getText || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      element.textContent = fallback;
      return undefined;
    }
    let last: string | null = null;
    let frame = 0;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) {
        return;
      }
      const text = getText();
      if (text !== last) {
        element.textContent = text;
        last = text;
      }
      frame = window.requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [getText, fallback]);

  // No React-managed children: the effect owns the text node.
  return <span ref={ref} className={className} />;
}
