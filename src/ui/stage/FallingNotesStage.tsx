"use client";

import { useEffect, useMemo, useRef } from "react";
import clsx from "clsx";
import type { PartId, PerformanceTimeline, TransportSnapshot } from "@/model/contracts";
import type { KeyLayout } from "@/ui/piano/geometry";
import type { SpellingPreference } from "@/ui/piano/pianoLabels";
import type { LearnerTraceNote, StageColors, StageLabelMode } from "@/ui/stage/stageRenderer";
import { drawStage, FALLBACK_STAGE_COLORS, readStageColors } from "@/ui/stage/stageRenderer";
import { stepsFrom } from "@/ui/stage/stageMath";
import { toStaticSteps } from "@/ui/stage/staticSteps";
import { StaticStepView } from "@/ui/stage/StaticStepView";
import { useCurrentStep } from "@/ui/stage/useCurrentStep";

export type { LearnerTraceNote, StageLabelMode, TraceVerdict } from "@/ui/stage/stageRenderer";

export interface FallingNotesStageOptions {
  showBeatGrid: boolean;
  showLabels: StageLabelMode;
  partsVisible: Set<PartId>;
  /** Static trace of what the learner played (use getLearnerTrace for live traces). */
  learnerTrace?: LearnerTraceNote[];
  /** Static step view instead of animation (plan "static step view"). */
  reducedMotion: boolean;
  spelling?: SpellingPreference;
  /** Steps listed in the static view, current included (default 4). */
  staticStepCount?: number;
  /** Beats kept visible below the strike line's past (default 0: notes end at the keys). */
  pastBeats?: number;
}

export interface FallingNotesStageProps {
  timeline: PerformanceTimeline | null;
  /** Read once per animation frame; never stored in React state. Should be referentially stable. */
  getSnapshot: () => TransportSnapshot;
  /** The piano's layout (same range and width), so lanes align with keys. */
  layout: KeyLayout;
  lookaheadBeats?: number;
  options: FallingNotesStageOptions;
  /** Optional live trace getter, read each frame. */
  getLearnerTrace?: () => readonly LearnerTraceNote[];
  /** CSS height in px; when omitted the stage fills its container (see .pls-stage CSS). */
  height?: number;
  className?: string;
  ariaLabel?: string;
}

interface LiveProps {
  timeline: PerformanceTimeline | null;
  getSnapshot: () => TransportSnapshot;
  getLearnerTrace?: () => readonly LearnerTraceNote[];
  layout: KeyLayout;
  lookaheadBeats: number;
  options: FallingNotesStageOptions;
}

export function FallingNotesStage({
  timeline,
  getSnapshot,
  layout,
  lookaheadBeats = 4,
  options,
  getLearnerTrace,
  height,
  className,
  ariaLabel = "Falling notes: upcoming notes move down toward the keys they belong to."
}: FallingNotesStageProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<LiveProps>({ timeline, getSnapshot, getLearnerTrace, layout, lookaheadBeats, options });
  liveRef.current = { timeline, getSnapshot, getLearnerTrace, layout, lookaheadBeats, options };
  // Any re-render (new props) invalidates the last drawn frame.
  const versionRef = useRef(0);
  versionRef.current += 1;

  const reducedMotion = options.reducedMotion;

  useEffect(() => {
    if (reducedMotion) {
      return undefined;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || typeof window === "undefined") {
      return undefined;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return undefined;
    }

    let width = 0;
    let heightPx = 0;
    let dpr = 1;
    let lastKey = "";
    let frame = 0;
    let cancelled = false;
    let colors: StageColors = FALLBACK_STAGE_COLORS;

    const resize = (): void => {
      width = Math.max(0, Math.floor(container.clientWidth));
      heightPx = Math.max(0, Math.floor(container.clientHeight));
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(heightPx * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${heightPx}px`;
      lastKey = "";
    };

    const refreshColors = (): void => {
      colors = readStageColors(canvas);
      lastKey = "";
    };

    resize();
    refreshColors();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resize());
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", resize);
    }

    let themeObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      themeObserver = new MutationObserver(() => refreshColors());
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    }

    const tick = (): void => {
      if (cancelled) {
        return;
      }
      const currentDpr = window.devicePixelRatio || 1;
      if (currentDpr !== dpr) {
        resize(); // zoom or moving to another display
      }
      const live = liveRef.current;
      const snapshot = live.getSnapshot();
      const trace = live.getLearnerTrace ? live.getLearnerTrace() : live.options.learnerTrace;
      const key = [
        snapshot.positionBeats,
        snapshot.state,
        snapshot.generation,
        snapshot.loop ? `${snapshot.loop.startBeat}-${snapshot.loop.endBeat}` : "",
        width,
        heightPx,
        dpr,
        versionRef.current,
        trace ? trace.length : 0
      ].join("|");
      if (key !== lastKey) {
        lastKey = key;
        drawStage({
          ctx,
          width,
          height: heightPx,
          dpr,
          timeline: live.timeline,
          snapshot,
          layout: live.layout,
          lookaheadBeats: Math.max(0.5, live.lookaheadBeats),
          pastBeats: live.options.pastBeats ?? 0,
          showBeatGrid: live.options.showBeatGrid,
          showLabels: live.options.showLabels,
          partsVisible: live.options.partsVisible,
          learnerTrace: trace,
          spelling: live.options.spelling ?? "sharp",
          colors
        });
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", resize);
      }
      themeObserver?.disconnect();
    };
  }, [reducedMotion]);

  // Static step view: React updates once per step change only.
  const step = useCurrentStep(timeline, getSnapshot, reducedMotion);
  const staticCount = options.staticStepCount ?? 4;
  const staticParts = useMemo<Set<PartId>>(() => {
    if (options.partsVisible.has("learner")) {
      return new Set<PartId>(["learner"]);
    }
    return options.partsVisible;
  }, [options.partsVisible]);
  const staticSteps = useMemo(() => {
    if (!reducedMotion) {
      return [];
    }
    const steps = toStaticSteps(stepsFrom(timeline, step.index, staticCount, staticParts), timeline?.timeSignature, options.spelling ?? "sharp");
    if (steps.length > 0) {
      steps[0] = { ...steps[0], sounding: step.sounding };
    }
    return steps;
  }, [reducedMotion, timeline, step.index, step.sounding, staticCount, staticParts, options.spelling]);

  const style = height !== undefined ? { height } : undefined;

  if (reducedMotion) {
    return (
      <div className={clsx("pls-stage", "pls-stage--static", className)} style={style}>
        <StaticStepView
          steps={staticSteps}
          title="Current and upcoming steps"
          showDegrees={options.showLabels !== "none"}
          emptyMessage={timeline ? "The end of the material — press play or stop to start again." : "No material loaded yet."}
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={clsx("pls-stage", className)} style={style}>
      <canvas ref={canvasRef} className="pls-stage__canvas" role="img" aria-label={ariaLabel}>
        Falling-note view. Use the static step view for a text list of the notes.
      </canvas>
      {!timeline ? <p className="pls-stage__empty">No material loaded — choose a chord, lesson, or song to see falling notes.</p> : null}
    </div>
  );
}
