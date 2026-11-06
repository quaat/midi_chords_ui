/**
 * Studio runtime core (framework-free). One instance per app, created by <StudioRuntimeProvider>.
 * See src/ui/runtime/README.md for the full API and the integration rules.
 *
 * Owns: the session store, the main + audition transports and their output engines, learner
 * input (shared HeldStateTracker fed by MIDI, computer keyboard and touch), persistence stores,
 * the Create editor document, Explore state, and a handful of tiny observable stores the React
 * hooks read with useSyncExternalStore. High-frequency data (transport position) is never put in
 * a store; renderers poll `getTransportSnapshot()`.
 *
 * SSR: the constructor has no side effects (no timers, no storage, no audio). `start()` (called
 * from an effect on the client) creates the real storage, applies preferences, attaches input and
 * loads the default material. `start()` returns a cleanup and may run twice (React StrictMode).
 */
import type {
  AccompanimentPatternId,
  ChordDefinition,
  HeldStateSnapshot,
  InputSource,
  MusicalSequence,
  PerformanceTimeline,
  PerformedNote,
  ProjectFile,
  TimeSignatureSpec
} from "@/model/contracts";
import { PROJECT_SCHEMA_VERSION } from "@/model/contracts";
import type { ArpeggiateOctaves } from "@/types";
import type { HeldChange, MidiAccessInfo, MidiPortInfo as InputPortInfo } from "@/input";
import { ComputerKeyboardInput, HeldStateTracker, MidiInputManager, TouchInput } from "@/input";
import type { OnboardingChoice, PersistenceStores, Preferences, RecordingSummary, Result } from "@/persistence";
import { DEFAULT_PREFERENCES, createMemoryAdapter, createStores, projectNeedsRecompile, withRecompiledSequence } from "@/persistence";
import type { LoopRegion, TransportStatus } from "@/playback/transport";
import { Transport } from "@/playback/transport";
import { ToneTimelineEngine, WebMidiTimelineEngine } from "@/playback/timelineEngines";
import { buildMidiFromTimeline } from "@/midi/timelineToMidi";
import type { PerformanceRecording, RecordedNote, RecorderStatus, RecordingTimelineResult } from "@/recording";
import {
  MAX_RECORDING_MS,
  PerformanceRecorder,
  buildClickTimeline,
  buildMidiFromRecording,
  countNoteOns,
  formatClock,
  isClickTimeline,
  msToBeats,
  pairRecordedNotes,
  recordingFileName,
  recordingTimeline
} from "@/recording";
import { sequenceFromParsedText } from "@/music/legacy";
import { SAMPLE_PROGRESSIONS } from "@/samples/progressions";
import type { EntryView, InputSourceSelection, SessionState, SessionStore, Store } from "@/state/sessionStore";
import { createSessionStore, createStore } from "@/state/sessionStore";
import type { CompileTimelineOptions } from "@/timeline/compile";
import { beatsPerBar } from "@/timeline/clock";
import { compileTimelineWithDiagnostics } from "@/timeline/compile";
import type { CreateAction, CreateState } from "@/ui/create/createState";
import { createInitialCreateState, createReducer } from "@/ui/create/createState";
import type { ExploreState, ExploreTarget } from "@/ui/explore/exploreLogic";
import { DEFAULT_EXPLORE_STATE } from "@/ui/explore/exploreLogic";
import type { PianoTarget } from "@/ui/piano/InteractivePiano";
import { midiToNoteName } from "@/ui/piano/pianoLabels";
import type { MidiPermissionState, MidiPortInfo } from "@/ui/workspace/DevicePanel";
import type { PracticePayload, PracticeRequest } from "@/ui/runtime/practicePayload";
import type { AuditionNote, CurrentNext } from "@/ui/runtime/runtimeHelpers";
import {
  asDemonstration,
  buildAuditionTimeline,
  chordAuditionNotes,
  describeAttack,
  findCurrentAndNext,
  inputSourceFromPreference,
  inputSourceToPreference,
  labelModeFromPreference,
  labelModeToPreference,
  reducedMotionFromPreference,
  sortOccurrences,
  themeFromPreference,
  uniqueSorted
} from "@/ui/runtime/runtimeHelpers";
import { voiceSequenceForPlayback } from "@/ui/runtime/voicingBridge";

// ---------------------------------------------------------------------------
// Public state shapes
// ---------------------------------------------------------------------------

export type EngineKind = "tone" | "webmidi";
export type MaterialSourceKind = "project" | "exercise" | "chart" | "scratch" | "recording";

export interface MaterialState {
  sequence: MusicalSequence | null;
  timeline: PerformanceTimeline | null;
  sourceKind: MaterialSourceKind;
  sourceId: string | null;
  /** Source version (sequence.version or timeline.sourceVersion). */
  version: number;
  title?: string;
  /** Non-blocking compile/voicing warnings. */
  warnings: string[];
  /** True while "Play it for me" runs the demonstration copy. */
  demonstrating: boolean;
}

export interface MaterialMeta {
  sourceKind: MaterialSourceKind;
  sourceId: string;
  title?: string;
  /** Authored sequence the timeline came from, when there is one. */
  sequence?: MusicalSequence | null;
  version?: number;
  warnings?: string[];
}

export interface LoadSequenceOptions {
  sourceKind?: MaterialSourceKind;
  sourceId?: string;
  title?: string;
  /** Extra compile options; arpeggiate/accompaniment default to the playback options. */
  compile?: CompileTimelineOptions;
}

export interface PlaybackOptions {
  arpeggiate: ArpeggiateOctaves;
  accompaniment: AccompanimentPatternId;
}

export interface DevicesState {
  permission: MidiPermissionState;
  permissionMessage: string;
  inputs: MidiPortInfo[];
  outputs: MidiPortInfo[];
  selectedInputId: string | null;
  /** null = built-in sound (Tone). */
  selectedOutputId: string | null;
  engineKind: EngineKind;
  /** "Hear what I play". */
  monitoring: boolean;
  statusMessage?: string;
  lastInput?: string;
  routingWarnings: string[];
}

export interface LearnerAttack {
  midi: number;
  velocity: number;
  timestampMs: number;
  source: InputSource;
}

export type AttackListener = (attack: LearnerAttack) => void;

export interface SoundingState {
  /** Learner + demonstration parts sounding from playback/audition (piano "demonstration" layer). */
  demonstration: number[];
  accompaniment: number[];
  notes: PerformedNote[];
}

export interface PositionState extends CurrentNext {
  timelineId: string | null;
}

export interface ExploreTargetsState {
  targets: ExploreTarget[];
  chord: ChordDefinition | null;
  caption: string;
}

/** Practice (or any owner) can take over the piano target layer. */
export interface PianoTargetsOverride {
  owner: string;
  targets: PianoTarget[];
  /** Optional label per MIDI note (shown unless the label mode is "none"). */
  labels?: Map<number, string>;
  chord?: ChordDefinition | null;
}

export interface UiState {
  onboardingVisible: boolean;
  onboardingChoice: OnboardingChoice | null;
  /** Shown when local storage is unavailable or a save failed. */
  storageMessage: string | null;
  storesReady: boolean;
  /** Bumped whenever the saved project list changes. */
  projectListVersion: number;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Recorder state for the Create recording panel (live counts come from the recorder; the take is explicit). */
export interface RecordingState {
  status: RecorderStatus;
  /** The finished take (in memory until saved/discarded). */
  take: PerformanceRecording | null;
  /** Notes derived from `take`. */
  notes: RecordedNote[];
  /** Attacks captured so far (live) or in the take. */
  noteCount: number;
  warnings: string[];
  message: string | null;
  /** Id under which `take` is saved; null when the take is unsaved. */
  savedId: string | null;
  /** True when `take` differs from its saved copy (or was never saved). */
  dirty: boolean;
  /** Round the playback/loop length to whole bars (see `fitLengthToBars`). */
  fitToBars: boolean;
  /** Count-in the current/last take was started with. */
  countInBeats: number;
  /** Bumped whenever the saved recording list changes. */
  listVersion: number;
}

export interface RecordingSettings {
  tempoBpm: number;
  timeSignature: TimeSignatureSpec;
  countInBeats: number;
  metronome: boolean;
}

interface RecordingClickSession {
  /** Timeline that was in the transport before the click track (restored afterwards). */
  original: PerformanceTimeline | null;
  loop: LoopRegion | null;
  /** True once the transport actually started the click track. */
  started: boolean;
}

export interface EditorStore extends Store<CreateState> {
  dispatch: (action: CreateAction) => void;
}

export const LAST_PROJECT_KEY = "pls:ui:last-project";
export const ONBOARDING_DISMISSED_KEY = "pls:ui:onboarding-dismissed";

const EDITOR_SYNC_DELAY_MS = 120;
const PREFERENCES_SAVE_DELAY_MS = 500;
const POSITION_POLL_MS = 100;
const AUDITION_CHANNEL = 4;
const MONITOR_CHANNEL = 1;

type FrameHandle = { kind: "raf"; id: number } | { kind: "timeout"; id: unknown };

function requestFrame(callback: () => void): FrameHandle {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return { kind: "raf", id: window.requestAnimationFrame(() => callback()) };
  }
  return { kind: "timeout", id: globalThis.setTimeout(callback, 16) };
}

function cancelFrame(handle: FrameHandle | null): void {
  if (!handle) {
    return;
  }
  if (handle.kind === "raf") {
    if (typeof window !== "undefined") {
      window.cancelAnimationFrame(handle.id);
    }
  } else {
    globalThis.clearTimeout(handle.id as ReturnType<typeof setTimeout>);
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function mediaMatches(query: string): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function toPanelPorts(ports: InputPortInfo[]): MidiPortInfo[] {
  return ports.map((port) => ({ id: port.id, name: port.label || port.name || port.id, manufacturer: port.manufacturer, connected: port.state === "connected" }));
}

function isActive(status: TransportStatus): boolean {
  return status.state === "playing" || status.state === "countingIn";
}

let idCounter = 0;
function freshId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function createEditorStore(initial: CreateState): EditorStore {
  const store = createStore<CreateState>(initial);
  return {
    ...store,
    dispatch: (action: CreateAction) => {
      const current = store.getState();
      const next = createReducer(current, action);
      if (next !== current) {
        store.setState(next);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

export class StudioRuntimeCore {
  readonly session: SessionStore;
  readonly transport: Transport;
  /** Second transport for A/B listening; never touches the main material. */
  readonly auditionTransport: Transport;
  stores: PersistenceStores;

  readonly editor: EditorStore;
  readonly explore: Store<ExploreState>;
  readonly materialStore: Store<MaterialState>;
  readonly devicesStore: Store<DevicesState>;
  readonly playbackStore: Store<PlaybackOptions>;
  readonly practiceRequestStore: Store<{ request: PracticeRequest | null }>;
  readonly exploreTargetsStore: Store<ExploreTargetsState>;
  readonly targetsOverrideStore: Store<{ override: PianoTargetsOverride | null }>;
  readonly soundingStore: Store<SoundingState>;
  readonly heldStore: Store<HeldStateSnapshot>;
  readonly positionStore: Store<PositionState>;
  readonly uiStore: Store<UiState>;
  readonly recordingStore: Store<RecordingState>;
  /** Framework-free performance recorder; fed by every learner input source while `start()`ed. */
  readonly recorder: PerformanceRecorder;

  readonly input: {
    held: HeldStateTracker;
    midi: MidiInputManager;
    computerKeyboard: ComputerKeyboardInput;
    touch: TouchInput;
    subscribeAttacks: (listener: AttackListener) => () => void;
  };
  readonly audition: {
    playChord: (midi: number[], durationBeats?: number) => void;
    playNotes: (notes: AuditionNote[]) => void;
    stop: () => void;
  };
  readonly navigate: {
    openInExplore: (symbol: string) => void;
    openInCreate: (material: MusicalSequence | string, name?: string) => void;
    openInPractice: (payload: PracticePayload) => void;
    openEntry: (view: EntryView) => void;
  };

  /** Stable reference for renderers (FallingNotesStage etc.): live transport position. */
  readonly getTransportSnapshot: () => TransportStatus;

  private readonly toneMain = new ToneTimelineEngine();
  private readonly toneAudition = new ToneTimelineEngine();
  private readonly toneMonitor = new ToneTimelineEngine();
  private readonly webMain = new WebMidiTimelineEngine(null);
  private readonly webAudition = new WebMidiTimelineEngine(null);
  private readonly webMonitor = new WebMidiTimelineEngine(null);
  private monitorPrepared = false;
  private readonly monitored = new Set<number>();

  private readonly attackListeners = new Set<AttackListener>();
  private readonly soundingNotes = new Map<string, PerformedNote>();
  private soundingFrame: FrameHandle | null = null;
  private heldFrame: FrameHandle | null = null;
  private positionFrame: FrameHandle | null = null;
  private lastPositionPoll = 0;
  private sortedCache: { id: string; list: ReturnType<typeof sortOccurrences> } | null = null;

  private demo: { original: PerformanceTimeline; started: boolean; loop: LoopRegion | null } | null = null;
  private started = false;
  private storesInitialised = false;
  private preferences: Preferences = { ...DEFAULT_PREFERENCES, pianoRange: { ...DEFAULT_PREFERENCES.pianoRange } };
  private detachKeyboard: (() => void) | null = null;
  private lastEditorSequence: MusicalSequence | null = null;
  private editorTimer: ReturnType<typeof setTimeout> | null = null;
  private prefsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInputSource: InputSourceSelection;
  private requestCounter = 0;
  private recordingClick: RecordingClickSession | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private takeCounter = 0;
  private takeTimelineCache: { take: PerformanceRecording; fitToBars: boolean; result: RecordingTimelineResult } | null = null;

  constructor() {
    this.session = createSessionStore();
    this.lastInputSource = this.session.getState().inputSource;
    const held = new HeldStateTracker();
    const midi = new MidiInputManager({ heldState: held });
    const computerKeyboard = new ComputerKeyboardInput();
    const touch = new TouchInput();
    this.input = {
      held,
      midi,
      computerKeyboard,
      touch,
      subscribeAttacks: (listener: AttackListener) => {
        this.attackListeners.add(listener);
        return () => {
          this.attackListeners.delete(listener);
        };
      }
    };

    this.transport = new Transport(this.toneMain);
    this.auditionTransport = new Transport(this.toneAudition, { countInBeats: 0, metronome: false, channelByPart: { demonstration: AUDITION_CHANNEL } });
    this.getTransportSnapshot = () => this.transport.getSnapshot();

    this.stores = createStores(createMemoryAdapter());

    const sample = SAMPLE_PROGRESSIONS[0];
    this.editor = createEditorStore(
      createInitialCreateState({ text: sample ? sample.text : "C | 1", sequenceId: `seq-${sample ? sample.id : "scratch"}`, name: sample ? sample.title : "Untitled progression" })
    );
    this.explore = createStore<ExploreState>({ ...DEFAULT_EXPLORE_STATE });
    this.materialStore = createStore<MaterialState>({ sequence: null, timeline: null, sourceKind: "scratch", sourceId: null, version: 0, warnings: [], demonstrating: false });
    const access = midi.getAccessInfo();
    this.devicesStore = createStore<DevicesState>({
      permission: access.state,
      permissionMessage: access.message,
      inputs: [],
      outputs: [],
      selectedInputId: null,
      selectedOutputId: null,
      engineKind: "tone",
      monitoring: this.session.getState().inputSource !== "midi",
      routingWarnings: []
    });
    this.playbackStore = createStore<PlaybackOptions>({ arpeggiate: 0, accompaniment: "none" });
    this.practiceRequestStore = createStore<{ request: PracticeRequest | null }>({ request: null });
    this.exploreTargetsStore = createStore<ExploreTargetsState>({ targets: [], chord: null, caption: "" });
    this.targetsOverrideStore = createStore<{ override: PianoTargetsOverride | null }>({ override: null });
    this.soundingStore = createStore<SoundingState>({ demonstration: [], accompaniment: [], notes: [] });
    this.heldStore = createStore<HeldStateSnapshot>({ pressed: [], sustained: [], sustainDown: false, sostenutoDown: false, softDown: false });
    this.positionStore = createStore<PositionState>({ index: -1, current: null, next: null, sounding: false, timelineId: null });
    this.uiStore = createStore<UiState>({ onboardingVisible: false, onboardingChoice: null, storageMessage: null, storesReady: false, projectListVersion: 0 });
    this.recorder = new PerformanceRecorder();
    this.recordingStore = createStore<RecordingState>({
      status: "idle",
      take: null,
      notes: [],
      noteCount: 0,
      warnings: [],
      message: null,
      savedId: null,
      dirty: false,
      fitToBars: false,
      countInBeats: 0,
      listVersion: 0
    });
    this.recorder.subscribe(() => this.syncRecorder());

    this.audition = {
      playChord: (notes: number[], durationBeats: number = 2) => this.playAudition(chordAuditionNotes(notes, durationBeats)),
      playNotes: (notes: AuditionNote[]) => this.playAudition(notes),
      stop: () => this.stopAudition()
    };
    this.navigate = {
      openInExplore: (symbol: string) => this.openInExplore(symbol),
      openInCreate: (material: MusicalSequence | string, name?: string) => this.openInCreate(material, name),
      openInPractice: (payload: PracticePayload) => this.openInPractice(payload),
      openEntry: (view: EntryView) => this.session.dispatch({ type: "setEntryView", view })
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Client-only startup. Returns a cleanup (safe to call start() again afterwards). */
  start(): () => void {
    this.started = true;
    if (!this.storesInitialised) {
      this.storesInitialised = true;
      this.initialiseStorage();
    }
    const cleanups: Array<() => void> = [];
    cleanups.push(this.transport.subscribe((status) => this.onTransportState(status)));
    cleanups.push(this.transport.onNoteOn((note) => this.onPlaybackNote("main", note, true)));
    cleanups.push(this.transport.onNoteOff((note) => this.onPlaybackNote("main", note, false)));
    cleanups.push(this.auditionTransport.onNoteOn((note) => this.onPlaybackNote("audition", note, true)));
    cleanups.push(this.auditionTransport.onNoteOff((note) => this.onPlaybackNote("audition", note, false)));
    cleanups.push(this.input.held.onChange((change) => this.onHeldChange(change)));
    cleanups.push(this.input.computerKeyboard.onEvent((event) => this.input.held.apply(event)));
    cleanups.push(this.input.touch.onEvent((event) => this.input.held.apply(event)));
    // Recorder: every learner source, never transport/audition output (playback is never recorded).
    cleanups.push(this.input.midi.onEvent((event) => this.recorder.handleEvent(event)));
    cleanups.push(this.input.computerKeyboard.onEvent((event) => this.recorder.handleEvent(event)));
    cleanups.push(this.input.touch.onEvent((event) => this.recorder.handleEvent(event)));
    cleanups.push(this.watchUnload());
    cleanups.push(this.input.midi.onDevicesChanged(() => this.refreshDevices()));
    cleanups.push(this.input.midi.onAccessChanged((info) => this.applyAccessInfo(info)));
    cleanups.push(this.session.subscribe(() => this.onSessionChange()));
    cleanups.push(this.editor.subscribe(() => this.onEditorChange()));
    cleanups.push(this.playbackStore.subscribe(() => this.onPlaybackOptionsChange()));
    cleanups.push(this.watchSystemPreferences());
    this.syncKeyboardAttachment();
    void this.input.midi.queryPermission().then((info) => this.applyAccessInfo(info));

    const material = this.materialStore.getState();
    if (!material.timeline || (material.sourceKind === "project" && material.sequence !== this.editor.getState().present.sequence)) {
      this.loadEditorSequence();
    } else {
      this.updatePosition();
    }

    return () => {
      if (this.recorder.isActive()) {
        this.stopRecording();
      }
      this.started = false;
      cleanups.forEach((cleanup) => cleanup());
      this.syncKeyboardAttachment();
      cancelFrame(this.soundingFrame);
      cancelFrame(this.heldFrame);
      cancelFrame(this.positionFrame);
      this.soundingFrame = null;
      this.heldFrame = null;
      this.positionFrame = null;
      if (this.editorTimer !== null) {
        clearTimeout(this.editorTimer);
        this.editorTimer = null;
      }
      if (this.prefsTimer !== null) {
        clearTimeout(this.prefsTimer);
        this.prefsTimer = null;
        this.persistPreferences();
      }
      this.transport.stop();
      this.auditionTransport.stop();
    };
  }

  private initialiseStorage(): void {
    this.stores = createStores();
    const status = this.stores.status;
    const prefs = this.stores.preferences.get();
    if (prefs.ok) {
      this.applyPreferences(prefs.value);
    }
    let dismissed = false;
    try {
      dismissed = this.stores.adapter.get(ONBOARDING_DISMISSED_KEY) === "1";
    } catch {
      dismissed = false;
    }
    this.uiStore.setState({
      storesReady: true,
      onboardingChoice: this.preferences.onboardingChoice ?? null,
      onboardingVisible: !dismissed,
      storageMessage: status.available ? null : status.reason ?? "Saving is not available in this browser; work is kept until the page is closed."
    });
    // Reopen the last saved project (if any) instead of the sample.
    try {
      const lastId = this.stores.adapter.get(LAST_PROJECT_KEY);
      if (lastId) {
        const found = this.stores.projects.get(lastId);
        if (found.ok && found.value) {
          this.openProject(found.value, { switchMode: false });
        }
      }
    } catch {
      // A damaged pointer just means the sample opens.
    }
  }

  // -------------------------------------------------------------------------
  // Material
  // -------------------------------------------------------------------------

  /** Compile (voicings → timeline) and load into the main transport. */
  loadSequence(sequence: MusicalSequence, options: LoadSequenceOptions = {}): PerformanceTimeline {
    const playback = this.playbackStore.getState();
    const voiced = voiceSequenceForPlayback(sequence);
    const compiled = compileTimelineWithDiagnostics(voiced.sequence, {
      arpeggiate: playback.arpeggiate,
      accompaniment: playback.accompaniment,
      ...(options.compile ?? {})
    });
    this.installTimeline(compiled.timeline, {
      sourceKind: options.sourceKind ?? "project",
      sourceId: options.sourceId ?? sequence.id,
      title: options.title ?? sequence.title,
      sequence,
      version: sequence.version,
      warnings: [...voiced.issues, ...compiled.warnings]
    });
    return compiled.timeline;
  }

  /** Load a timeline compiled elsewhere (exercises, charts). */
  loadTimeline(timeline: PerformanceTimeline, meta: MaterialMeta): void {
    this.installTimeline(timeline, meta);
  }

  private installTimeline(timeline: PerformanceTimeline, meta: MaterialMeta): void {
    const current = this.materialStore.getState();
    const sameSource = current.sourceId !== null && current.sourceId === meta.sourceId && current.sourceKind === meta.sourceKind;
    if (this.demo) {
      this.demo = null;
    }
    if (this.recordingClick) {
      // Other material takes the transport: the take keeps recording, just without the click track.
      this.recordingClick = null;
      this.scheduleRecorderTick();
    }
    const status = this.transport.getSnapshot();
    const wasActive = isActive(status);
    this.transport.load(timeline, { keepPosition: sameSource });
    const next: MaterialState = {
      sequence: meta.sequence ?? null,
      timeline,
      sourceKind: meta.sourceKind,
      sourceId: meta.sourceId,
      version: meta.version ?? timeline.sourceVersion,
      warnings: meta.warnings ?? [],
      demonstrating: false
    };
    if (meta.title !== undefined) {
      next.title = meta.title;
    }
    this.materialStore.setState(next);
    this.session.setState({ materialId: meta.sourceId, sequenceVersion: next.version });
    if (wasActive && sameSource) {
      this.resumeWithoutCountIn();
    }
    this.updatePosition();
  }

  private resumeWithoutCountIn(): void {
    const countIn = this.transport.getSnapshot().countInBeats;
    this.transport.setCountIn(0);
    void this.transport.play().finally(() => {
      this.transport.setCountIn(countIn > 0 ? countIn : null);
    });
  }

  /** (Re)load the Create editor's sequence as the material. */
  loadEditorSequence(): void {
    const state = this.editor.getState();
    this.lastEditorSequence = state.present.sequence;
    this.loadSequence(state.present.sequence, { sourceKind: "project", sourceId: state.present.sequence.id, title: state.project.name });
  }

  /** Make sure the editor document is what the transport plays (called when Create mounts). */
  ensureEditorMaterial(): void {
    const material = this.materialStore.getState();
    const sequence = this.editor.getState().present.sequence;
    if (material.demonstrating || material.sourceKind === "recording") {
      // A recorded take chosen as backing track stays loaded across mode switches (the Create notice offers the progression).
      return;
    }
    if (material.sourceKind !== "project" || material.sourceId !== sequence.id || material.sequence !== sequence) {
      this.loadEditorSequence();
    }
  }

  private onEditorChange(): void {
    const sequence = this.editor.getState().present.sequence;
    if (sequence === this.lastEditorSequence) {
      return;
    }
    this.lastEditorSequence = sequence;
    if (this.editorTimer !== null) {
      clearTimeout(this.editorTimer);
    }
    this.editorTimer = setTimeout(() => {
      this.editorTimer = null;
      this.loadEditorSequence();
    }, EDITOR_SYNC_DELAY_MS);
  }

  setPlaybackOptions(patch: Partial<PlaybackOptions>): void {
    this.playbackStore.setState(patch);
  }

  private onPlaybackOptionsChange(): void {
    if (this.materialStore.getState().sourceKind === "project") {
      this.loadEditorSequence();
    }
  }

  // -------------------------------------------------------------------------
  // Transport helpers
  // -------------------------------------------------------------------------

  togglePlay(): void {
    const status = this.transport.getSnapshot();
    if (isActive(status)) {
      this.transport.pause();
    } else {
      void this.transport.play();
    }
  }

  stop(): void {
    this.transport.stop();
  }

  /** "Play it for me": play the material once with the learner part as demonstration. Toggles. */
  async playForMe(): Promise<void> {
    if (this.demo) {
      this.stopDemonstration();
      return;
    }
    const material = this.materialStore.getState();
    if (!material.timeline) {
      return;
    }
    this.stopAudition();
    const loop = this.transport.getSnapshot().loop ?? null;
    if (loop) {
      this.transport.setLoop(null);
    }
    this.demo = { original: material.timeline, started: false, loop };
    this.transport.load(asDemonstration(material.timeline));
    this.materialStore.setState({ demonstrating: true });
    await this.transport.play(0);
  }

  stopDemonstration(): void {
    const demo = this.demo;
    if (!demo) {
      return;
    }
    if (demo.started) {
      this.transport.stop();
    } else {
      this.restoreFromDemonstration();
    }
  }

  private restoreFromDemonstration(): void {
    const demo = this.demo;
    if (!demo) {
      return;
    }
    this.demo = null;
    this.transport.load(demo.original);
    if (demo.loop) {
      this.transport.setLoop(demo.loop);
    }
    this.materialStore.setState({ demonstrating: false });
    this.updatePosition();
  }

  private onTransportState(status: TransportStatus): void {
    const click = this.recordingClick;
    if (click) {
      if (isActive(status)) {
        click.started = true;
        this.recorder.tick();
      } else if (click.started) {
        // Stop button, pause or the end of the click track: finish the take (deferred, outside the notification).
        void Promise.resolve().then(() => {
          if (this.recordingClick === click) {
            this.stopRecording();
          }
        });
      }
    }
    const demo = this.demo;
    if (demo) {
      if (isActive(status)) {
        demo.started = true;
      } else if (status.state === "stopped" && demo.started) {
        // Defer: do not reload the transport from inside its own notification.
        void Promise.resolve().then(() => {
          if (this.demo === demo) {
            this.restoreFromDemonstration();
          }
        });
      }
    }
    this.updatePosition();
    if (isActive(status)) {
      this.startPositionPoll();
    }
  }

  // -------------------------------------------------------------------------
  // Position (current / next) at ≤ 10 Hz
  // -------------------------------------------------------------------------

  private sortedFor(timeline: PerformanceTimeline): ReturnType<typeof sortOccurrences> {
    if (!this.sortedCache || this.sortedCache.id !== timeline.id) {
      this.sortedCache = { id: timeline.id, list: sortOccurrences(timeline) };
    }
    return this.sortedCache.list;
  }

  private updatePosition(): void {
    const timeline = this.transport.getTimeline();
    const snapshot = this.transport.getSnapshot();
    const found = timeline ? findCurrentAndNext(timeline, snapshot.positionBeats, this.sortedFor(timeline)) : findCurrentAndNext(null, 0);
    const prev = this.positionStore.getState();
    const timelineId = timeline ? timeline.id : null;
    if (prev.index !== found.index || prev.sounding !== found.sounding || prev.timelineId !== timelineId || prev.current !== found.current) {
      this.positionStore.setState({ ...found, timelineId });
    }
  }

  private startPositionPoll(): void {
    if (this.positionFrame) {
      return;
    }
    const tick = (): void => {
      this.positionFrame = null;
      if (!this.started) {
        return;
      }
      const now = nowMs();
      if (now - this.lastPositionPoll >= POSITION_POLL_MS) {
        this.lastPositionPoll = now;
        this.updatePosition();
      }
      if (isActive(this.transport.getSnapshot())) {
        this.positionFrame = requestFrame(tick);
      } else {
        this.updatePosition();
      }
    };
    this.positionFrame = requestFrame(tick);
  }

  // -------------------------------------------------------------------------
  // Sounding notes (piano demonstration/accompaniment layers)
  // -------------------------------------------------------------------------

  private onPlaybackNote(tag: string, note: PerformedNote, on: boolean): void {
    if (note.part === "metronome") {
      return;
    }
    const key = `${tag}:${note.id}`;
    if (on) {
      this.soundingNotes.set(key, note);
    } else {
      this.soundingNotes.delete(key);
    }
    if (!this.soundingFrame) {
      this.soundingFrame = requestFrame(() => {
        this.soundingFrame = null;
        const notes = Array.from(this.soundingNotes.values());
        this.soundingStore.setState({
          notes,
          demonstration: uniqueSorted(notes.filter((n) => n.part === "learner" || n.part === "demonstration").map((n) => n.midi)),
          accompaniment: uniqueSorted(notes.filter((n) => n.part === "accompaniment").map((n) => n.midi))
        });
      });
    }
  }

  // -------------------------------------------------------------------------
  // Audition
  // -------------------------------------------------------------------------

  private playAudition(notes: AuditionNote[]): void {
    if (notes.length === 0) {
      return;
    }
    this.auditionTransport.stop();
    const material = this.materialStore.getState();
    const bpm = material.timeline ? material.timeline.tempo.bpm : 90;
    this.auditionTransport.load(buildAuditionTimeline(notes, Math.max(60, Math.min(140, bpm)), freshId("audition")));
    void this.auditionTransport.play(0);
  }

  stopAudition(): void {
    this.auditionTransport.stop();
  }

  // -------------------------------------------------------------------------
  // Learner input
  // -------------------------------------------------------------------------

  touchNoteOn(midi: number, velocity: number): void {
    this.input.touch.press(midi, midi, velocity);
  }

  touchNoteOff(midi: number): void {
    this.input.touch.release(midi, midi);
  }

  touchReleaseAll(): void {
    this.input.touch.releaseAll();
  }

  private onHeldChange(change: HeldChange): void {
    if (!this.heldFrame) {
      this.heldFrame = requestFrame(() => {
        this.heldFrame = null;
        this.heldStore.setState(this.input.held.snapshot());
      });
    }
    switch (change.kind) {
      case "attack": {
        const attack: LearnerAttack = { midi: change.midi, velocity: change.velocity, timestampMs: change.timestampMs, source: change.source };
        this.attackListeners.forEach((listener) => {
          try {
            listener(attack);
          } catch {
            // A faulty listener must not break input.
          }
        });
        this.devicesStore.setState({ lastInput: describeAttack(midiToNoteName(change.midi, { withOctave: true }), change.velocity, change.source) });
        this.monitorOn(change.midi, change.velocity, change.source);
        break;
      }
      case "release":
        if (!change.stillSounding) {
          this.monitorOff(change.midi);
        }
        break;
      case "pedal":
        change.damped.forEach((midi) => this.monitorOff(midi));
        break;
      case "reset":
        this.monitored.clear();
        this.toneMonitor.allNotesOff();
        this.webMonitor.allNotesOff();
        break;
      default:
        break;
    }
  }

  private monitorOn(midi: number, velocity: number, source: InputSource): void {
    const devices = this.devicesStore.getState();
    if (!devices.monitoring) {
      return;
    }
    if (source === "midi" && devices.engineKind === "webmidi") {
      return; // MidiInputManager forwards (echo-suppressed) itself.
    }
    if (devices.engineKind === "tone") {
      if (!this.monitorPrepared) {
        this.monitorPrepared = true;
        void this.toneMonitor.prepare().catch(() => undefined);
      }
      this.toneMonitor.noteOn(midi, velocity, MONITOR_CHANNEL, nowMs());
    } else {
      this.webMonitor.noteOn(midi, velocity, MONITOR_CHANNEL, nowMs());
    }
    this.monitored.add(midi);
  }

  private monitorOff(midi: number): void {
    if (!this.monitored.has(midi)) {
      return;
    }
    this.monitored.delete(midi);
    this.toneMonitor.noteOff(midi, MONITOR_CHANNEL, nowMs());
    this.webMonitor.noteOff(midi, MONITOR_CHANNEL, nowMs());
  }

  private syncKeyboardAttachment(): void {
    const want = this.started && this.session.getState().inputSource === "computerKeyboard" && typeof window !== "undefined" && typeof document !== "undefined";
    if (want && !this.detachKeyboard) {
      this.detachKeyboard = this.input.computerKeyboard.attach(window, document);
    } else if (!want && this.detachKeyboard) {
      this.detachKeyboard();
      this.detachKeyboard = null;
      this.input.computerKeyboard.releaseAll();
    }
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  private applyAccessInfo(info: MidiAccessInfo): void {
    this.devicesStore.setState({ permission: info.state, permissionMessage: info.message });
    if (info.state === "granted") {
      this.refreshDevices();
    }
  }

  refreshDevices(): void {
    const snapshot = this.input.midi.getDevices();
    const outputs = toPanelPorts(snapshot.outputs);
    const devices = this.devicesStore.getState();
    this.devicesStore.setState({
      inputs: toPanelPorts(snapshot.inputs),
      outputs,
      selectedInputId: snapshot.selectedInputId,
      routingWarnings: this.input.midi.getRoutingWarnings()
    });
    if (devices.selectedOutputId !== null) {
      const port = outputs.find((candidate) => candidate.id === devices.selectedOutputId);
      if (!port || port.connected === false) {
        this.selectOutput(null);
        this.devicesStore.setState({ statusMessage: "The MIDI output disconnected; playing through the built-in sound." });
      }
    }
  }

  /** Must run from a user gesture (button click). */
  async requestMidiAccess(): Promise<void> {
    if (this.session.getState().inputSource !== "midi") {
      this.session.dispatch({ type: "setInputSource", source: "midi" });
    }
    const info = await this.input.midi.requestAccess();
    this.applyAccessInfo(info);
    if (info.state === "granted") {
      const devices = this.devicesStore.getState();
      if (devices.selectedInputId === null && devices.inputs.length > 0) {
        this.selectInput(devices.inputs[0].id);
      } else {
        this.devicesStore.setState({ statusMessage: devices.inputs.length === 0 ? "MIDI is allowed, but no keyboard was found. Connect one and it appears here." : info.message });
      }
    } else {
      this.devicesStore.setState({ statusMessage: `${info.message} The on-screen piano and computer keys still work.` });
    }
  }

  selectInput(id: string | null): void {
    const previous = this.input.midi.getSelectedInputId();
    if (previous !== null && previous !== id) {
      this.recorder.closePort(previous, nowMs(), "The MIDI input was switched; notes held on the previous device were closed.");
    }
    const attached = this.input.midi.selectInput(id);
    this.refreshDevices();
    const name = id === null ? null : this.devicesStore.getState().inputs.find((port) => port.id === id)?.name ?? id;
    this.devicesStore.setState({
      statusMessage: id === null ? "No MIDI input selected." : attached ? `Listening to ${name}.` : `${name} is not connected; it reconnects automatically when it appears.`
    });
  }

  /** Output for playback (null = built-in sound). Also used for monitoring and panic. */
  selectOutput(id: string | null): void {
    if (id === null) {
      void this.transport.setEngine(this.toneMain);
      void this.auditionTransport.setEngine(this.toneAudition);
      this.webMonitor.allNotesOff();
      this.input.midi.setEchoOutput(null);
      this.devicesStore.setState({ engineKind: "tone", selectedOutputId: null, statusMessage: "Playing through the built-in sound." });
    } else {
      const output = this.input.midi.getOutput(id);
      if (!output) {
        this.devicesStore.setState({ statusMessage: "That MIDI output is not available." });
        return;
      }
      this.webMain.setOutput(output);
      this.webAudition.setOutput(output);
      this.webMonitor.setOutput(output);
      this.toneMonitor.allNotesOff();
      void this.transport.setEngine(this.webMain);
      void this.auditionTransport.setEngine(this.webAudition);
      this.input.midi.setEchoOutput(output);
      this.devicesStore.setState({ engineKind: "webmidi", selectedOutputId: id, statusMessage: `Playing through ${output.name ?? "the MIDI output"}.` });
    }
    this.monitored.clear();
    this.applyMonitoring();
  }

  setEngineKind(kind: EngineKind): void {
    if (kind === "tone") {
      this.selectOutput(null);
      return;
    }
    const first = this.devicesStore.getState().outputs[0];
    if (!first) {
      this.devicesStore.setState({ statusMessage: "Connect MIDI and choose an output first." });
      return;
    }
    this.selectOutput(this.devicesStore.getState().selectedOutputId ?? first.id);
  }

  setMonitoring(enabled: boolean): void {
    this.devicesStore.setState({ monitoring: enabled });
    this.applyMonitoring();
  }

  private applyMonitoring(): void {
    const devices = this.devicesStore.getState();
    this.input.midi.setMonitoring(devices.monitoring && devices.engineKind === "webmidi");
    if (!devices.monitoring) {
      this.monitored.clear();
      this.toneMonitor.allNotesOff();
      this.webMonitor.allNotesOff();
    }
    this.devicesStore.setState({ routingWarnings: this.input.midi.getRoutingWarnings() });
  }

  /** Release everything: learner input, monitoring, playback and audition outputs. */
  panic(): void {
    this.recorder.reset(nowMs(), "All notes were released (panic).");
    this.input.touch.releaseAll();
    this.input.computerKeyboard.releaseAll();
    this.input.midi.panic();
    this.monitored.clear();
    this.toneMonitor.allNotesOff();
    this.webMonitor.panic();
    this.webMain.panic();
    this.auditionTransport.stop();
    this.soundingNotes.clear();
    this.soundingStore.setState({ notes: [], demonstration: [], accompaniment: [] });
    this.devicesStore.setState({ statusMessage: "All notes released." });
  }

  // -------------------------------------------------------------------------
  // Session / preferences
  // -------------------------------------------------------------------------

  private onSessionChange(): void {
    const state = this.session.getState();
    if (state.inputSource !== this.lastInputSource) {
      const previous = this.lastInputSource;
      this.lastInputSource = state.inputSource;
      // A MIDI piano usually sounds by itself; the on-screen/computer keys need the app's sound.
      if (state.inputSource === "midi") {
        this.setMonitoring(false);
      } else if (previous === "midi") {
        this.setMonitoring(true);
      }
      this.input.touch.releaseAll();
    }
    this.syncKeyboardAttachment();
    if (this.storesInitialised) {
      if (this.prefsTimer !== null) {
        clearTimeout(this.prefsTimer);
      }
      this.prefsTimer = setTimeout(() => {
        this.prefsTimer = null;
        this.persistPreferences();
      }, PREFERENCES_SAVE_DELAY_MS);
    }
  }

  private applyPreferences(prefs: Preferences): void {
    this.preferences = prefs;
    const patch: Partial<SessionState> = {
      theme: themeFromPreference(prefs.theme, mediaMatches("(prefers-color-scheme: dark)")),
      labelMode: labelModeFromPreference(prefs.labelMode),
      reducedMotion: reducedMotionFromPreference(prefs.reducedMotion, mediaMatches("(prefers-reduced-motion: reduce)"))
    };
    const source = inputSourceFromPreference(prefs.inputSource);
    if (source !== null) {
      patch.inputSource = source;
    }
    this.session.setState(patch);
    const defaults = DEFAULT_PREFERENCES.pianoRange;
    if (prefs.pianoRange.low !== defaults.low || prefs.pianoRange.high !== defaults.high) {
      this.session.dispatch({ type: "setPianoRange", range: { low: prefs.pianoRange.low, high: prefs.pianoRange.high }, user: true });
    }
    this.input.midi.setLatencyOffsetMs(prefs.latencyOffsetMs);
  }

  private persistPreferences(): void {
    const state = this.session.getState();
    const prefs = this.preferences;
    const patch: Partial<Preferences> = {};
    const label = labelModeToPreference(state.labelMode);
    if (label !== prefs.labelMode) {
      patch.labelMode = label;
    }
    if (state.theme !== themeFromPreference(prefs.theme, mediaMatches("(prefers-color-scheme: dark)"))) {
      patch.theme = state.theme;
    }
    if (state.reducedMotion !== reducedMotionFromPreference(prefs.reducedMotion, mediaMatches("(prefers-reduced-motion: reduce)"))) {
      patch.reducedMotion = state.reducedMotion ? "reduce" : "noPreference";
    }
    const source = inputSourceToPreference(state.inputSource);
    if (source !== prefs.inputSource) {
      patch.inputSource = source;
    }
    if (state.pianoRangeLocked && (state.pianoRange.low !== prefs.pianoRange.low || state.pianoRange.high !== prefs.pianoRange.high)) {
      patch.pianoRange = { low: state.pianoRange.low, high: state.pianoRange.high };
    }
    if (Object.keys(patch).length === 0) {
      return;
    }
    const result = this.stores.preferences.update(patch);
    if (result.ok) {
      this.preferences = result.value;
    } else {
      this.uiStore.setState({ storageMessage: result.error.message });
    }
  }

  /** Save explicit preference fields now (latency calibration, onboarding ...). */
  updatePreferences(patch: Partial<Preferences>): ActionResult {
    const result = this.stores.preferences.update(patch);
    if (!result.ok) {
      return { ok: false, message: result.error.message };
    }
    this.preferences = result.value;
    if (patch.latencyOffsetMs !== undefined) {
      this.input.midi.setLatencyOffsetMs(result.value.latencyOffsetMs);
    }
    return { ok: true, message: "Saved." };
  }

  private watchSystemPreferences(): () => void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => undefined;
    }
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onDark = (): void => {
      if (this.preferences.theme === "system") {
        this.session.dispatch({ type: "setTheme", theme: dark.matches ? "dark" : "light" });
      }
    };
    const onMotion = (): void => {
      if (this.preferences.reducedMotion === "system") {
        this.session.dispatch({ type: "setReducedMotion", reducedMotion: motion.matches });
      }
    };
    onDark();
    onMotion();
    const add = (query: MediaQueryList, fn: () => void): (() => void) => {
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", fn);
        return () => query.removeEventListener("change", fn);
      }
      query.addListener(fn);
      return () => query.removeListener(fn);
    };
    const offDark = add(dark, onDark);
    const offMotion = add(motion, onMotion);
    return () => {
      offDark();
      offMotion();
    };
  }

  // -------------------------------------------------------------------------
  // Onboarding (plan "First-session example" steps 1–2)
  // -------------------------------------------------------------------------

  chooseOnboarding(choice: OnboardingChoice): void {
    this.updatePreferences({ onboardingChoice: choice });
    this.uiStore.setState({ onboardingChoice: choice });
    this.session.dispatch({ type: "setLabelMode", labelMode: choice === "learningChords" ? "noteNames" : "chordDegrees" });
    this.openInExplore(choice === "learningChords" ? "C" : "Dm9");
  }

  chooseInput(source: "midi" | "computerKeyboard" | "touch" | "none"): void {
    if (source === "midi") {
      void this.requestMidiAccess();
    } else {
      this.session.dispatch({ type: "setInputSource", source });
    }
  }

  dismissOnboarding(): void {
    this.uiStore.setState({ onboardingVisible: false });
    try {
      this.stores.adapter.set(ONBOARDING_DISMISSED_KEY, "1");
    } catch {
      // Not persisted; it simply shows again next visit.
    }
  }

  // -------------------------------------------------------------------------
  // Piano targets
  // -------------------------------------------------------------------------

  setExploreTargets(targets: ExploreTarget[], chord: ChordDefinition | null, caption: string): void {
    this.exploreTargetsStore.setState({ targets, chord, caption });
  }

  /** Take over (or release with null) the piano target layer, e.g. from Practice. */
  setPianoTargetsOverride(override: PianoTargetsOverride | null): void {
    this.targetsOverrideStore.setState({ override });
  }

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  openInExplore(symbol: string): void {
    const trimmed = symbol.trim();
    this.explore.setState({ tab: "chord", symbolInput: trimmed, symbol: trimmed === "" ? this.explore.getState().symbol : trimmed, inversion: 0, voicingA: null, voicingB: null });
    this.session.dispatch({ type: "setMode", mode: "explore" });
  }

  openInCreate(material: MusicalSequence | string, name?: string): void {
    if (typeof material === "string") {
      this.editor.dispatch({ type: "newProject", sequenceId: freshId("seq"), name, text: material });
    } else {
      this.editor.dispatch({ type: "loadSequence", sequence: material, name });
    }
    this.session.dispatch({ type: "setMode", mode: "create" });
  }

  openInPractice(payload: PracticePayload): void {
    this.requestCounter += 1;
    const request: PracticeRequest = { ...payload, requestId: this.requestCounter, requestedAt: Date.now() };
    this.practiceRequestStore.setState({ request });
    this.loadTimeline(payload.timeline, { sourceKind: "exercise", sourceId: payload.exerciseId ?? payload.timeline.id, title: payload.title, version: payload.timeline.sourceVersion });
    this.session.dispatch({ type: "setMode", mode: "practice" });
  }

  clearPracticeRequest(): void {
    this.practiceRequestStore.setState({ request: null });
  }

  // -------------------------------------------------------------------------
  // Projects (Create)
  // -------------------------------------------------------------------------

  private projectSettings(): Record<string, unknown> {
    const playback = this.playbackStore.getState();
    return { arpeggiate: playback.arpeggiate, accompaniment: playback.accompaniment, defaultChordMeasures: this.editor.getState().defaultChordMeasures };
  }

  /** Open a saved/imported project in the editor (recompiling legacy text projects). */
  openProject(project: ProjectFile, options: { switchMode?: boolean } = {}): ActionResult {
    let file = project;
    if (projectNeedsRecompile(project) && project.sourceText !== undefined) {
      const parsed = sequenceFromParsedText(project.sourceText, {
        defaultChordMeasures: 1,
        tempoBpm: project.sequence.tempo.bpm,
        timeSignature: project.sequence.timeSignature,
        id: project.sequence.id
      });
      file = withRecompiledSequence(project, parsed.sequence);
    }
    const settings = file.settings ?? {};
    const arpeggiate = settings.arpeggiate;
    const accompaniment = settings.accompaniment;
    const patch: Partial<PlaybackOptions> = {};
    if (arpeggiate === 0 || arpeggiate === 1 || arpeggiate === 2 || arpeggiate === 3) {
      patch.arpeggiate = arpeggiate;
    }
    if (accompaniment === "none" || accompaniment === "sustained" || accompaniment === "bassAndChord" || accompaniment === "rootOnly") {
      patch.accompaniment = accompaniment;
    }
    if (Object.keys(patch).length > 0) {
      this.playbackStore.setState(patch);
    }
    if (typeof settings.defaultChordMeasures === "number") {
      this.editor.dispatch({ type: "setDefaultChordMeasures", measures: settings.defaultChordMeasures });
    }
    this.editor.dispatch({ type: "loadProject", project: file });
    this.rememberProject(file.id);
    if (options.switchMode !== false) {
      this.session.dispatch({ type: "setMode", mode: "create" });
    }
    return { ok: true, message: `Opened “${file.name}”.` };
  }

  private rememberProject(id: string): void {
    try {
      this.stores.adapter.set(LAST_PROJECT_KEY, id);
    } catch {
      // Not critical.
    }
  }

  private bumpProjectList(): void {
    this.uiStore.setState({ projectListVersion: this.uiStore.getState().projectListVersion + 1 });
  }

  saveProject(options: { asNew?: boolean; name?: string } = {}): ActionResult {
    const state = this.editor.getState();
    const name = (options.name ?? state.project.name).trim() || "Untitled progression";
    const settings = this.projectSettings();
    let result: Result<ProjectFile>;
    if (!options.asNew && state.project.id !== null) {
      const existing = this.stores.projects.get(state.project.id);
      if (existing.ok && existing.value) {
        result = this.stores.projects.save({ ...existing.value, name, sequence: state.present.sequence, sourceText: state.present.text, settings });
      } else {
        result = this.stores.projects.createProject(name, state.present.sequence, state.present.text, settings);
      }
    } else {
      const sequence = options.asNew ? { ...state.present.sequence, id: freshId("seq") } : state.present.sequence;
      result = this.stores.projects.createProject(name, sequence, state.present.text, settings);
    }
    if (!result.ok) {
      this.uiStore.setState({ storageMessage: result.error.message });
      return { ok: false, message: result.error.message };
    }
    if (options.asNew) {
      this.editor.dispatch({ type: "loadProject", project: result.value });
    } else {
      this.editor.dispatch({ type: "markSaved", projectId: result.value.id, name: result.value.name, createdAt: result.value.createdAt });
    }
    this.rememberProject(result.value.id);
    this.bumpProjectList();
    const warn = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
    const storage = this.stores.currentStatus();
    const durable = storage.available ? "" : " (kept in memory only: this browser does not allow saving)";
    return { ok: true, message: `Saved “${result.value.name}”${durable}.${warn}` };
  }

  duplicateProject(): ActionResult {
    const id = this.editor.getState().project.id;
    if (id === null) {
      return { ok: false, message: "Save the project before duplicating it." };
    }
    const copy = this.stores.projects.duplicate(id);
    if (!copy.ok) {
      return { ok: false, message: copy.error.message };
    }
    this.bumpProjectList();
    return this.openProject(copy.value);
  }

  openSavedProject(id: string): ActionResult {
    const found = this.stores.projects.get(id);
    if (!found.ok) {
      return { ok: false, message: found.error.message };
    }
    if (!found.value) {
      return { ok: false, message: "That project no longer exists." };
    }
    return this.openProject(found.value);
  }

  deleteProject(id: string): ActionResult {
    const removed = this.stores.projects.remove(id);
    if (!removed.ok) {
      return { ok: false, message: removed.error.message };
    }
    this.bumpProjectList();
    return { ok: true, message: "Project deleted." };
  }

  /** The current editor document as a ProjectFile (saved or not), for JSON export. */
  currentProjectFile(): ProjectFile {
    const state = this.editor.getState();
    const nowIso = new Date().toISOString();
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      kind: "project",
      id: state.project.id ?? `unsaved-${state.present.sequence.id}`.replace(/[^A-Za-z0-9_-]/g, "-"),
      name: state.project.name,
      createdAt: state.project.createdAt ?? nowIso,
      updatedAt: nowIso,
      sequence: state.present.sequence,
      sourceText: state.present.text,
      settings: this.projectSettings()
    };
  }

  exportProjectJson(): string {
    return this.stores.projects.exportProjectJson(this.currentProjectFile());
  }

  /** Import exported project JSON (or legacy text JSON), save it as a new project and open it. */
  importProjectJson(text: string): ActionResult {
    const imported = this.stores.projects.importProjectJson(text, { assignNewId: true });
    if (!imported.ok) {
      return { ok: false, message: imported.error.message };
    }
    const saved = this.stores.projects.save(imported.value, { touch: false });
    const project = saved.ok ? saved.value : imported.value;
    this.bumpProjectList();
    const opened = this.openProject(project);
    const notes = [...imported.warnings, ...(saved.ok ? saved.warnings : [`Not saved: ${saved.error.message}`])];
    return { ok: opened.ok, message: `${opened.message}${notes.length > 0 ? ` ${notes.join(" ")}` : ""}` };
  }

  /** MIDI file of the editor document as currently arranged (muted parts excluded). */
  exportMidi(): { bytes: Uint8Array; blob?: Blob; fileName: string } {
    const state = this.editor.getState();
    const playback = this.playbackStore.getState();
    const voiced = voiceSequenceForPlayback(state.present.sequence);
    const timeline = compileTimelineWithDiagnostics(voiced.sequence, { arpeggiate: playback.arpeggiate, accompaniment: playback.accompaniment }).timeline;
    const status = this.transport.getSnapshot();
    const result = buildMidiFromTimeline(timeline, { mutedParts: status.mutedParts });
    const fileName = `${state.project.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-") || "progression"}.mid`;
    return { bytes: result.bytes, blob: result.blob, fileName };
  }

  // -------------------------------------------------------------------------
  // Performance recorder (record → play/loop as backing track → save → export)
  //
  // Integration: a finished take is converted to a PerformanceTimeline (part "accompaniment") and
  // loaded into the MAIN transport as material of kind "recording" — the same path exercises and
  // charts use — so play/pause/loop/tempo/metronome/output routing, piano highlighting and the
  // position strip all work unchanged, and the editor document is never replaced. While a take is
  // captured with a count-in/metronome, a click-track timeline is played by the transport and the
  // previous material (and loop) is restored when the take stops.
  // -------------------------------------------------------------------------

  private syncRecorder(): void {
    const snapshot = this.recorder.getSnapshot();
    this.recordingStore.setState({ status: snapshot.status, noteCount: snapshot.noteCount, warnings: snapshot.warnings });
  }

  private watchUnload(): () => void {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
      return () => undefined;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const state = this.recordingStore.getState();
      if (this.recorder.isActive() || (state.take !== null && state.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }

  /** Make sure a count-in that lost its click track still flips the recorder to "recording". */
  private scheduleRecorderTick(): void {
    const zero = this.recorder.getSnapshot().zeroMs;
    if (zero === null) {
      return;
    }
    const delay = Math.max(0, zero - nowMs());
    setTimeout(() => this.recorder.tick(), delay + 1);
  }

  /** Tempo (override included), meter, count-in and metronome the next take will use. */
  recordingSettings(): RecordingSettings {
    const status = this.transport.getSnapshot();
    const timeline = this.transport.getTimeline();
    const timeSignature = timeline ? timeline.timeSignature : this.editor.getState().present.sequence.timeSignature;
    return { tempoBpm: status.tempoBpm, timeSignature: { ...timeSignature }, countInBeats: status.countInBeats, metronome: status.metronomeEnabled };
  }

  /**
   * Start a take. Any playback (material, demonstration, audition) is stopped first. With a count-in
   * or metronome enabled on the transport, a click track plays and beat 0 of the take is the end of
   * the count-in; otherwise the take starts immediately. A previous unsaved take is replaced.
   */
  async startRecording(): Promise<ActionResult> {
    if (this.recorder.isActive()) {
      return { ok: false, message: "Already recording." };
    }
    if (this.demo) {
      this.stopDemonstration();
    }
    this.stopAudition();
    const settings = this.recordingSettings();
    const bpm = settings.tempoBpm;
    this.transport.stop();
    this.takeCounter += 1;
    const title = `Take ${this.takeCounter}`;
    let zeroMs = nowMs();
    let countInBeats = 0;
    if (settings.countInBeats > 0 || settings.metronome) {
      const bar = beatsPerBar(settings.timeSignature.numerator, settings.timeSignature.denominator);
      const totalBeats = (Math.ceil(msToBeats(MAX_RECORDING_MS, bpm) / bar) + 1) * bar;
      const click = buildClickTimeline({ bpm, timeSignature: settings.timeSignature, totalBeats, metronome: settings.metronome });
      const session: RecordingClickSession = { original: this.transport.getTimeline(), loop: this.transport.getSnapshot().loop, started: false };
      this.recordingClick = session;
      if (session.loop) {
        this.transport.setLoop(null);
      }
      this.transport.load(click);
      await this.transport.play(0);
      if (this.recordingClick === session && isActive(this.transport.getSnapshot())) {
        // Beat 0 of the take = the transport's beat 0 (negative position during the count-in).
        const snapshot = this.transport.getSnapshot();
        zeroMs = nowMs() - snapshot.positionSeconds * 1000;
        countInBeats = settings.countInBeats;
      } else {
        // The output could not start (or other material took the transport): record without the click.
        if (this.recordingClick === session) {
          this.recordingClick = null;
          this.restoreAfterClick(session);
        }
        zeroMs = nowMs();
      }
    }
    const started = this.recorder.start({
      tempo: { bpm },
      timeSignature: settings.timeSignature,
      countInBeats,
      zeroMs,
      title,
      initialPedals: this.input.held.snapshot()
    });
    if (!started) {
      return { ok: false, message: "Already recording." };
    }
    const delay = Math.max(0, zeroMs - nowMs()) + MAX_RECORDING_MS + 50;
    this.recordingTimer = setTimeout(() => {
      this.recordingTimer = null;
      if (this.recorder.isActive()) {
        this.stopRecording();
      }
    }, delay);
    this.takeTimelineCache = null;
    this.recordingStore.setState({ take: null, notes: [], savedId: null, dirty: false, message: null, countInBeats });
    this.syncRecorder();
    return { ok: true, message: countInBeats > 0 ? "Count-in…" : "Recording." };
  }

  private restoreAfterClick(session: RecordingClickSession): void {
    this.transport.stop();
    if (!isClickTimeline(this.transport.getTimeline())) {
      return;
    }
    if (session.original) {
      this.transport.load(session.original);
    } else {
      this.loadEditorSequence();
    }
    if (session.loop) {
      this.transport.setLoop(session.loop);
    }
    this.updatePosition();
  }

  /** Finish the take. Held notes/pedal are closed at the stop boundary by note pairing. */
  stopRecording(): ActionResult {
    if (!this.recorder.isActive()) {
      return { ok: false, message: "Not recording." };
    }
    if (this.recordingTimer !== null) {
      clearTimeout(this.recordingTimer);
      this.recordingTimer = null;
    }
    const take = this.recorder.stop();
    const session = this.recordingClick;
    this.recordingClick = null;
    if (session) {
      this.restoreAfterClick(session);
    }
    if (!take || countNoteOns(take.events) === 0) {
      this.recorder.discard();
      const message = "Nothing was played, so no take was kept.";
      this.recordingStore.setState({ take: null, notes: [], savedId: null, dirty: false, message });
      this.syncRecorder();
      return { ok: false, message };
    }
    const notes = pairRecordedNotes(take.events, take.durationMs);
    this.takeTimelineCache = null;
    const message = `Recorded ${notes.length} note${notes.length === 1 ? "" : "s"} in ${formatClock(take.durationMs)}.`;
    this.recordingStore.setState({ take, notes, savedId: null, dirty: true, fitToBars: take.countInBeats > 0, message });
    this.syncRecorder();
    return { ok: true, message };
  }

  /** Abort a running take or drop the finished one. The progression comes back if the take was playing. */
  discardRecording(): void {
    if (this.recorder.isActive()) {
      if (this.recordingTimer !== null) {
        clearTimeout(this.recordingTimer);
        this.recordingTimer = null;
      }
      const session = this.recordingClick;
      this.recordingClick = null;
      this.recorder.discard();
      if (session) {
        this.restoreAfterClick(session);
      }
    }
    const take = this.recordingStore.getState().take;
    if (take && this.isTakeLoaded(take)) {
      this.transport.stop();
      this.loadEditorSequence();
    }
    this.recorder.discard();
    this.takeTimelineCache = null;
    this.recordingStore.setState({ take: null, notes: [], savedId: null, dirty: false, message: "Take discarded." });
    this.syncRecorder();
  }

  /** True while the take's timeline is the transport material. */
  isTakeLoaded(take?: PerformanceRecording | null): boolean {
    const current = take ?? this.recordingStore.getState().take;
    if (!current) {
      return false;
    }
    const material = this.materialStore.getState();
    return material.sourceKind === "recording" && material.sourceId === current.id;
  }

  private takeTimeline(take: PerformanceRecording): RecordingTimelineResult {
    const state = this.recordingStore.getState();
    const cache = this.takeTimelineCache;
    if (cache && cache.take === take && cache.fitToBars === state.fitToBars) {
      return cache.result;
    }
    const result = recordingTimeline(take, { fitToBars: state.fitToBars, notes: state.take === take ? state.notes : undefined });
    this.takeTimelineCache = { take, fitToBars: state.fitToBars, result };
    return result;
  }

  /** The take's playback timeline (as it would be loaded), or null without a take. */
  recordingTimeline(): PerformanceTimeline | null {
    const take = this.recordingStore.getState().take;
    return take ? this.takeTimeline(take).timeline : null;
  }

  private loadTakeIntoTransport(take: PerformanceRecording): void {
    if (this.isTakeLoaded(take)) {
      return;
    }
    if (this.demo) {
      this.stopDemonstration();
    }
    this.stopAudition();
    const { timeline } = this.takeTimeline(take);
    this.loadTimeline(timeline, { sourceKind: "recording", sourceId: take.id, title: take.title });
  }

  /** Load the take as the transport material (if needed) and play/resume it. */
  async playRecording(): Promise<ActionResult> {
    const take = this.recordingStore.getState().take;
    if (!take || this.recorder.isActive()) {
      return { ok: false, message: "There is no take to play." };
    }
    this.loadTakeIntoTransport(take);
    await this.transport.play();
    return { ok: true, message: "Playing the take." };
  }

  pauseRecordingPlayback(): void {
    if (this.isTakeLoaded()) {
      this.transport.pause();
    }
  }

  stopRecordingPlayback(): void {
    if (this.isTakeLoaded()) {
      this.transport.stop();
    }
  }

  /** Play the take from the beginning (restarts while playing). */
  async restartRecordingPlayback(): Promise<ActionResult> {
    const take = this.recordingStore.getState().take;
    if (!take || this.recorder.isActive()) {
      return { ok: false, message: "There is no take to play." };
    }
    this.loadTakeIntoTransport(take);
    await this.transport.play(0);
    return { ok: true, message: "Playing the take from the start." };
  }

  /** Loop the whole take (its full length, trailing silence included; bar-fitted when enabled). */
  setRecordingLoop(enabled: boolean): void {
    const take = this.recordingStore.getState().take;
    if (!take || this.recorder.isActive()) {
      return;
    }
    this.loadTakeIntoTransport(take);
    const total = this.transport.getSnapshot().totalBeats;
    this.transport.setLoop(enabled && total > 0 ? { startBeat: 0, endBeat: total } : null);
  }

  /** Fit the take's length to whole bars (reloads the timeline in place when it is playing). */
  setRecordingFitToBars(enabled: boolean): void {
    if (this.recordingStore.getState().fitToBars === enabled) {
      return;
    }
    this.recordingStore.setState({ fitToBars: enabled });
    this.takeTimelineCache = null;
    const take = this.recordingStore.getState().take;
    if (take && this.isTakeLoaded(take)) {
      const looped = this.transport.getSnapshot().loop !== null;
      const { timeline } = this.takeTimeline(take);
      this.loadTimeline(timeline, { sourceKind: "recording", sourceId: take.id, title: take.title });
      if (looped) {
        this.transport.setLoop({ startBeat: 0, endBeat: timeline.totalBeats });
      }
    }
  }

  /** Rename the in-memory take (marks it unsaved). */
  setRecordingTitle(title: string): void {
    const trimmed = title.trim();
    const take = this.recordingStore.getState().take;
    if (!take || trimmed === "" || trimmed === take.title) {
      return;
    }
    const renamed = this.recorder.retitle(trimmed);
    if (!renamed) {
      return;
    }
    this.takeTimelineCache = null;
    this.recordingStore.setState({ take: renamed, dirty: true });
    if (this.isTakeLoaded(renamed)) {
      this.materialStore.setState({ title: renamed.title });
    }
  }

  /** Save the take locally. On failure the in-memory take is kept so it can still be exported. */
  saveRecording(options: { title?: string } = {}): ActionResult {
    if (this.recorder.isActive()) {
      return { ok: false, message: "Stop recording before saving." };
    }
    if (options.title !== undefined) {
      this.setRecordingTitle(options.title);
    }
    const take = this.recordingStore.getState().take;
    if (!take) {
      return { ok: false, message: "There is no take to save." };
    }
    const result = this.stores.recordings.save(take);
    if (!result.ok) {
      this.uiStore.setState({ storageMessage: result.error.message });
      const message = `${result.error.message} The take is still open here; export it as MIDI to keep it.`;
      this.recordingStore.setState({ message });
      return { ok: false, message };
    }
    this.recorder.setTake(result.value);
    this.takeTimelineCache = null;
    const storage = this.stores.currentStatus();
    const durable = storage.available ? "" : " (kept in memory only: this browser does not allow saving)";
    const warn = result.warnings.length > 0 ? ` ${result.warnings.join(" ")}` : "";
    const message = `Saved “${result.value.title}”${durable}.${warn}`;
    this.recordingStore.setState((state) => ({ take: result.value, savedId: result.value.id, dirty: false, listVersion: state.listVersion + 1, message }));
    if (this.isTakeLoaded(result.value)) {
      this.materialStore.setState({ title: result.value.title });
    }
    this.syncRecorder();
    return { ok: true, message };
  }

  listRecordings(): Result<RecordingSummary[]> {
    return this.stores.recordings.list();
  }

  /** Open a saved recording as the current take (does not start playback). */
  loadSavedRecording(id: string): ActionResult {
    if (this.recorder.isActive()) {
      return { ok: false, message: "Stop recording before opening a saved take." };
    }
    const found = this.stores.recordings.get(id);
    if (!found.ok) {
      return { ok: false, message: found.error.message };
    }
    if (!found.value) {
      return { ok: false, message: "That recording no longer exists." };
    }
    const take = found.value;
    const notes = pairRecordedNotes(take.events, take.durationMs);
    this.recorder.setTake(take);
    this.takeTimelineCache = null;
    const message = `Opened “${take.title}”.${found.warnings.length > 0 ? ` ${found.warnings.join(" ")}` : ""}`;
    this.recordingStore.setState({ take, notes, savedId: take.id, dirty: false, fitToBars: take.countInBeats > 0, countInBeats: take.countInBeats, message });
    this.syncRecorder();
    return { ok: true, message };
  }

  renameRecording(id: string, title: string): ActionResult {
    const trimmed = title.trim();
    if (trimmed === "") {
      return { ok: false, message: "The recording needs a name." };
    }
    const state = this.recordingStore.getState();
    if (state.take && state.take.id === id) {
      this.setRecordingTitle(trimmed);
      return state.savedId === id ? this.saveRecording() : { ok: true, message: "Renamed." };
    }
    const result = this.stores.recordings.rename(id, trimmed);
    if (!result.ok) {
      return { ok: false, message: result.error.message };
    }
    this.recordingStore.setState((current) => ({ listVersion: current.listVersion + 1 }));
    return { ok: true, message: `Renamed to “${result.value.title}”.` };
  }

  /** Delete a saved recording. An open take with that id stays in memory (as unsaved). */
  deleteRecording(id: string): ActionResult {
    const removed = this.stores.recordings.remove(id);
    if (!removed.ok) {
      return { ok: false, message: removed.error.message };
    }
    const state = this.recordingStore.getState();
    const patch: Partial<RecordingState> = { listVersion: state.listVersion + 1 };
    let message = "Recording deleted.";
    if (state.take && state.take.id === id) {
      patch.savedId = null;
      patch.dirty = true;
      message = "Recording deleted; the open take is now unsaved.";
    }
    patch.message = message;
    this.recordingStore.setState(patch);
    return { ok: true, message };
  }

  /**
   * Standard MIDI File of the current take (or of a saved recording by id): pressed note lengths,
   * recorded channels, pedal CC events, tempo and time signature. Separate from `exportMidi()`
   * (the authored progression).
   */
  exportRecordingMidi(id?: string): { bytes: Uint8Array; blob?: Blob; fileName: string } | null {
    let recording = this.recordingStore.getState().take;
    if (id !== undefined && (!recording || recording.id !== id)) {
      const found = this.stores.recordings.get(id);
      recording = found.ok ? found.value : null;
    }
    if (!recording) {
      return null;
    }
    const result = buildMidiFromRecording(recording);
    return { bytes: result.bytes, blob: result.blob, fileName: recordingFileName(recording.title) };
  }
}
