/**
 * Canvas 2D renderer for the falling-note stage. No React, no timers: `drawStage` is called
 * by the component's requestAnimationFrame loop with the latest transport snapshot.
 */
import type { PartId, PerformanceTimeline, TransportSnapshot } from "@/model/contracts";
import type { KeyLayout } from "@/ui/piano/geometry";
import { midiToNoteName, prettyDegree, spelledToName } from "@/ui/piano/pianoLabels";
import type { SpellingPreference } from "@/ui/piano/pianoLabels";
import type { StageNote, StageRect } from "@/ui/stage/stageMath";
import { beatsPerBar, gridLines, noteScreenRect, pixelsPerBeatFor, stageNotes } from "@/ui/stage/stageMath";

export type StageLabelMode = "none" | "names" | "degrees" | "hands";
export type TraceVerdict = "onTime" | "early" | "late" | "missed" | "wrong" | "extra";

export interface LearnerTraceNote {
  midi: number;
  onsetBeat: number;
  durationBeats: number;
  verdict?: TraceVerdict;
}

export interface StageColors {
  background: string;
  laneBlack: string;
  laneDivider: string;
  laneOctave: string;
  gridBeat: string;
  gridBar: string;
  gridText: string;
  strike: string;
  learner: string;
  learnerLeft: string;
  learnerRight: string;
  learnerStroke: string;
  accompaniment: string;
  demonstration: string;
  noteText: string;
  traceGood: string;
  traceWarn: string;
  traceBad: string;
}

export const FALLBACK_STAGE_COLORS: StageColors = {
  background: "#0f1726",
  laneBlack: "rgba(255,255,255,0.045)",
  laneDivider: "rgba(255,255,255,0.07)",
  laneOctave: "rgba(255,255,255,0.18)",
  gridBeat: "rgba(255,255,255,0.08)",
  gridBar: "rgba(255,255,255,0.28)",
  gridText: "rgba(255,255,255,0.55)",
  strike: "#ffb347",
  learner: "#3b9bff",
  learnerLeft: "#2fbf8f",
  learnerRight: "#3b9bff",
  learnerStroke: "rgba(0,0,0,0.45)",
  accompaniment: "#b39ddb",
  demonstration: "#ffd166",
  noteText: "#0b1220",
  traceGood: "#52d89f",
  traceWarn: "#ffb347",
  traceBad: "#ff6d87"
};

const COLOR_VARS: Record<keyof StageColors, string> = {
  background: "--pls-stage-bg",
  laneBlack: "--pls-stage-lane-black",
  laneDivider: "--pls-stage-lane-divider",
  laneOctave: "--pls-stage-lane-octave",
  gridBeat: "--pls-stage-grid-beat",
  gridBar: "--pls-stage-grid-bar",
  gridText: "--pls-stage-grid-text",
  strike: "--pls-stage-strike",
  learner: "--pls-note-learner",
  learnerLeft: "--pls-note-left",
  learnerRight: "--pls-note-right",
  learnerStroke: "--pls-note-stroke",
  accompaniment: "--pls-note-accomp",
  demonstration: "--pls-note-demo",
  noteText: "--pls-note-text",
  traceGood: "--pls-trace-good",
  traceWarn: "--pls-trace-warn",
  traceBad: "--pls-trace-bad"
};

/** Read stage colours from CSS custom properties on an element (call on mount/theme change only). */
export function readStageColors(element: Element): StageColors {
  const style = window.getComputedStyle(element);
  const colors: StageColors = { ...FALLBACK_STAGE_COLORS };
  (Object.keys(COLOR_VARS) as (keyof StageColors)[]).forEach((key) => {
    const value = style.getPropertyValue(COLOR_VARS[key]).trim();
    if (value) {
      colors[key] = value;
    }
  });
  return colors;
}

export interface DrawStageParams {
  ctx: CanvasRenderingContext2D;
  /** CSS px size of the canvas. */
  width: number;
  height: number;
  dpr: number;
  timeline: PerformanceTimeline | null;
  snapshot: TransportSnapshot;
  layout: KeyLayout;
  lookaheadBeats: number;
  pastBeats: number;
  showBeatGrid: boolean;
  showLabels: StageLabelMode;
  partsVisible: ReadonlySet<PartId>;
  learnerTrace: readonly LearnerTraceNote[] | undefined;
  spelling: SpellingPreference;
  colors: StageColors;
}

function labelFor(item: StageNote, mode: StageLabelMode, spelling: SpellingPreference): string | null {
  const note = item.note;
  if (mode === "names") {
    return note.spelled ? spelledToName(note.spelled) : midiToNoteName(note.midi, { preference: spelling });
  }
  if (mode === "degrees") {
    return note.degree ? prettyDegree(note.degree) : null;
  }
  if (mode === "hands") {
    if (note.hand === "left") {
      return "L";
    }
    if (note.hand === "right") {
      return "R";
    }
    return null;
  }
  return null;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawNote(ctx: CanvasRenderingContext2D, item: StageNote, rect: StageRect, active: boolean, params: DrawStageParams): void {
  const { colors } = params;
  const part = item.note.part;
  const h = Math.max(2, rect.height);
  const y = rect.y + rect.height - h;
  roundRectPath(ctx, rect.x, y, rect.width, h, 3);
  if (part === "learner") {
    const fill = item.note.hand === "left" ? colors.learnerLeft : item.note.hand === "right" ? colors.learnerRight : colors.learner;
    ctx.globalAlpha = active ? 1 : 0.92;
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeStyle = colors.learnerStroke;
    ctx.setLineDash([]);
    ctx.stroke();
  } else if (part === "demonstration") {
    // Dashed outline + translucent fill: "shown to you", not "yours to play".
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = colors.demonstration;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = colors.demonstration;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // Accompaniment: hollow outline with a faint fill.
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = colors.accompaniment;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([]);
    ctx.strokeStyle = colors.accompaniment;
    ctx.stroke();
  }

  const label = labelFor(item, params.showLabels, params.spelling);
  if (label && rect.width >= 9 && h >= 14) {
    const fontSize = Math.max(8, Math.min(12, rect.width * 0.55));
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = part === "learner" ? colors.noteText : part === "demonstration" ? colors.demonstration : colors.accompaniment;
    ctx.fillText(label, rect.x + rect.width / 2, Math.min(params.height - 3, rect.y + rect.height - 3));
  }
}

function traceColor(verdict: TraceVerdict | undefined, colors: StageColors): string {
  if (verdict === "onTime" || verdict === undefined) {
    return colors.traceGood;
  }
  if (verdict === "early" || verdict === "late") {
    return colors.traceWarn;
  }
  return colors.traceBad;
}

function traceGlyph(verdict: TraceVerdict | undefined): string | null {
  switch (verdict) {
    case "early":
      return "‹";
    case "late":
      return "›";
    case "wrong":
    case "extra":
      return "×";
    case "missed":
      return "○";
    default:
      return null;
  }
}

/** Draw one frame. Pure function of its parameters. */
export function drawStage(params: DrawStageParams): void {
  const { ctx, width, height, dpr, layout, snapshot, colors } = params;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  if (width <= 0 || height <= 0 || layout.width <= 0) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const scaleX = width / layout.width;
  const strikeY = height;
  const ppb = pixelsPerBeatFor(height, params.lookaheadBeats, strikeY);

  // Lanes: black-key strips and white-key dividers keep the eye on the keyboard columns.
  ctx.fillStyle = colors.laneBlack;
  for (const key of layout.blackKeys) {
    ctx.fillRect(key.x * scaleX, 0, key.width * scaleX, height);
  }
  for (const key of layout.whiteKeys) {
    const isC = key.midi % 12 === 0;
    const isF = key.midi % 12 === 5;
    if (!isC && !isF) {
      continue;
    }
    ctx.fillStyle = isC ? colors.laneOctave : colors.laneDivider;
    ctx.fillRect(Math.round(key.x * scaleX), 0, 1, height);
  }

  if (params.showBeatGrid && ppb > 0) {
    const lines = gridLines(snapshot.positionBeats, params.lookaheadBeats, 0, beatsPerBar(params.timeline?.timeSignature), ppb, strikeY);
    ctx.font = "600 10px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    for (const line of lines) {
      const y = Math.round(line.y) + 0.5;
      ctx.strokeStyle = line.kind === "bar" ? colors.gridBar : colors.gridBeat;
      ctx.lineWidth = line.kind === "bar" ? 1 : 1;
      ctx.setLineDash(line.kind === "bar" ? [] : [2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      if (line.kind === "bar" && line.bar >= 1 && y > 12) {
        ctx.fillStyle = colors.gridText;
        ctx.fillText(String(line.bar), 4, y - 2);
      }
    }
    ctx.setLineDash([]);
  }

  if (ppb > 0) {
    const items = stageNotes(params.timeline, snapshot, params.lookaheadBeats, params.pastBeats).filter(
      (item) => item.note.part !== "metronome" && params.partsVisible.has(item.note.part)
    );
    const whites: { item: StageNote; rect: StageRect }[] = [];
    const blacks: { item: StageNote; rect: StageRect }[] = [];
    for (const item of items) {
      const rect = noteScreenRect(
        { midi: item.midi, onsetBeat: item.onsetBeat, durationBeats: item.durationBeats },
        snapshot,
        layout,
        ppb,
        height,
        { strikeY, scaleX, insetPx: 1.5 }
      );
      if (!rect || rect.y > height || rect.y + rect.height < 0) {
        continue;
      }
      (rect.black ? blacks : whites).push({ item, rect });
    }
    // Accompaniment/demonstration below learner notes, black lanes above white lanes.
    const order = (a: { item: StageNote }, b: { item: StageNote }): number => partRank(a.item.note.part) - partRank(b.item.note.part);
    whites.sort(order);
    blacks.sort(order);
    for (const group of [whites, blacks]) {
      for (const { item, rect } of group) {
        const active = snapshot.positionBeats >= item.onsetBeat && snapshot.positionBeats < item.onsetBeat + item.durationBeats;
        drawNote(ctx, item, rect, active, params);
      }
    }

    const trace = params.learnerTrace ?? [];
    for (const played of trace) {
      const rect = noteScreenRect(played, snapshot, layout, ppb, height, { strikeY, scaleX });
      if (!rect || rect.y > height || rect.y + rect.height < 0) {
        continue;
      }
      const w = Math.max(3, rect.width * 0.4);
      const x = rect.x + (rect.width - w) / 2;
      const h = Math.max(3, rect.height);
      ctx.fillStyle = traceColor(played.verdict, colors);
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, rect.y + rect.height - h, w, h);
      ctx.globalAlpha = 1;
      const glyph = traceGlyph(played.verdict);
      if (glyph && rect.width >= 10) {
        ctx.font = "700 11px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(glyph, rect.x + rect.width / 2, Math.max(12, rect.y + rect.height - h - 1));
      }
    }
  }

  // Strike line: notes touch it exactly at their onset.
  ctx.fillStyle = colors.strike;
  ctx.fillRect(0, strikeY - 3, width, 3);
  ctx.restore();
}

function partRank(part: PartId): number {
  switch (part) {
    case "accompaniment":
      return 0;
    case "demonstration":
      return 1;
    case "learner":
      return 2;
    default:
      return 3;
  }
}
