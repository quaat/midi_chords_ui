# Piano Learning Studio (midi_chords_ui)

A browser-only piano learning studio built with Next.js 14, React 18, and TypeScript. One persistent
interactive piano sits under three modes:

- **Explore** — inspect chords, inversions, voicings, scales and modes; hear A/B comparisons.
- **Practice** — step practice (wait for an acceptable answer), timed practice with count-in and
  falling notes, listening, and free play with recording; feedback separates pitch from timing.
- **Create** — chord blocks or chord text, per-chord voicing recipes, Chord Pathways, saved
  projects, MIDI and MusicXML/notation export, and a **performance recorder**: record what you
  play (MIDI keyboard, computer keys or on-screen piano) with its real timing, velocities and
  sustain pedal, loop the take as a backing track while you play along, save it locally and
  export it as a standard `.mid` file (see `docs/adr/0002-performance-recorder.md`).

Content entry points open material into the same workspace: a searchable **Learn** catalogue
with concept pages and three entry routes, a **Songs** collection with editable charts and
play-along arrangements, and **My Practice** with routines, review suggestions, and progress
kept distinct by evidence kind (read / listened / assisted / independent / transfer).

The previous text-to-MIDI studio is still reachable at `/legacy` during the migration.

Plan and status: `midi_chords_ui-reimplementation-plan-2026-11-04.md`,
`docs/exec-plans/active/piano-learning-studio.md`, `docs/baseline/`, `docs/adr/`.

## Setup

```bash
npm ci
npm run dev        # http://localhost:3000
npm test           # vitest
npx tsc --noEmit   # type check
npm run build      # static export to out/
```

Web MIDI needs a secure context (https or localhost) and a browser that implements
`navigator.requestMIDIAccess`. Without it, the computer keyboard (rows `z…,` and `q…i`,
`-`/`=` octave, Space sustain) and touch/mouse on the piano work for exploration and step
practice. MIDI monitoring (echo to an output) is off by default so a digital piano's local sound
can be used while the app only observes input.

## Architecture

All features build on the shared contracts in `src/model/contracts.ts` (see
`docs/adr/0001-shared-contracts-and-migration.md`). Core modules are deterministic TypeScript
without React:

| Module | Purpose |
|---|---|
| `src/music/` | Spelled pitches, intervals, chord definitions (adapter over the legacy symbol parser), scales/modes, keys, patterns, legacy text adapters |
| `src/voicing/` | Explicit voicing recipes (close, open, shell, guide tones, rootless A/B), constraint engine, explainable voice leading |
| `src/timeline/`, `src/playback/transport.ts` | One `PerformanceTimeline` for audio, highlighting, falling notes, export, and assessment; transport with clock mapping, count-in, loops, metronome, part mutes; Tone.js and Web MIDI engines |
| `src/input/` | Normalised learner input, held/sustained state, pedals, hot-plug, monitoring, replay logs, AP-470 report template |
| `src/recording/` | Performance recorder: event capture relative to an explicit start, note pairing (pedal-aware), take → `PerformanceTimeline`, click track, `.mid` export with pedal controllers |
| `src/practice/` | Exercise compiler, answer policies, step and timed sessions, feedback and evidence |
| `src/content/` | Repository-authored concepts, exercises, warm-ups, melodies, charts, arrangements, routines, paths; validator and manifest (`src/content/AUTHORING.md`) |
| `src/charts/`, `src/harmonisation/`, `src/scalelab/` | Chart expansion/editing/arrangements, diatonic and melody harmonisation, mode comparison and scale runs |
| `src/persistence/` | Versioned local storage for projects, charts, recordings, preferences, progress; JSON export/import and backup |
| `src/ui/` | Piano geometry and interactive piano, 2D falling-note stage, workspace shell, runtime wiring, mode and entry-point views |

Legacy modules (`src/parser`, `src/theory`, `src/playback/scheduler.ts`, `src/midi/buildMidiFile.ts`,
`src/notation`, `src/ui/components`) are unchanged and wrapped by adapters.

## Chord text format (still supported)

One event per line: `<chord_symbol> [| duration_measures]`; blank lines and `#` comments are
ignored; rests are `NC` / `N.C.`. Supported symbols: triads (maj, m, dim, aug, sus2, sus4),
6ths, 7ths (7, maj7, m7, dim7, m7b5/ø, m(maj7)), 9/11/13 families, add tones, alterations
(b5, #5, b9, #9, #11, b13), slash bass. Text export discloses what it cannot represent
(per-chord voicings, key, titles).

## Content status

All shipped lessons, exercises, charts, and routines are **drafts** awaiting pianist and teacher
review; the Learn catalogue flags them. Nothing is marked reviewed. Fingering is shown only for
reviewed key/pattern combinations. Charts are original compositions; imports stay local.

## Known limitations

- Verified in this iteration only with an offline harness (syntax, imports, pure-logic tests);
  type-check, lint, Vitest, build, browser, and hardware checks are still to be run.
- No pianist/learner review, no device matrix, no AP-470 physical test yet (see E21).
- Drop-2/quartal voicings, MIDI import, the general recipe builder, and ear-training games are
  deferred (M6).
- Recorder: one take at a time (no overdub/multitrack), fixed tempo per take, pickups during a
  count-in are not captured, recordings are not part of the backup file; browser/hardware
  verification pending (`docs/verification/midi-recorder-checklist.md`).
