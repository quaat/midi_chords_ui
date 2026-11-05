# ADR 0001 — Shared musical/session contracts and the incremental migration route

Status: accepted (2026-11-04). Covers plan issue E03.

## Decision

1. **One contracts module.** All features build against `src/model/contracts.ts`. It separates
   *meaning* (`ChordDefinition`, `HarmonicContext`, `ScaleDefinition`, `PatternRecipe`, `SongChart`),
   *performance* (`VoicingInstance`, `MusicalSequence`, `PerformanceTimeline`, `PerformedNote`,
   `PerformanceOccurrence`), *evidence* (`InputEvent`, `AttemptResult`, `ProgressEvidence`), and
   *content* (`ConceptDefinition`, `LearningPath`, `ExerciseDefinition`, `ArrangementDefinition`,
   `PracticeRoutine`). Contract changes are additive and reviewed; feature modules never redefine them.
2. **Spelling is first-class.** Pitches are `SpelledNote`/`SpelledPitchClass` (letter + accidental),
   MIDI numbers are derived. Transposition and degree labels operate on spelled intervals.
3. **Musical time is authored in beats; seconds are derived.** `src/timeline/clock.ts` maps beats to
   seconds through the tempo and anchors beat 0 to a `performance.now()` origin. Web Audio
   `currentTime` and Web MIDI timestamps are separate clocks that engine adapters translate.
4. **One performed-note representation.** `compileTimeline` produces the `PerformanceTimeline` that
   audio (Tone/Web MIDI engines), key highlighting, the falling-note stage, MIDI export, and practice
   matching all consume. Arpeggios are compiled into real onsets; repeats produce distinct
   `occurrenceId`s so loops, highlighting, and missed-note attribution refer to the same pass.
5. **Sources stay separate.** `PerformedNote.part` (learner / accompaniment / demonstration /
   metronome) and `InputEvent.source` (midi / computerKeyboard / touch / replay) are mandatory.
   Demonstration and accompaniment never count as learner input; MIDI monitoring is an explicit
   routing option that is off by default.
6. **Assessment is a declared policy.** `AnswerPolicy` (exactVoicing / roles / pitchClass / listen /
   free) and `AssessmentContract` (reproduce / satisfyConstraints / exploreReflect) are part of every
   exercise. A chart symbol alone never creates exact-note targets; an arrangement must be selected.
7. **State management:** the smallest viable approach — a framework-free store with
   `useSyncExternalStore` (`src/state/sessionStore.ts`) for session/UI state, per-frame transport
   position read through a snapshot getter, and persistence through versioned JSON documents in
   `localStorage` (`src/persistence/`). No Redux, no backend, no shared package.
8. **Framework:** keep Next.js 14 / React 18 / static export. A framework migration must solve a
   demonstrated problem; none was demonstrated.

## Migration sequence

- The new studio is served at `/`; the previous application remains reachable at `/legacy` with its
  original components, scheduler, and styling untouched.
- Legacy modules (`src/parser`, `src/theory`, `src/playback/scheduler.ts`, `src/midi/buildMidiFile.ts`,
  `src/notation`) are wrapped by adapters (`src/music/legacy.ts`, `src/timeline/compile.ts`
  fallback voicer, `src/midi/timelineToMidi.ts`) rather than edited.
- Legacy components are retired only after the replacement passes its gate (E22). `/legacy` has a
  removal issue once the E01 matrix is closed.

## Consequences

- Every exercise example traverses symbol → `ChordDefinition` → `VoicingInstance` → `SequenceEvent` →
  `PerformedNote` → `ExerciseStep` → `AttemptResult` without losing spelling, hand roles, or IDs; the
  vertical-slice fixture (rootless ii–V–I in C) is the canonical test of this.
- Type checking (`tsc --strict`), lint, Vitest, and the production build must be re-run outside the
  sandboxed authoring environment before merge; the offline harness used during authoring only
  covers syntax, import resolution, and pure-logic tests.
