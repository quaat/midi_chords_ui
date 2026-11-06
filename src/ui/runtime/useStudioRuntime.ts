"use client";

import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { ChordDefinition, HeldStateSnapshot } from "@/model/contracts";
import type { TransportStatus } from "@/playback/transport";
import type { Store } from "@/state/sessionStore";
import { useSessionStore } from "@/state/useSessionStore";
import type { CreateAction, CreateState } from "@/ui/create/createState";
import type { ExploreState } from "@/ui/explore/exploreLogic";
import type { KeyLayout } from "@/ui/piano/geometry";
import type { PianoTarget } from "@/ui/piano/InteractivePiano";
import type {
  DevicesState,
  ExploreTargetsState,
  MaterialState,
  PianoTargetsOverride,
  PlaybackOptions,
  PositionState,
  RecordingState,
  SoundingState,
  StudioRuntimeCore,
  UiState
} from "@/ui/runtime/runtimeCore";
import type { PracticeRequest } from "@/ui/runtime/practicePayload";
import { learnerNotesOf } from "@/ui/runtime/runtimeHelpers";
import { PianoLayoutContext, StudioRuntimeContext } from "@/ui/runtime/runtimeContext";

export function useStudioRuntime(): StudioRuntimeCore {
  const runtime = useContext(StudioRuntimeContext);
  if (!runtime) {
    throw new Error("useStudioRuntime must be used inside <StudioRuntimeProvider>.");
  }
  return runtime;
}

/** Subscribe to one of the runtime's tiny stores (whole state; stores only notify on change). */
export function useRuntimeStore<S>(store: Store<S>): S {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

export function useMaterial(): MaterialState {
  return useRuntimeStore(useStudioRuntime().materialStore);
}

/** Transport state (changes on play/pause/stop/seek/settings — never per frame). */
export function useTransportState(): TransportStatus {
  const transport = useStudioRuntime().transport;
  const subscribe = useCallback((listener: () => void) => transport.subscribe(() => listener()), [transport]);
  const get = useCallback(() => transport.getStateSnapshot(), [transport]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Learner held/sustained keys, updated at most once per animation frame. */
export function useHeldState(): HeldStateSnapshot {
  return useRuntimeStore(useStudioRuntime().heldStore);
}

export function useSounding(): SoundingState {
  return useRuntimeStore(useStudioRuntime().soundingStore);
}

/** Current/next occurrence of the loaded material (≤ 10 Hz while playing; re-renders per change). */
export function useCurrentOccurrence(): PositionState {
  return useRuntimeStore(useStudioRuntime().positionStore);
}

export function usePracticeRequest(): PracticeRequest | null {
  return useRuntimeStore(useStudioRuntime().practiceRequestStore).request;
}

export function usePlaybackOptions(): PlaybackOptions {
  return useRuntimeStore(useStudioRuntime().playbackStore);
}

/** Recorder state (status, take, counts); live elapsed time is read from `runtime.recorder.elapsedMs()`. */
export function useRecording(): RecordingState {
  return useRuntimeStore(useStudioRuntime().recordingStore);
}

export function useUiState(): UiState {
  return useRuntimeStore(useStudioRuntime().uiStore);
}

export function useExploreTargets(): ExploreTargetsState {
  return useRuntimeStore(useStudioRuntime().exploreTargetsStore);
}

export function useTargetsOverride(): PianoTargetsOverride | null {
  return useRuntimeStore(useStudioRuntime().targetsOverrideStore).override;
}

export function useEditor(): [CreateState, (action: CreateAction) => void] {
  const runtime = useStudioRuntime();
  const state = useRuntimeStore(runtime.editor);
  return [state, runtime.editor.dispatch];
}

export function useExploreState(): [ExploreState, (patch: Partial<ExploreState>) => void] {
  const runtime = useStudioRuntime();
  const state = useRuntimeStore(runtime.explore);
  const update = useCallback((patch: Partial<ExploreState>) => runtime.explore.setState(patch), [runtime]);
  return [state, update];
}

export interface DevicesApi extends DevicesState {
  requestAccess: () => void;
  selectInput: (id: string | null) => void;
  selectOutput: (id: string | null) => void;
  setMonitoring: (enabled: boolean) => void;
  panic: () => void;
  refresh: () => void;
}

export function useDevices(): DevicesApi {
  const runtime = useStudioRuntime();
  const state = useRuntimeStore(runtime.devicesStore);
  return useMemo(
    () => ({
      ...state,
      requestAccess: () => void runtime.requestMidiAccess(),
      selectInput: (id: string | null) => runtime.selectInput(id),
      selectOutput: (id: string | null) => runtime.selectOutput(id),
      setMonitoring: (enabled: boolean) => runtime.setMonitoring(enabled),
      panic: () => runtime.panic(),
      refresh: () => runtime.refreshDevices()
    }),
    [state, runtime]
  );
}

/** The KeyLayout shared by the piano and stages (null before the piano was measured). */
export function usePianoLayout(): KeyLayout | null {
  return useContext(PianoLayoutContext);
}

export interface TargetNote {
  midi: number;
  noteName?: string;
  degreeLabel?: string;
}

export interface PianoTargetLayer {
  targets: PianoTarget[];
  /** Per-note label information for the label modes (from the source that set the targets). */
  notes: TargetNote[];
  /** Explicit labels (override) — take precedence over computed ones. */
  labels: Map<number, string> | null;
  /** Chord used for "chord degree" labels of anything on the piano. */
  chord: ChordDefinition | null;
}

const EMPTY_TARGETS: PianoTargetLayer = { targets: [], notes: [], labels: null, chord: null };

/**
 * Piano target layer for the current mode:
 * 1. Practice: an explicit override (`runtime.setPianoTargetsOverride`, e.g. the current step);
 * 2. Explore: the chord/voicing/scale notes the Explore stage asked to show;
 * 3. Practice (no override): the learner notes of the current occurrence of the material;
 * 4. Create: none (blocks are edited; playback still lights the demonstration layer).
 */
export function usePianoTargets(): PianoTargetLayer {
  const runtime = useStudioRuntime();
  const mode = useSessionStore((s) => s.mode);
  const override = useTargetsOverride();
  const explore = useExploreTargets();
  const position = useCurrentOccurrence();
  const material = useMaterial();
  return useMemo<PianoTargetLayer>(() => {
    if (override && mode === "practice") {
      return { targets: override.targets, notes: override.targets.map((t) => ({ midi: t.midi })), labels: override.labels ?? null, chord: override.chord ?? null };
    }
    if (mode === "explore") {
      return {
        targets: explore.targets.map((t) => ({ midi: t.midi, role: t.role, hand: t.hand })),
        notes: explore.targets.map((t) => ({ midi: t.midi, noteName: t.noteName, degreeLabel: t.degreeLabel })),
        labels: null,
        chord: explore.chord
      };
    }
    if (mode === "practice") {
      const timeline = runtime.transport.getTimeline() ?? material.timeline;
      const notes = learnerNotesOf(timeline, position.current ? position.current.occurrenceId : null);
      return {
        targets: notes.map((n) => ({ midi: n.midi, hand: n.hand, role: n.role })),
        notes: notes.map((n) => ({ midi: n.midi, degreeLabel: n.degree })),
        labels: null,
        chord: position.current?.chord ?? null
      };
    }
    return { ...EMPTY_TARGETS, chord: position.current?.chord ?? null };
  }, [override, mode, explore, position, material, runtime]);
}
