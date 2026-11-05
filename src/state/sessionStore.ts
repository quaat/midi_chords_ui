/**
 * App-wide UI session state (framework-free). Per-frame transport position does NOT live
 * here — renderers read the transport snapshot directly.
 */
import type { MidiRange } from "@/ui/piano/geometry";
import { clampRangeToWhiteKeys, PIANO_HIGH, PIANO_LOW, rangesEqual, shiftRangeByOctaves } from "@/ui/piano/geometry";
import type { LabelMode } from "@/ui/piano/pianoLabels";

export type WorkspaceMode = "explore" | "practice" | "create";
export type EntryView = "workspace" | "learn" | "songs" | "myPractice";
export type ThemeName = "light" | "dark";
export type PracticeView = "fallingNotes" | "static" | "notation" | "chart";
export type InputSourceSelection = "midi" | "computerKeyboard" | "touch" | "none";

export const MAX_HINT_LEVEL = 3;

export interface SessionState {
  mode: WorkspaceMode;
  entryView: EntryView;
  pianoRange: MidiRange;
  /** True once the learner chose a range; automatic width-based ranges stop overriding it. */
  pianoRangeLocked: boolean;
  labelMode: LabelMode;
  theme: ThemeName;
  focusMode: boolean;
  reducedMotion: boolean;
  practiceView: PracticeView;
  inputSource: InputSourceSelection;
  /** 0 = no hints shown yet .. MAX_HINT_LEVEL = most specific hint. */
  hintLevel: number;
  contextPanelOpen: boolean;
  /** Selected musical material shared by every mode. */
  materialId: string | null;
  sequenceVersion: number;
}

export const DEFAULT_SESSION_STATE: SessionState = {
  mode: "explore",
  entryView: "workspace",
  pianoRange: { low: 48, high: 84 },
  pianoRangeLocked: false,
  labelMode: "noteNames",
  theme: "light",
  focusMode: false,
  reducedMotion: false,
  practiceView: "fallingNotes",
  inputSource: "touch",
  hintLevel: 0,
  contextPanelOpen: true,
  materialId: null,
  sequenceVersion: 0
};

export type SessionAction =
  | { type: "setMode"; mode: WorkspaceMode }
  | { type: "setEntryView"; view: EntryView }
  /** `user: false` marks an automatic (responsive) range that a later resize may replace. */
  | { type: "setPianoRange"; range: MidiRange; user?: boolean }
  | { type: "shiftPianoRange"; octaves: number }
  | { type: "setLabelMode"; labelMode: LabelMode }
  | { type: "setTheme"; theme: ThemeName }
  | { type: "toggleTheme" }
  | { type: "setFocusMode"; focusMode: boolean }
  | { type: "toggleFocusMode" }
  | { type: "setReducedMotion"; reducedMotion: boolean }
  | { type: "setPracticeView"; view: PracticeView }
  | { type: "setInputSource"; source: InputSourceSelection }
  | { type: "setHintLevel"; level: number }
  | { type: "nextHint" }
  | { type: "resetHints" }
  | { type: "setContextPanelOpen"; open: boolean }
  | { type: "toggleContextPanel" }
  /** Open material into the workspace (from Learn/Songs/My Practice); resets hints. */
  | { type: "openMaterial"; materialId: string | null; sequenceVersion?: number; mode?: WorkspaceMode }
  | { type: "setSequenceVersion"; version: number };

function clampHint(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.max(0, Math.min(MAX_HINT_LEVEL, Math.round(level)));
}

function normaliseRange(range: MidiRange): MidiRange {
  const clamped = clampRangeToWhiteKeys(Math.max(PIANO_LOW, range.low), Math.min(PIANO_HIGH, range.high));
  return clamped;
}

/** Returns a shallow-updated state, or the SAME object when nothing changed. */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  const patch = actionPatch(state, action);
  return applyPatch(state, patch);
}

function actionPatch(state: SessionState, action: SessionAction): Partial<SessionState> {
  switch (action.type) {
    case "setMode":
      return { mode: action.mode, entryView: "workspace" };
    case "setEntryView":
      return { entryView: action.view };
    case "setPianoRange": {
      const user = action.user !== false;
      if (!user && state.pianoRangeLocked) {
        return {};
      }
      const range = normaliseRange(action.range);
      return {
        pianoRange: rangesEqual(range, state.pianoRange) ? state.pianoRange : range,
        pianoRangeLocked: state.pianoRangeLocked || user
      };
    }
    case "shiftPianoRange": {
      const range = shiftRangeByOctaves(state.pianoRange, action.octaves);
      return { pianoRange: rangesEqual(range, state.pianoRange) ? state.pianoRange : range, pianoRangeLocked: true };
    }
    case "setLabelMode":
      return { labelMode: action.labelMode };
    case "setTheme":
      return { theme: action.theme };
    case "toggleTheme":
      return { theme: state.theme === "dark" ? "light" : "dark" };
    case "setFocusMode":
      return { focusMode: action.focusMode };
    case "toggleFocusMode":
      return { focusMode: !state.focusMode };
    case "setReducedMotion":
      return { reducedMotion: action.reducedMotion };
    case "setPracticeView":
      return { practiceView: action.view };
    case "setInputSource":
      return { inputSource: action.source };
    case "setHintLevel":
      return { hintLevel: clampHint(action.level) };
    case "nextHint":
      return { hintLevel: clampHint(state.hintLevel + 1) };
    case "resetHints":
      return { hintLevel: 0 };
    case "setContextPanelOpen":
      return { contextPanelOpen: action.open };
    case "toggleContextPanel":
      return { contextPanelOpen: !state.contextPanelOpen };
    case "openMaterial":
      return {
        materialId: action.materialId,
        sequenceVersion: typeof action.sequenceVersion === "number" ? action.sequenceVersion : state.sequenceVersion,
        mode: action.mode ?? state.mode,
        entryView: "workspace",
        hintLevel: 0
      };
    case "setSequenceVersion":
      return { sequenceVersion: action.version };
    default:
      return {};
  }
}

/** Shallow merge that preserves identity when every value is unchanged (Object.is). */
export function applyPatch<S extends object>(state: S, patch: Partial<S>): S {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof S)[]) {
    if (!Object.is(state[key], patch[key])) {
      changed = true;
      break;
    }
  }
  return changed ? { ...state, ...patch } : state;
}

export type Listener = () => void;

export interface Store<S> {
  getState: () => S;
  /** Shallow update; listeners run only when a value actually changed. */
  setState: (update: Partial<S> | ((state: S) => Partial<S>)) => void;
  subscribe: (listener: Listener) => () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => state,
    setState: (update) => {
      const patch: Partial<S> = typeof update === "function" ? (update as (s: S) => Partial<S>)(state) : (update as Partial<S>);
      const next = applyPatch(state, patch);
      if (next === state) {
        return;
      }
      state = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

export interface SessionStore extends Store<SessionState> {
  dispatch: (action: SessionAction) => void;
}

export function createSessionStore(initial: Partial<SessionState> = {}): SessionStore {
  const store = createStore<SessionState>({ ...DEFAULT_SESSION_STATE, ...initial });
  return {
    ...store,
    dispatch: (action) => {
      const current = store.getState();
      const next = sessionReducer(current, action);
      if (next !== current) {
        store.setState(next);
      }
    }
  };
}
