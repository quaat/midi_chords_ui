"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import clsx from "clsx";
import type { ChordRole, Hand } from "@/model/contracts";
import type { KeyRect, MidiRange } from "@/ui/piano/geometry";
import { createKeyLayout, DEFAULT_BLACK_HEIGHT_RATIO, KeyLayout, midiToPitchName, MIDDLE_C } from "@/ui/piano/geometry";
import type { LabelMode } from "@/ui/piano/pianoLabels";
import { RangeControls } from "@/ui/piano/RangeControls";
import { useElementSize } from "@/ui/piano/useElementSize";

/** Where an on-screen note came from: pointer/touch on the keys, or Enter/Space on the focused key. */
export type PianoInputSource = "touch" | "computerKeyboard";

export interface PianoTarget {
  midi: number;
  hand?: Hand;
  role?: ChordRole;
}

export interface PianoHeights {
  /** White key height in CSS px (default 150). */
  white?: number;
  /** Black key height in CSS px (default 62% of white). */
  black?: number;
}

export interface InteractivePianoProps {
  range: MidiRange;
  /** When provided, range controls are shown and call this. */
  onRangeChange?: (range: MidiRange) => void;
  /**
   * Shared layout (e.g. the same one the falling-note stage uses). When omitted the piano
   * measures its own width and builds a layout from `range` + `heights`.
   */
  layout?: KeyLayout;
  labelMode?: LabelMode;
  /** Caller-computed labels keyed by MIDI; hidden when labelMode is "none". */
  labels?: Map<number, string>;
  targets?: PianoTarget[];
  learnerPressed?: number[];
  learnerSustained?: number[];
  demonstration?: number[];
  accompaniment?: number[];
  onNoteOn?: (midi: number, velocity: number, source: PianoInputSource) => void;
  onNoteOff?: (midi: number, source: PianoInputSource) => void;
  /** Called after every held on-screen note was released (blur, Escape, unmount). */
  onReleaseAll?: () => void;
  heights?: PianoHeights;
  /** Show small "C3" markers on C keys that have no other label (default true). */
  showOctaveLabels?: boolean;
  /** Notes used by the range controls' "Fit to notes" button. */
  fitNotes?: number[];
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

const DEFAULT_WHITE_HEIGHT = 150;

function velocityForPoint(rect: KeyRect | null, y: number): number {
  if (!rect || rect.height <= 0) {
    return 80;
  }
  const fraction = Math.max(0, Math.min(1, (y - rect.y) / rect.height));
  // Nearer the front edge of the key = louder, like striking further from the fallboard.
  return Math.max(1, Math.min(127, Math.round(30 + fraction * 97)));
}

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

interface KeyVisualState {
  target: PianoTarget | null;
  pressed: boolean;
  sustained: boolean;
  demo: boolean;
  accomp: boolean;
}

export function InteractivePiano({
  range,
  onRangeChange,
  layout: sharedLayout,
  labelMode = "noteNames",
  labels,
  targets,
  learnerPressed,
  learnerSustained,
  demonstration,
  accompaniment,
  onNoteOn,
  onNoteOff,
  onReleaseAll,
  heights,
  showOctaveLabels = true,
  fitNotes,
  disabled = false,
  ariaLabel,
  className
}: InteractivePianoProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const measured = useElementSize(keysRef);
  const rawId = useId();
  const uid = useMemo(() => `pls-piano-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`, [rawId]);

  const whiteHeight = heights?.white ?? DEFAULT_WHITE_HEIGHT;
  const blackRatio = heights?.black && whiteHeight > 0 ? heights.black / whiteHeight : DEFAULT_BLACK_HEIGHT_RATIO;

  const ownLayout = useMemo(
    () => createKeyLayout(range, measured.width, whiteHeight, { blackHeightRatio: blackRatio }),
    [range, measured.width, whiteHeight, blackRatio]
  );
  const layout = sharedLayout ?? ownLayout;

  // Latest callbacks / layout for event handlers without re-binding.
  const callbacksRef = useRef({ onNoteOn, onNoteOff, onReleaseAll });
  callbacksRef.current = { onNoteOn, onNoteOff, onReleaseAll };
  const layoutRef = useRef<KeyLayout>(layout);
  layoutRef.current = layout;

  /** Reference counts per MIDI note across pointers + keyboard. */
  const heldRef = useRef<Map<number, number>>(new Map());
  /** pointerId -> midi currently under that pointer (null when off the keys). */
  const pointersRef = useRef<Map<number, number | null>>(new Map());
  const keyboardHeldRef = useRef<number | null>(null);

  const [focusMidi, setFocusMidi] = useState<number>(MIDDLE_C);
  const [focusVisible, setFocusVisible] = useState(false);
  /** Set by pointerdown so the focus that follows a click does not show the keyboard cursor. */
  const pointerFocusRef = useRef(false);

  // Keep the focus cursor inside the visible range.
  useEffect(() => {
    if (focusMidi < layout.low || focusMidi > layout.high) {
      const middle = MIDDLE_C >= layout.low && MIDDLE_C <= layout.high ? MIDDLE_C : Math.round((layout.low + layout.high) / 2);
      setFocusMidi(middle);
    }
  }, [focusMidi, layout.low, layout.high]);

  const press = useCallback((midi: number, velocity: number, source: PianoInputSource): void => {
    const count = heldRef.current.get(midi) ?? 0;
    heldRef.current.set(midi, count + 1);
    if (count === 0) {
      callbacksRef.current.onNoteOn?.(midi, velocity, source);
    }
  }, []);

  const release = useCallback((midi: number, source: PianoInputSource): void => {
    const count = heldRef.current.get(midi) ?? 0;
    if (count <= 1) {
      if (count === 1) {
        heldRef.current.delete(midi);
        callbacksRef.current.onNoteOff?.(midi, source);
      }
      return;
    }
    heldRef.current.set(midi, count - 1);
  }, []);

  const releaseAll = useCallback((): void => {
    const held = Array.from(heldRef.current.keys());
    heldRef.current.clear();
    pointersRef.current.clear();
    keyboardHeldRef.current = null;
    for (const midi of held) {
      callbacksRef.current.onNoteOff?.(midi, "touch");
    }
    callbacksRef.current.onReleaseAll?.();
  }, []);

  // Release everything on unmount and when disabled.
  useEffect(() => () => releaseAll(), [releaseAll]);
  useEffect(() => {
    if (disabled) {
      releaseAll();
    }
  }, [disabled, releaseAll]);
  // A range change can move keys away from held pointers; release to avoid stuck notes.
  useEffect(() => {
    if (heldRef.current.size > 0) {
      releaseAll();
    }
  }, [layout.low, layout.high, releaseAll]);

  const pointToKey = (event: ReactPointerEvent<SVGSVGElement>): { midi: number | null; velocity: number } => {
    const svg = svgRef.current;
    const current = layoutRef.current;
    if (!svg || current.width <= 0) {
      return { midi: null, velocity: 0 };
    }
    const box = svg.getBoundingClientRect();
    const scaleX = box.width > 0 ? current.width / box.width : 1;
    const scaleY = box.height > 0 ? current.height / box.height : 1;
    const x = (event.clientX - box.left) * scaleX;
    const y = (event.clientY - box.top) * scaleY;
    const midi = current.midiAtPoint(x, y);
    return { midi, velocity: midi === null ? 0 : velocityForPoint(current.keyRect(midi), y) };
  };

  const endPointer = (pointerId: number): void => {
    if (!pointersRef.current.has(pointerId)) {
      return;
    }
    const midi = pointersRef.current.get(pointerId);
    pointersRef.current.delete(pointerId);
    if (typeof midi === "number") {
      release(midi, "touch");
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (disabled) {
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    setFocusVisible(false);
    pointerFocusRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is best-effort; pointerleave still ends the note.
    }
    endPointer(event.pointerId);
    const hit = pointToKey(event);
    pointersRef.current.set(event.pointerId, hit.midi);
    if (hit.midi !== null) {
      press(hit.midi, hit.velocity, "touch");
      setFocusMidi(hit.midi);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>): void => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    const previous = pointersRef.current.get(event.pointerId) ?? null;
    const hit = pointToKey(event);
    if (hit.midi === previous) {
      return;
    }
    // Glissando: release the old key before sounding the new one.
    if (previous !== null) {
      release(previous, "touch");
    }
    pointersRef.current.set(event.pointerId, hit.midi);
    if (hit.midi !== null) {
      press(hit.midi, hit.velocity, "touch");
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<SVGSVGElement>): void => {
    endPointer(event.pointerId);
  };

  const handleLostCapture = (event: ReactPointerEvent<SVGSVGElement>): void => {
    // Touch pointers are implicitly captured by the inner key shape; moving that capture to
    // the <svg> fires a bubbling lostpointercapture from the child, which must not end the note.
    if (event.target !== event.currentTarget) {
      return;
    }
    endPointer(event.pointerId);
  };

  const releaseKeyboardNote = (): void => {
    const held = keyboardHeldRef.current;
    if (held !== null) {
      keyboardHeldRef.current = null;
      release(held, "computerKeyboard");
    }
  };

  const moveFocus = (next: number): void => {
    const clamped = Math.max(layout.low, Math.min(layout.high, next));
    releaseKeyboardNote();
    setFocusMidi(clamped);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return; // range-control buttons handle their own keys
    }
    if (disabled) {
      return;
    }
    const step = event.shiftKey ? 12 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setFocusVisible(true);
      moveFocus(focusMidi - step);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setFocusVisible(true);
      moveFocus(focusMidi + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusVisible(true);
      moveFocus(layout.low);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocusVisible(true);
      moveFocus(layout.high);
    } else if (isActivationKey(event.key)) {
      event.preventDefault();
      setFocusVisible(true);
      if (event.repeat || keyboardHeldRef.current !== null) {
        return;
      }
      keyboardHeldRef.current = focusMidi;
      press(focusMidi, 96, "computerKeyboard");
    } else if (event.key === "Escape") {
      releaseAll();
    }
  };

  const handleKeyUp = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (isActivationKey(event.key)) {
      event.preventDefault();
      releaseKeyboardNote();
    }
  };

  const handleFocus = (): void => {
    // Keyboard (Tab) focus shows the cursor immediately; pointer focus does not.
    if (!pointerFocusRef.current) {
      setFocusVisible(true);
    }
    pointerFocusRef.current = false;
  };

  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>): void => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) {
      return;
    }
    setFocusVisible(false);
    pointerFocusRef.current = false;
    releaseAll();
  };

  const states = useMemo(() => {
    const map = new Map<number, KeyVisualState>();
    const get = (midi: number): KeyVisualState => {
      let s = map.get(midi);
      if (!s) {
        s = { target: null, pressed: false, sustained: false, demo: false, accomp: false };
        map.set(midi, s);
      }
      return s;
    };
    for (const t of targets ?? []) {
      get(t.midi).target = t;
    }
    for (const m of learnerPressed ?? []) {
      get(m).pressed = true;
    }
    for (const m of learnerSustained ?? []) {
      get(m).sustained = true;
    }
    for (const m of demonstration ?? []) {
      get(m).demo = true;
    }
    for (const m of accompaniment ?? []) {
      get(m).accomp = true;
    }
    return map;
  }, [targets, learnerPressed, learnerSustained, demonstration, accompaniment]);

  const hasTargets = (targets?.length ?? 0) > 0;
  const showLabels = labelMode !== "none" && labels !== undefined;
  const hatchId = `${uid}-hatch`;
  const keyId = (midi: number): string => `${uid}-key-${midi}`;

  const describeKey = (midi: number, s: KeyVisualState | undefined, label: string | undefined): string => {
    const parts: string[] = [midiToPitchName(midi)];
    if (label) {
      parts.push(label);
    }
    if (s?.target) {
      parts.push(s.target.hand && s.target.hand !== "either" && s.target.hand !== "both" ? `target, ${s.target.hand} hand` : "target");
    }
    if (s?.pressed) {
      parts.push("pressed");
    } else if (s?.sustained) {
      parts.push("sustained");
    }
    if (s?.demo) {
      parts.push("demonstration");
    }
    if (s?.accomp) {
      parts.push("accompaniment");
    }
    return parts.join(", ");
  };

  const renderKey = (rect: KeyRect): JSX.Element => {
    const s = states.get(rect.midi);
    const label = showLabels ? labels?.get(rect.midi) : undefined;
    const isFocus = focusVisible && focusMidi === rect.midi;
    const target = s?.target ?? null;
    const pressed = s?.pressed ?? false;
    const sustained = !pressed && (s?.sustained ?? false);
    const extra = pressed && hasTargets && !target;
    const w = rect.width;
    const h = rect.height;
    const cx = rect.x + w / 2;
    const unit = Math.max(2, Math.min(w * (rect.black ? 0.32 : 0.24), 9));
    const labelY = h - (rect.black ? 6 : 9);
    const targetY = h - (rect.black ? 10 : 14) - unit * 2.2;
    const demoY = targetY - unit * 2.6;
    const accompY = demoY - unit * 2.6;
    const hand = target?.hand;
    const octave = showOctaveLabels && !rect.black && !label && rect.midi % 12 === 0 ? midiToPitchName(rect.midi) : null;

    let marker: JSX.Element | null = null;
    if (target) {
      if (hand === "left") {
        marker = <rect className="pls-key__marker" x={cx - unit} y={targetY - unit} width={unit * 2} height={unit * 2} rx={1} />;
      } else if (hand === "right") {
        marker = <circle className="pls-key__marker" cx={cx} cy={targetY} r={unit} />;
      } else {
        marker = (
          <polygon
            className="pls-key__marker"
            points={`${cx},${targetY - unit * 1.2} ${cx + unit * 1.2},${targetY} ${cx},${targetY + unit * 1.2} ${cx - unit * 1.2},${targetY}`}
          />
        );
      }
    }

    return (
      <g
        key={rect.midi}
        id={keyId(rect.midi)}
        role="button"
        aria-pressed={pressed}
        aria-label={describeKey(rect.midi, s, label)}
        className={clsx("pls-key", rect.black ? "pls-key--black" : "pls-key--white", {
          "pls-key--target": target !== null,
          "pls-key--hand-left": hand === "left",
          "pls-key--hand-right": hand === "right",
          "pls-key--pressed": pressed,
          "pls-key--hit": pressed && target !== null,
          "pls-key--extra": extra,
          "pls-key--sustained": sustained,
          "pls-key--demo": s?.demo ?? false,
          "pls-key--accomp": s?.accomp ?? false,
          "pls-key--focus": isFocus
        })}
      >
        <rect className="pls-key__body" x={rect.x} y={rect.y} width={w} height={h} rx={rect.black ? 2 : 3} />
        {sustained ? <rect className="pls-key__hatch" x={rect.x} y={rect.y} width={w} height={h} fill={`url(#${hatchId})`} /> : null}
        {pressed ? <rect className="pls-key__press-bar" x={rect.x + 1} y={rect.y + h - 5} width={Math.max(0, w - 2)} height={4} /> : null}
        {target ? (
          <rect className="pls-key__target-outline" x={rect.x + 2} y={rect.y + 2} width={Math.max(0, w - 4)} height={Math.max(0, h - 4)} rx={2} />
        ) : null}
        {marker}
        {extra ? (
          <path
            className="pls-key__extra-mark"
            d={`M${cx - unit},${targetY - unit} L${cx + unit},${targetY + unit} M${cx + unit},${targetY - unit} L${cx - unit},${targetY + unit}`}
          />
        ) : null}
        {s?.demo ? <circle className="pls-key__demo-ring" cx={cx} cy={demoY} r={unit} /> : null}
        {s?.accomp ? (
          <polygon
            className="pls-key__accomp-mark"
            points={`${cx},${accompY - unit} ${cx + unit},${accompY + unit * 0.8} ${cx - unit},${accompY + unit * 0.8}`}
          />
        ) : null}
        {label ? (
          <text className="pls-key__label" x={cx} y={labelY} textAnchor="middle">
            {label}
          </text>
        ) : null}
        {octave ? (
          <text className="pls-key__octave" x={cx} y={labelY} textAnchor="middle">
            {octave}
          </text>
        ) : null}
        {isFocus ? (
          <rect className="pls-key__focus-ring" x={rect.x + 1} y={rect.y + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx={3} />
        ) : null}
      </g>
    );
  };

  const label =
    ariaLabel ??
    `Piano keyboard, ${midiToPitchName(layout.low)} to ${midiToPitchName(layout.high)}. Arrow keys choose a key, Enter or Space plays it, Shift with arrows moves an octave.`;

  return (
    <div className={clsx("pls-piano", disabled && "pls-piano--disabled", className)}>
      {onRangeChange ? <RangeControls range={{ low: layout.low, high: layout.high }} onRangeChange={onRangeChange} fitNotes={fitNotes} /> : null}
      <div
        ref={rootRef}
        className={clsx("pls-piano__surface", focusVisible && "pls-piano__surface--focus")}
        tabIndex={disabled ? -1 : 0}
        role="application"
        aria-roledescription="piano keyboard"
        aria-label={label}
        aria-activedescendant={focusVisible ? keyId(focusMidi) : undefined}
        aria-disabled={disabled || undefined}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <div ref={keysRef} className="pls-piano__keys" style={{ height: layout.height }}>
          {layout.width > 0 ? (
            <svg
              ref={svgRef}
              className="pls-piano__svg"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
              onPointerLeave={handlePointerEnd}
              onLostPointerCapture={handleLostCapture}
              onContextMenu={(event) => event.preventDefault()}
            >
              <defs>
                <pattern id={hatchId} patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
                  <line className="pls-key__hatch-line" x1={0} y1={0} x2={0} y2={6} />
                </pattern>
              </defs>
              {layout.whiteKeys.map(renderKey)}
              {layout.blackKeys.map(renderKey)}
            </svg>
          ) : null}
        </div>
      </div>
    </div>
  );
}
