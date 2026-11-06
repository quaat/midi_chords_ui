# Studio runtime (src/ui/runtime)

One runtime per app wires the real transport, learner input, persistence and the shared
editor/explore state into the workspace shell. `StudioApp` mounts it:

```tsx
<StudioRuntimeProvider>          // creates StudioRuntimeCore once, start()s it in an effect,
  <StudioWorkspace />            // and provides the runtime's SessionStore (useSessionStore works)
</StudioRuntimeProvider>
```

Files

| File | What |
|---|---|
| `runtimeCore.ts` | `StudioRuntimeCore` — framework-free runtime (no React). |
| `StudioRuntime.tsx` | `StudioRuntimeProvider` (context + session store provider). |
| `useStudioRuntime.ts` | All React hooks (below). |
| `runtimeContext.ts` | `StudioRuntimeContext`, `PianoLayoutContext`. |
| `runtimeHelpers.ts` | Pure helpers: `asDemonstration`, `formatPositionLabel`, `findCurrentAndNext`, `learnerNotesOf`, audition timelines, preference mapping. |
| `practicePayload.ts` | `PracticePayload`/`PracticeRequest` types, `chordPracticePayload`, `runPracticePayload`. |
| `voicingBridge.ts` | The only UI entry to `@/voicing` (`realizeAllSafe`, `voiceSequenceForPlayback`, `listRecipes`, `recipeName`, `transitionSummarySafe`). |
| `DisplaySettings.tsx`, `OnboardingCard.tsx` | Shared context-panel sections. |

## Lifecycle and SSR

- The constructor has no side effects (safe during static prerender; StrictMode may build two).
- `start()` (client effect) creates `createStores()` (localStorage, memory fallback), applies
  preferences, reopens the last saved project (`pls:ui:last-project`), subscribes to transport and
  input, attaches the computer keyboard when selected, queries MIDI permission and loads the
  default material (first entry of `SAMPLE_PROGRESSIONS`, parsed with `sequenceFromParsedText`).
  It returns a cleanup and may run twice (StrictMode); storage/preferences are initialised once.

## `StudioRuntimeCore` API

### Transport

- `transport: Transport` — main transport (see header of `src/playback/transport.ts`).
- `auditionTransport: Transport` — second transport for A/B listening (count-in 0, metronome off,
  demonstration on MIDI channel 4). Never changes the main material/position.
- `getTransportSnapshot(): TransportStatus` — stable function for per-frame renderers
  (`FallingNotesStage getSnapshot`, `LiveText`). Never store the result in React state.
- `togglePlay()`, `stop()`.
- `playForMe(): Promise<void>` — toggles "Play it for me": loads `asDemonstration(material.timeline)`
  (learner part re-tagged `"demonstration"`, id `<id>~demo`), clears a loop, plays once from 0,
  restores the original timeline (and loop) when it stops/ends. `stopDemonstration()`.
  `material.demonstrating` is true meanwhile.
- Output engines: `selectOutput(id | null)` — `null` = built-in Tone synth (prepared lazily by the
  first `play()`, i.e. inside the user gesture); an id = `WebMidiTimelineEngine` over
  `MidiInputManager.getOutput(id)` for both transports, also used as echo/panic output.
  `setEngineKind("tone" | "webmidi")`. A disconnected output falls back to Tone with a message.

### Material

- `materialStore: Store<MaterialState>` — `{ sequence, timeline, sourceKind: "project" | "exercise" |
  "chart" | "scratch", sourceId, version, title?, warnings, demonstrating }`.
- `loadSequence(sequence, { sourceKind?, sourceId?, title?, compile? })` — applies voicings
  (`voiceSequenceForPlayback`: events with a recipe or a sequence default get a `VoicingInstance`;
  others keep the legacy close voicer), compiles with the playback options
  (`playbackStore`: `arpeggiate`, `accompaniment`) and loads into the transport. If the same
  source (kind + id) is reloaded, the position is kept and a running playback resumes without a
  count-in.
- `loadTimeline(timeline, { sourceKind, sourceId, title?, sequence?, version?, warnings? })` — for
  exercises/charts compiled elsewhere.
- `loadEditorSequence()` / `ensureEditorMaterial()` — make the Create document the material.
  Editor changes are synced automatically (debounced 120 ms).
- `setPlaybackOptions(patch)`; `playbackStore`.

### Input

- `input.held: HeldStateTracker` (shared), `input.midi: MidiInputManager`,
  `input.computerKeyboard: ComputerKeyboardInput` (attached to window/document only while the
  session `inputSource` is `"computerKeyboard"`), `input.touch: TouchInput` (fed by the piano via
  `touchNoteOn(midi, velocity)`, `touchNoteOff(midi)`, `touchReleaseAll()`).
- `input.subscribeAttacks(listener) → unsubscribe` — `{ midi, velocity, timestampMs, source }` for
  learner attacks only (MIDI input, computer keys, on-screen piano, replay). Playback
  (demonstration/accompaniment) never reaches it. `timestampMs` is the performance clock with the
  latency offset already subtracted for MIDI.
- Monitoring ("Hear what I play"): built-in sound → a separate Tone engine plays learner notes;
  MIDI output → the manager echoes MIDI input (echo-suppressed), touch/keys go to the output.
  Default on for touch/computer keys, switched off when the input source becomes MIDI.
- Devices: `requestMidiAccess()` (user gesture; auto-selects the first input), `selectInput(id|null)`,
  `setMonitoring(bool)`, `panic()`, `refreshDevices()`, `devicesStore`.

### Persistence

- `stores: PersistenceStores` (memory until `start()`, then `createStores()`).
- Preferences applied at start: theme (system → media query), labelMode (`degrees`/`roles` →
  `chordDegrees`), pianoRange (only when it differs from the default), inputSource (`auto` keeps
  the session default), latencyOffsetMs → `midi.setLatencyOffsetMs`, reducedMotion. Session changes
  are written back debounced (500 ms). Lossy mappings: `scaleDegrees` is saved as `degrees`,
  `fingers` as `noteNames`, listen-only (`none`) as `auto`.
- `updatePreferences(patch)` for explicit fields (e.g. latency calibration — the practice agent
  should call this to persist calibration).
- Projects: `saveProject({ asNew?, name? })`, `openSavedProject(id)`, `openProject(file)`,
  `duplicateProject()`, `deleteProject(id)`, `exportProjectJson()`, `importProjectJson(text)`
  (saved as a new project, legacy text projects recompiled), `exportMidi()` (current arrangement,
  muted parts excluded), `currentProjectFile()`. All return `{ ok, message }` (or data).

### Performance recorder (Create)

- `recorder: PerformanceRecorder` (framework-free, `src/recording/`) — fed by MIDI, computer
  keyboard and on-screen piano `onEvent` streams while started; transport/audition output never
  reaches it. `recordingStore: Store<RecordingState>` — `{ status: idle | countIn | recording |
  ready, take, notes, noteCount, warnings, message, savedId, dirty, fitToBars, countInBeats,
  listVersion }`; live elapsed time is `recorder.elapsedMs()` (poll it, e.g. `LiveText`).
- `startRecording()` (stops demo/audition/playback; with the transport's count-in or metronome on
  it plays a click-track timeline and restores the previous material + loop afterwards; tempo =
  transport tempo incl. override, meter = current material), `stopRecording()`, `discardRecording()`,
  `recordingSettings()`.
- Playback: the take is converted with `recordingTimeline()` (part `"accompaniment"`, sounding
  lengths) and loaded into the main transport as material `sourceKind: "recording"` —
  `playRecording()`, `pauseRecordingPlayback()`, `stopRecordingPlayback()`,
  `restartRecordingPlayback()`, `setRecordingLoop(bool)` (whole take), `setRecordingFitToBars(bool)`,
  `isTakeLoaded()`, `recordingTimeline()`. `ensureEditorMaterial()` leaves recording material in
  place; the Create notice offers the progression back.
- Storage: `saveRecording({ title? })`, `setRecordingTitle()`, `listRecordings()`,
  `loadSavedRecording(id)`, `renameRecording(id, title)`, `deleteRecording(id)`; a failed save keeps
  the take in memory. `exportRecordingMidi(id?)` → `{ bytes, blob?, fileName }` (separate from
  `exportMidi()`, which exports the authored progression).
- Hooks: `useRecording()`. UI: `src/ui/create/RecordingPanel.tsx` (`RecordingPanel`, `RecordButton`).
  Decisions and trade-offs: `docs/adr/0002-performance-recorder.md`.

### Audition

- `audition.playChord(midi[], durationBeats = 2)`, `audition.playNotes([{ midi, onsetBeat,
  durationBeats, velocity? }])`, `audition.stop()` — tiny throwaway timeline (part
  `"demonstration"`) on `auditionTransport`; any running audition is stopped first.

### Navigation

- `navigate.openInExplore(symbol)` — Explore, chord tab, that symbol.
- `navigate.openInCreate(sequence | text, name?)` — new unsaved editor document; Create mode.
- `navigate.openInPractice({ timeline, steps?, exerciseId?, title })` — stores a
  `PracticeRequest` (`requestId` increments every call) in `practiceRequestStore`, loads the
  timeline as material (`sourceKind: "exercise"`) and switches to Practice. `clearPracticeRequest()`.
- `navigate.openEntry(view)` — Learn / Songs / My Practice / workspace.

### Piano layers

- `setExploreTargets(targets, chord, caption)` — Explore's target layer (`exploreTargetsStore`).
- `setPianoTargetsOverride({ owner, targets, labels?, chord? } | null)` — Practice's target layer;
  used only while the session mode is `"practice"`. Clear it (null) when practice ends/unmounts.
- `soundingStore` — notes sounding from playback/audition (learner+demonstration → piano
  "demonstration" layer; accompaniment → "accompaniment" layer), flushed once per frame.
- `heldStore` — `HeldStateSnapshot`, flushed once per frame.
- `positionStore` — `{ index, current, next, sounding, timelineId }` of the transport timeline,
  updated on transport state changes and polled at ≤ 10 Hz while playing.

### Other stores

`session` (SessionStore), `editor` (Create document, `dispatch(CreateAction)` — see
`src/ui/create/createState.ts`), `explore` (ExploreState), `uiStore` (onboarding, storage
messages, `projectListVersion`). Onboarding: `chooseOnboarding(choice)`, `chooseInput(source)`,
`dismissOnboarding()`.

## Hooks (`useStudioRuntime.ts`)

`useStudioRuntime()`, `useRuntimeStore(store)`, `useMaterial()`, `useTransportState()`
(state snapshot via useSyncExternalStore — never per frame), `useHeldState()`, `useSounding()`,
`useCurrentOccurrence()`, `usePracticeRequest()`, `usePlaybackOptions()`, `useUiState()`,
`useExploreTargets()`, `useTargetsOverride()`, `useEditor()` → `[state, dispatch]`,
`useExploreState()` → `[state, patch]`, `useDevices()` (state + `requestAccess`, `selectInput`,
`selectOutput`, `setMonitoring`, `panic`, `refresh`), `usePianoLayout()` (the shared `KeyLayout`,
null before the piano is measured), `usePianoTargets()` (target layer for the current mode:
practice override → explore targets → practice default = learner notes of the current occurrence
→ none in Create).

## Plugging in Practice / Learn / Songs / My Practice

- `src/ui/practice/PracticeMode.tsx` must export **both** `PracticeMode(): JSX.Element` (stage above
  the piano) and `PracticeContextPanel(): JSX.Element` (context panel). StudioApp also renders the
  shared current/next strip (`RuntimeCurrentNext`) for Practice.
  - Read `usePracticeRequest()`; the request's `timeline` is already loaded in the main transport.
    Compare `request.requestId` to restart sessions; compare `useMaterial().version`/`timeline.id`
    to detect stale material.
  - Stage renderers: `<FallingNotesStage timeline={material.timeline} getSnapshot={runtime.getTransportSnapshot}
    layout={usePianoLayout()} … />` (the layout is the piano's; lanes align).
  - Learner input for assessment: `runtime.input.subscribeAttacks(...)` plus `useHeldState()` /
    `runtime.input.held.snapshot()`; never use transport note events as learner input.
  - Mute the learner part during play-along with `runtime.transport.setPartMuted("learner", true)`;
    "Play it for me" is `runtime.playForMe()`.
  - Show the current step on the piano with `runtime.setPianoTargetsOverride({ owner: "practice", targets, labels?, chord })`
    and clear it on unmount.
  - Practice keeps its own copy of the request timeline/steps: Create edits recompile and reload
    the transport (`sourceKind` becomes `"project"`), but never mutate a running attempt's
    timeline; detect the change via `material.sourceKind/sourceId/version`.
- `src/ui/learn/LearnView.tsx` (`LearnView()`), `src/ui/songs/SongsView.tsx` (`SongsView()`),
  `src/ui/myPractice/MyPracticeView.tsx` (`MyPracticeView()`): no props; open material with
  `runtime.navigate.*` (e.g. `openInPractice(compiledExercise)`, `openInExplore(symbol)`,
  `openInCreate(text)`), or `runtime.loadTimeline(chartTimeline, { sourceKind: "chart", … })`.
