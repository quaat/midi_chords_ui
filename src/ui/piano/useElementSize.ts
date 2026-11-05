"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Observe an element's content-box size in CSS px (ResizeObserver, window resize fallback).
 * Values are rounded down to whole pixels so sub-pixel jitter does not re-layout keys.
 */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const update = (): void => {
      const width = Math.floor(element.clientWidth);
      const height = Math.floor(element.clientHeight);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => update());
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ref]);

  return size;
}
