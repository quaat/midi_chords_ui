# MIDI Chords UI — Piano Learning Studio

**Proposed redevelopment plan · 4 November 2026 · Revision 2**  
Repository: [quaat/midi_chords_ui](https://github.com/quaat/midi_chords_ui)  
Visual reference: [quaat/lumina](https://github.com/quaat/lumina)

## 1. Product direction

Rebuild the experience as a practical music-learning studio, centred on a playable piano and a repeatable learning cycle: **read → hear → explore → play → vary → apply in music → review**. Connect explanations, exercises, routines, and song charts through the same musical material. Chord entry and MIDI export remain valuable creation tools. Falling notes are one practice view alongside chord charts, notation, and a static keyboard.

The application should serve three overlapping groups:

- A beginner learning keyboard geography, intervals, triads, inversions, and simple rhythms.
- An intermediate pianist connecting scales, chords, progressions, and both hands.
- An advanced learner developing harmonisation, reharmonisation, modal playing, voicing choices, accompaniment, and improvisation.

Beginner, intermediate, and advanced describe entry pathways and the demands of individual tasks. Track abilities by topic rather than assigning one global level: someone can read notation well and still be new to chord charts. Include foundational classical, pop, blues, and jazz applications as reviewed content grows; the first release does not claim comprehensive coverage of all these traditions.

**Recommended approach:** reimplement the interface and practice runtime inside the existing repository, while retaining and improving the useful musical and export modules. Keep React and TypeScript, retain the existing static deployment initially, and review framework/dependency upgrades in M0. A framework migration is optional and must solve a demonstrated problem; it should not delay the learning experience.

Build a complete, small learning product before a comprehensive theory encyclopedia. The first private alpha should already let someone hear a progression, see notes approaching the piano, and practise it with useful feedback. The first public release must also demonstrate connected theory lessons, scales/modes, practice routines, basic harmonisation, and a small playable chart collection. Comprehensive advanced courses, arbitrary repertoire import, and elaborate harmony tools can follow.

**Revision 2 scope:** incorporates practical musicianship from beginner through advanced levels, warm-ups and technique exercises, modes and scale runs, harmonisation, and song-chart play-along. E01–E26 retain their IDs; E27–E31 add bounded learning-beta capabilities. The repository observations below retain their original inspected commits; this revision did not re-inspect or modify repository code.

This is a planning deliverable. Milestones and issue IDs below are proposed, not objects created in GitHub. No application code, repository settings, or deployments were changed.

## 2. What exists today, and what to reuse

### Review basis

Source inspection used `midi_chords_ui` main at [`c6d043a`](https://github.com/quaat/midi_chords_ui/tree/c6d043a9860f16112d26a21936ad2b8e9125fe19) and `lumina` main at [`61686b3`](https://github.com/quaat/lumina/tree/61686b3dd37797cdc6e4f373f40d29cc24df02fc). Findings below come from code and repository documentation, not a live usability study. Builds, tests, deployed behavior, and physical MIDI devices were not exercised for this plan.

| Area | Observed implementation | Recommendation |
|---|---|---|
| Application | Next.js 14.2.15, React 18.3.1, TypeScript; browser-only workflow and GitHub Pages export | Retain the deployment model for the first release; audit and update dependencies deliberately |
| Chord language | Text parser, broad chord-symbol support, rests, fractional measure durations | Preserve text compatibility and error reporting behind a richer structured editor |
| Voicing | `close`, `open`, `spread`, `root5_3up`; range controls and a nearest-note voice-leading heuristic | Replace the implementation with explicit voicing families, musical roles, constraints, and explanations |
| Composition | Progression samples and six deterministic Chord Pathways transformations | Preserve as creation features; add explanation, preview, and undo |
| Piano | Passive SVG keyboard, MIDI 36–96, shown only in a preview tab | Replace with a persistent interactive piano sharing geometry with falling notes |
| Playback | Tone.js synth, Web MIDI output, transport, looping, seek, arpeggiation | Preserve behavior through adapters; introduce a shared note timeline and explicit clock mapping |
| Views/export | Chord timeline, lead sheet, MusicXML generation/OSMD display, MIDI export | Keep available; reconcile them with the new musical model and actual performed notes |
| MIDI learning | Output routing exists; no learner-input/evaluation flow in the inspected studio | Add input, pedal state, source separation, step practice, timed practice, and device recovery |
| Lumina | Canvas 2D/3D renderer, shared `KeyLayout`, range controls, MIDI input highlighting | Extract or adapt small useful parts; do not import the entire application |
| Tests/CI | Vitest suite and a workflow running lint, tests, build, and Pages deployment | Preserve and extend with musical fixtures, replayed MIDI events, and browser journeys |

### Implications from the inspected code

1. **Existing voicing modes are not a teaching taxonomy.** They primarily transform octave placement. They do not describe which chord degrees are essential, which tones are omitted, what each hand should play, or why a particular shape fits a progression.
2. **Range handling needs stronger invariants.** `clampToRange` can return a literal range boundary when no octave-equivalent pitch fits. A teaching engine must never silently change pitch class to satisfy a range constraint; return no valid candidate or explain a deliberate alternative.
3. **Spelling needs to carry musical meaning.** `midiToNoteName` uses sharp names by default. Playback pitch alone cannot preserve distinctions such as a chord's third versus an enharmonically equivalent note with another role.
4. **Playback and visual feedback need note-level agreement.** The scheduler can play arpeggiated note events while active-note callbacks report the entire chord. A falling-note teacher needs actual onsets and durations, shared with audio, export, and evaluation.
5. **Notation exists already.** The README's final “next steps” section is partly stale: MusicXML generation and OSMD display are implemented. Do not budget these as entirely new capabilities.
6. **Lumina's naming differs from the proposed feature.** Its `classic` mode is the 2D falling-note view; its `highway` mode is a perspective projection. Use the 2D geometry/rendering ideas for this project. `index.tsx` imports the root `App.tsx`; duplicated files under `src/` should not be assumed to be the active implementation.

These are reasons for the proposed architecture, not a complete defect audit. M0 establishes the runnable baseline and captures exact regression cases.

## 3. The user experience

### Three modes, one piano

| Mode | Main activity | Typical action |
|---|---|---|
| **Explore** | Discover chords, intervals, scales, inversions, and voicings | Select a chord, hear alternatives, inspect degrees, then send it to practice |
| **Practice** | Follow a lesson or rehearse a chosen idea | Listen, play without time pressure, then repeat with tempo and reduced hints |
| **Create** | Assemble progressions and experiments | Edit chord blocks or text, compare voice leading, save, practise, and export |

All modes use the same session, piano, note labels, sound settings, and selected musical material. Switching mode should not recreate the piece or lose edits.

### Layout priorities

- **Main stage:** a wide piano anchored at the bottom of the central area. Above it: falling notes in Practice, chord/scale comparisons in Explore, and a compact editable progression in Create.
- **Current and next:** a clear current chord, next chord, beat position, and one short learning prompt near the piano.
- **Context panel:** a collapsible lesson/voicing panel explaining the selected notes and offering A/B listening. Advanced settings stay out of the initial view.
- **Transport:** always reachable play/pause, stop, tempo, count-in, loop region, metronome, and “Play it for me”. Input/output status belongs here or in a compact device panel.
- **Labels:** switch between note names, chord degrees, scale degrees, suggested fingers, or none. Fingering is authored advice when available, not something inferred from MIDI.
- **Visual states:** distinguish target notes, the learner's held keys, sustained sound, and demonstration/accompaniment. Use outlines, shapes, and labels as well as color.
- **Focus mode:** large piano and optional falling notes with minimal surrounding controls. Provide a static step view and reduced motion.
- **Learning and repertoire entry points:** a searchable Learn catalogue, a My Practice queue, and a Songs collection open material into the existing Explore/Practice/Create workspace. These are content entry points, not competing piano runtimes. A concept page offers explanation, audio comparison, a direct practice action, and related song passages.
- **Practice views:** switch between falling notes, a static keyboard, notation when available, and a bar-based chord chart without changing the musical session. Chart-only playing and reduced hints are deliberate learning goals.
- **Small screens:** show a usable, adjustable pitch range; do not squeeze 88 keys into an unplayable strip. Landscape/tablet practice is a primary target; phones still support exploration and step exercises.

Use a restrained, readable visual style: strong key contrast, clear timing, minimal animation. Visual polish should make notes easier to follow. Preserve notation as an optional learning aid and offer a gradual route from highlighted keys to chord symbols and staff reading.

### First-session example

1. Start without registration; choose “I am learning chords” or “I already play and want better voicings”.
2. Choose a connected MIDI keyboard, touch/computer keyboard, or listening-only exploration.
3. Hear a short progression with notes and chord degrees highlighted.
4. Try one chord in step mode; receive a concrete hint such as “The seventh is missing”.
5. Play the progression slowly with a count-in and falling notes.
6. Repeat one difficult change, then try with fewer visual hints.

An acoustic pianist can listen and follow prompts, but cannot receive automatic pitch/timing scores without a supported input source. Microphone transcription is outside the first release.

### Curriculum connected to action

The catalogue should be useful both as a reference to revisit and as a guided course. Every taught unit declares a learner outcome, prerequisites, a short explanation, an audible example, a playable task, suitable feedback, a variation, and a musical application. Provide searchable terms and cross-links such as interval → chord degree → inversion → voice leading → song passage. External reading supplements the authored lesson; a dead external link must not disable practice.

| Strand | Beginner tasks | Intermediate tasks | Advanced direction |
|---|---|---|---|
| Keyboard, reading, rhythm | Locate notes; read short patterns; keep pulse; play and count rests | Read chord symbols and slash bass; syncopation; coordinate hands | Independent rhythms, changing meter, stylistic articulation and comping |
| Scales and modes | Major/minor patterns, degrees, short runs | Scale sequences, arpeggios, parallel-mode comparisons, modal vamps | Contextual modal choices, melodic-minor applications, chromatic approach patterns |
| Harmony and voicing | Construct triads; choose inversions; play simple cadences | Sevenths, shells, guide tones, basic harmonisation, accompaniment patterns | Rootless/drop-2/quartal families, melody-led voicing, substitutions and reharmonisation |
| Warm-ups and technique practice | Reviewed five-note patterns and slow coordination exercises | Multi-octave scales/arpeggios, contrary motion, articulation and dynamic patterns | Larger register changes, inner-voice emphasis, rhythmic displacement and texture-specific studies |
| Listening and creativity | Compare sounds; imitate a short phrase | Hear chord quality and modal contrast; answer a phrase | Transcription exercises, harmonic alternatives, constrained and free improvisation |
| Songs and application | Play roots or block triads from a short chart | Choose inversions, add patterns, loop changes, transpose | Comp using permitted voicings, vary texture, reharmonise and explain choices |

This is a coverage map, not a promise to ship every cell in M4. Section 9 defines the first-release evidence set. Difficulty depends on tempo, key, register, pattern, hands, hints, and musical context as well as the topic name. Prioritise reviewed examples with a route to transfer; an automatically transposed drill is not evidence that every fingering remains suitable.

### Four connected learning workflows

**Modes:** read a short explanation, hear two modes over the same tonic, highlight the changed degree, play each pattern, and use it in a phrase over a compatible vamp. For example, compare D Dorian with D natural minor: B natural versus B-flat changes the sixth while the tonic remains D. Preserve that tonal centre in the demonstration. Also explain relative relationships, without presenting a starting-note rotation alone as the whole musical meaning of a mode. [S10]

**Harmonisation:** distinguish harmonising a scale into chords from choosing harmony for a melody. Begin with constructing diatonic triads, then offer a short authored melody, a bounded chord palette, and a declared harmonic rhythm. Let the learner hear, choose, play, and compare multiple solutions. Explain bass movement, chord roles, melody relationships, and cadence choices. Advanced work can include non-chord tones, substitutions, and changed harmonic rhythm. State the style assumptions; part-writing conventions from one tradition are not universal rules for every song. [S11]

**Routines:** let a learner assemble a short session from warm-up, scale/technique work, a theory application, and a song passage. Controls include key sequence, range, tempo, rhythmic pattern, hand/part, repeats, and visual assistance. Offer bounded presets before a general recipe builder. Progression to faster tempos is user-controlled, with optional transparent suggestions. Report observable timing, velocity, articulation, and coordination patterns; fingering, posture, tension, and physical technique remain unobserved by MIDI.

**Song practice:** open a chart, hear a selected accompaniment, inspect a chord, practise a difficult transition, and return to the same place in the song. Support simple and richer arrangements of the same chart. The learner can move from a demonstrated arrangement to permitted alternative voicings, then to chart-only free comping. A short authored composition can connect several lessons without needing a commercial song catalogue.

## 4. Musical and technical design

### Separate meaning, performance, and evidence

| Concept | Responsibility |
|---|---|
| `ChordDefinition` | Root, quality, spelled chord degrees, extensions, alterations, and explicit bass where present |
| `HarmonicContext` | Key, progression position, functional interpretation, style, and accompaniment assumptions |
| `VoicingRecipe` | Supported qualities; required/optional/omitted roles; register, spacing, hand, and melody constraints |
| `VoicingInstance` | Concrete pitches, spelling, hand assignments, voice identities, and explanation of choices |
| `MusicalSequence` | Stable event IDs, chord context, durations in musical time, tempo/meter information, and arrangement choices |
| `PerformanceTimeline` | The actual note onsets/releases and accompaniment parts used by playback, visualization, and MIDI export |
| `InputEvent` | Source, port/channel, pitch, velocity, timestamp, note on/off, and pedal changes from the learner |
| `ExerciseDefinition` | Objective, prerequisites, material, permitted answers, hints, timing policy, and completion rules |
| `AttemptResult` | Pitch/timing observations and evidence tied to exercise/content/scoring versions; never a claim about unobserved technique |
| `ConceptDefinition` / `LearningPath` | Searchable concept, level/demand tags, prerequisites, explanations, examples, linked exercises, applications, and review metadata |
| `ScaleDefinition` / `PatternRecipe` | Tonic-relative spelled degrees and an explicit ordered/rhythmic pattern; optional reviewed fingering variants, range, and hand constraints |
| `SongChart` | Structured sections, bars, meter, pickups, chord spans, repeats/endings where supported, provenance, and an explicit performance order |
| `ArrangementDefinition` | Concrete or rule-generated learner/accompaniment parts, rhythmic choices, register/voicing settings, and the permitted-answer policy for a chart |
| `PracticeRoutine` | Ordered, resumable exercise/song references with per-item settings, duration/repeat targets, and versioned progress links |

Keep core theory and evaluation as deterministic TypeScript modules independent of React. Use adapters around existing parser/export code. A single app is sufficient; this does not require microservices, a backend, or a published shared package.

### Voicings that can be taught and explained

Initial families: triads and seventh-chord inversions, close/open arrangements, three-note shells, two-note guide-tone exercises, and curated rootless variants for supported chord qualities. Explicitly define every recipe; A/B naming differs between teaching traditions.

Later families: drop-2, quartal, upper structures, altered-dominant colors, and melody-constrained two-hand arrangements. Introduce them only with reviewed examples and supported contexts.

The engine must:

- Separate chord identity from the notes chosen for a voicing. A rootless shape does not change the intended root; its isolated pitch set may have several possible chord interpretations.
- Distinguish inversion, spacing, register, and voicing family. Do not call every octave rearrangement an inversion.
- Preserve musically appropriate spelling, including double accidentals when required by supported definitions. MIDI numbers alone are insufficient.
- Respect explicit slash bass, required thirds/sevenths where applicable, hand spans, note counts, register, and a fixed melody note when requested.
- Make omissions and added colors visible. An exercise requiring a shell should not require the fifth; a rootless exercise should not fail because the learner did not play the accompaniment's root.
- Return an explanation when constraints cannot be met. No silent pitch mutation, hidden note deletion, or claims that every generated shape is comfortable for every hand.
- Rank valid candidates using voice continuity and playability; make style preferences adjustable and keep multiple musically reasonable options.

For automatic chord recognition, show contextual candidates or ambiguity. A selected exercise already supplies harmonic context; free exploration often does not. Ordinary MIDI does not reveal fingering, physical hand use, posture, or tone quality.

### Timing and input

Use musical time as the authored source of truth and derive real-time scheduling from it. Web Audio's `currentTime` and MIDI/high-resolution performance timestamps need an explicit mapping; they are not interchangeable clocks. The renderer reads the transport position and never determines when a note should sound. [S7–S9]

Use one normalized performance timeline for block chords and arpeggios. Preserve cancellation and retrigger behavior when pausing, seeking, looping, editing, switching output, or restarting. Bound lookahead; do not let scheduled notes from an old session leak into the next one.

Maintain separate states for physically pressed keys and sustained sound. Handle note-on with zero velocity as note-off, CC64 sustain, channel/port identity, disconnection, and panic/all-notes-off behavior. Demonstration audio and accompaniment must never count as learner input. MIDI echo and input monitoring need explicit routing controls.

Web MIDI requires a secure context and has incomplete browser availability. Detect capability and permission, provide clear recovery, and support exploration/step practice with touch or computer keys. Verify real browser/OS/device combinations during M5 rather than promising blanket support. [S7–S8]

### Learning and assessment

Start with **step practice**: the exercise waits for an acceptable answer. Then add **timed practice** with a count-in, adjustable onset window, slow tempo, and looped changes. Choose an explicit policy per exercise: exact voicing, required chord roles with allowed omissions, pitch-class matching, or listening/self-assessment.

Give a short chord-assembly window so slightly staggered fingers are not treated as several wrong chords. Test repeated chords, released/retriggered notes, rests, pedal-held notes, and overlapping answers. Measure pitch and timing separately; make duration/pedal grading optional. Exclude unobservable dimensions from scores.

Reduce visual hints over time, mix retrieval with demonstrations, and test transfer to another key or a new progression. Suggested review is based on transparent local history. The first version does not need an AI tutor or machine-learning model.

Use three assessment contracts across the product:

- **Reproduce:** assess the authored notes and timing of a specific scale run, rhythm, voicing, or arrangement.
- **Satisfy constraints:** assess declared harmonic roles, melody/bass constraints, register, or target beats while accepting multiple valid responses. Identify required and optional observations explicitly.
- **Explore and reflect:** record/replay and annotate choices without inventing a single correctness score for unrestricted harmonisation or improvisation.

Do not score a chord chart as though it contained a complete piano arrangement. A symbol specifies harmony but leaves many voicing, register, rhythm, and texture choices open. Exact falling-note targets require an authored or generated arrangement selected by the learner. Separate chart, arrangement, and exercise IDs in attempts. Empty response windows in free comping are not automatically missed notes; an exercise must first declare the expected rhythmic task.

Keep repeat occurrences distinct from source chart bars. Expanding a repeated section creates unique performance-occurrence IDs so playback, highlighting, loops, missed-note attribution, and session review refer to the same pass. Pause, seek, and tempo changes invalidate scheduled events using the existing transport contract.

### Song charts and accompaniment

Start with an editable bar grid and versioned JSON import/export, plus the existing chord-text route for representable material. Support section labels, chord durations, rests, slash bass, meter, transposition with appropriate spelling, count-in, section loops, and an active bar/beat cursor. A written repeated section may be expanded into an explicit order in v1; unsupported repeat notation must be rejected or explained rather than guessed. Keep Roman-numeral analysis optional, contextual, and editable.

Use a small number of deterministic accompaniment patterns compiled into the shared performance timeline: initially sustained chords or a simple bass-and-chord pattern with a metronome. Allow the learner part to be muted independently. Accompaniment cannot count as learner input. Recorded backing-track synchronisation, arbitrary audio tempo changes, arbitrary PDF/OCR import, and automatic song transcription are later proposals.

Give supplied charts and arrangements separate provenance and reuse metadata. Begin with original compositions and other individually cleared material; keep personal imports local under the initial persistence model. Song publishing, third-party catalogue integrations, and community sharing need their own scoped decisions. Do not assume that finding a chart online authorises copying it into a bundled catalogue.

### AP-470 reference-device acceptance

Use the user's Casio Celviano AP-470 as one named hardware test target: USB Type-B connection, device enumeration, note-on/off, velocity, pedal events, Local Control, and reconnect behaviour. Casio documents USB MIDI and the applicable MIDI implementation. [S12] Record the actual OS, browser, firmware if available, connection route, and observed device name; support remains unverified until that physical test occurs. Baseline practice should allow the piano's local sound while the app observes MIDI, without echoing each input back to the instrument. Preserve raw timestamped input and calibration settings for replay; state the limits of latency estimates and avoid equating event receipt with physical key motion.

### Persistence and compatibility

Store projects, preferences, and practice history locally with versioned schemas and explicit JSON export/import. Keep the existing chord-text format as a supported import/edit route. Richer voicings and lessons need a richer project format; text export must disclose what it cannot represent.

MIDI export should reflect the selected performed arrangement. MusicXML/notation must declare whether it shows a harmonic reduction or the exact arrangement, and should not silently suggest that a chord block is the performed arpeggio. Preserve the current notation/export capabilities while bringing them into the new model.

## 5. Milestones and release gates

The issue IDs are stable planning IDs. Each represents an epic-sized issue to refine into smaller implementation issues and reviewable PRs. Milestones describe demonstrable outcomes, not just completed components.

| Milestone | Outcome | Proposed issues | Dependencies and exit gate |
|---|---|---|---|
| **M0 — Baseline and product contract** | Agreed learning scope, verified current behavior, and a reviewable piano-first design | E01–E03 | First. Baseline evidence, musical examples, UX flows, and model contracts accepted |
| **M1 — Musical core** | Explainable chords, voicings, and voice leading | E04–E07 | M0 contracts. Reviewed examples transpose correctly and constraints preserve musical meaning |
| **M2 — Piano workspace** | A usable Explore/Create application with input, playback, and saved projects | E08–E11 | UI can begin after M0; integration uses M1 contracts. End-to-end chord exploration and creation work |
| **M3 — Guided playing alpha** | Falling notes and useful step/timed practice | E12–E15 | M1/M2 interfaces. A learner can complete and review a short exercise on a physical keyboard |
| **M4 — Learning beta** | Connected lessons, scales/modes, routines, harmonisation, and song-chart practice, with local progress | E16–E19, E27–E31 | Authoring can start after M0; integration uses M3. The bounded evidence set in section 9 works across three entry pathways |
| **M5 — Release readiness** | Reliable, accessible first public release | E20–E22 | Runs alongside M3/M4; release follows their gates. Browser/device evidence, regression checks, and pilot fixes accepted |
| **M6 — Theory playground expansion** | Deeper advanced courses, creative tools, repertoire import, and flexible recipe authoring | E23–E26 | Optional after first release; extends the basic modes/routines/harmonisation/charts already shipped in M4. Each epic ships independently |

**Release boundaries:** M2 is an exploration preview, M3 is a private practice alpha, M4 is the learning beta, and M5 is the first public learning release. M6 must not block that release.

The main dependency chain is shared musical contracts → correct notes and timing → reliable learner input → useful feedback → curriculum validation. UI exploration and content drafting can proceed alongside core work once those contracts are stable. Avoid developing competing schedulers or separate chord models in different features.

Sequence M4 internally: first the lesson/catalogue contracts and a foundation unit; then scale/routine and chart adapters; then basic harmonisation and a complete cross-topic journey. E27–E30 share the existing practice runtime. E31 integrates the finished paths. The minimum presets ship in M4; the general-purpose combination builder stays in E26 so it does not block early lessons.

## 6. Proposed large issues

### M0 — Baseline and product contract

#### E01 — Establish the baseline and migration inventory

**Problem:** a complete redesign can lose useful existing features or preserve accidental behavior without noticing.

**Scope:** run the current application and checks; inventory parser examples, notation, exports, progression transformations, transport behavior, and device handling. Capture representative desktop/tablet states. Audit dependency versions, deployment assumptions, and provenance of any Lumina code/assets proposed for reuse. No root LICENSE file appeared in either inspected tree; settle reuse terms before copying implementation or assets.

**Acceptance:**

- [ ] Baseline commands, results, known failures, and preserved behaviors are recorded against a commit.
- [ ] A feature migration matrix identifies retain/rework/retire decisions and compatibility fixtures.
- [ ] Repository/dependency/content reuse decisions and the static deployment baseline are recorded.

**Depends on:** none. **Refinement:** baseline run; compatibility fixtures; dependency/reuse audit.

#### E02 — Design and validate the piano-centred learning experience

**Problem:** the current preview tabs hide the instrument and put composition controls ahead of learning.

**Scope:** design Explore, Practice, and Create around one persistent piano; onboarding, no-device flow, focus mode, accessible feedback, and responsive layouts. Define a beginner and a voicing learner journey. Create a clickable design/prototype sufficient to test navigation and reading load.

**Acceptance:**

- [ ] A learner can find, hear, inspect, and practise a chord without moving through unrelated preview tabs.
- [ ] Desktop, tablet landscape, and narrow-screen designs preserve usable keys and accessible controls.
- [ ] Brief sessions with representative learners identify comprehension problems before UI implementation.

**Depends on:** E01 inventory; can overlap its technical audit. **Refinement:** flows; design system; prototype validation.

**Revision 2 extension:** validate Learn, My Practice, and Songs entry points into the shared workspace. Include beginner, intermediate, and advanced entry tasks, a concept-to-exercise transition, and chart-only practice. The persistent piano must not force the full moving-note view during reading or chart work.

#### E03 — Define shared musical, session, and timing contracts

**Problem:** independent feature work will diverge if chord identity, concrete voicing, timeline, and attempts are represented inconsistently.

**Scope:** specify the models in section 4, module boundaries, event/source identities, clock mapping, persistence versions, and adapter boundaries. Choose the smallest viable state-management approach. Document the framework/dependency decision and the incremental replacement route.

**Acceptance:**

- [ ] One chord-to-exercise example traverses every model without losing spelling, hand roles, or event identity.
- [ ] Audio, visualizer, MIDI export, and practice consume a shared performed-note representation.
- [ ] Architecture decisions state the migration sequence and how the current app remains usable during redevelopment.

**Depends on:** E01 and E02 direction. **Refinement:** musical schema; transport/input contract; persistence/migration ADR.

**Revision 2 extension:** define minimal concept, scale-pattern, chart, arrangement, and routine contracts now. Demonstrate that a chart is separate from its concrete note arrangement, that repeated bars retain unique performance occurrences, and that exact/constraint/free assessment policies are distinguishable. Use one short chart fixture without implementing an entire catalogue.

### M1 — Musical core

#### E04 — Build a spelling-aware music model and compatibility parser

**Problem:** pitch classes and display strings are insufficient to teach chord construction and notation accurately.

**Scope:** implement spelled notes, intervals/degrees, chord definitions, key context, transposition, and stable event IDs. Adapt the existing parser, preserving accepted inputs and diagnostics. Support the accidental vocabulary needed by the declared chord/key catalogue.

**Acceptance:**

- [ ] Legacy progression fixtures parse with their documented semantics and useful error locations.
- [ ] Transposition preserves interval roles and appropriate spellings across the supported keys.
- [ ] Invalid/unsupported symbols fail explicitly; enharmonic equality does not erase semantic distinctions.

**Depends on:** E03. **Refinement:** types/spelling; parser adapter; transposition and musical fixtures.

#### E05 — Implement explorable chord, interval, and inversion operations

**Problem:** users need to understand and manipulate chords before memorising voicing presets.

**Scope:** provide interval construction, triads, sevenths, supported extensions/alterations, inversion operations, and explanatory note roles. Separate a chord's root from its actual bass. Expose these operations to a chord inspector and exercise generator.

**Acceptance:**

- [ ] Changing a third, seventh, or inversion produces the expected sound/pitches and a clear explanation.
- [ ] Degree labels remain correct for suspended, diminished, altered, and slash chords in the supported catalogue.
- [ ] Review fixtures cover both simple beginner chords and nontrivial spelling/bass cases.

**Depends on:** E04. **Refinement:** construction APIs; inversion/bass semantics; inspector data.

#### E06 — Implement the first teachable voicing families

**Problem:** octave-shifting modes do not provide a reliable shell/rootless vocabulary or explain how to play it.

**Scope:** implement explicit close/open, shell, guide-tone, and curated rootless recipes; per-hand/register constraints, optional bass accompaniment, degree explanations, and candidate comparison. Keep advanced families for E23. Include teacher-authored fingering hints only where reviewed.

**Acceptance:**

- [ ] Every offered recipe declares its supported qualities, required/optional tones, hand allocation, and context.
- [ ] Generated shapes obey constraints or return a useful “no valid voicing” result without changing pitch class.
- [ ] Examples in several registers and all supported transpositions are checked by fixtures and musical review.

**Depends on:** E04–E05. **Refinement:** recipe catalogue; constraint engine; audition/inspection integration.

#### E07 — Add explainable voice leading across progressions

**Problem:** moving each note toward nearby pitches can collapse voices or violate bass, melody, and hand constraints.

**Scope:** rank valid voicing sequences using voice identities, movement, common tones, hand spans, and optional bass/melody locks. Show which voices stay or move. Bound the search, use deterministic tie-breaking, and allow users to choose alternatives.

**Acceptance:**

- [ ] Representative progressions retain required roles and locks while producing playable, reviewed transitions.
- [ ] “Why this choice?” explains the relevant movements; alternate candidates can be auditioned.
- [ ] Unequal voice counts, rests, impossible ranges, and repeated chords have defined behavior and test coverage.

**Depends on:** E06. **Refinement:** ranking/search; transition explanation; edge cases and performance limits.

### M2 — Piano workspace

#### E08 — Build the persistent interactive piano and workspace shell

**Problem:** the keyboard is currently a passive preview and cannot be the main learning surface.

**Scope:** implement shared piano/lane geometry, interactive keys, responsive ranges, note/degree labels, source-specific highlights, focus mode, and Explore/Practice/Create navigation. Reuse Lumina's geometry ideas after E01's audit. Keep high-frequency drawing out of application-wide React updates.

**Acceptance:**

- [ ] The piano stays available during chord exploration, editing, and practice, with keyboard-accessible controls.
- [ ] Key/lane alignment works across ranges, resizing, zoom, and display densities, including black-key boundaries.
- [ ] Touch, mouse, and computer-keyboard interaction release notes reliably on cancellation or loss of focus.

**Depends on:** E02–E04. **Refinement:** geometry/input surface; workspace shell; responsive/accessibility behavior.

#### E09 — Add robust learner MIDI input and device routing

**Problem:** MIDI output alone cannot observe a learner, and naive note tracking breaks with pedals, reconnects, or echo.

**Scope:** input/output selection, explicit connect/permission flow, normalised input events, per-port/channel held and sustained states, monitoring options, hot-plug, and panic/recovery. Reuse small reviewed Lumina MIDI concepts where useful; preserve current output regression cases.

**Acceptance:**

- [ ] Replay fixtures cover note-off variants, CC64, repeated notes, disconnects, and changing selected devices.
- [ ] Learner, demonstration, and accompaniment sources remain separate; echo cannot manufacture correct answers.
- [ ] A real MIDI keyboard can connect and recover, while unsupported/denied MIDI still leaves a usable fallback.

**Depends on:** E03; integrates with E08/E10. **Refinement:** event adapter; routing/lifecycle; hardware smoke evidence.

**Revision 2 extension:** include the AP-470 reference-device case from section 4. Preserve raw note/pedal events and observed timestamps for later replay. Add sostenuto/soft pedal capture when present; sustain-aware grading and any other pedal grading require explicit policies. Software fixtures alone do not establish physical device compatibility.

#### E10 — Unify playback, transport, and the performance timeline

**Problem:** timing disagreements make falling notes and learning feedback misleading.

**Scope:** compile exact performed notes, including arpeggios; implement clock mapping and audio/output adapters; count-in, metronome, loop regions, tempo changes, pause/resume, seek, and cancellation. Retain an immediate synth fallback; add a licensed piano sound only within an explicit loading/size budget.

**Acceptance:**

- [ ] Audio, keyboard highlighting, MIDI export, and later falling notes consume the same note schedule.
- [ ] Pause, stop, seek, loop, tempo/output changes, and repeated pitches do not leave stale or stuck notes.
- [ ] Clock behavior and cancellation have deterministic tests; real-device latency is measured separately from internal scheduling correctness.

**Depends on:** E03–E04; voicing integration E06. **Refinement:** timeline compiler; transport/clocks; audio/device adapters.

#### E11 — Rebuild progression editing and save/reopen workflows

**Problem:** the learning app still needs a practical way to create musical material and preserve work.

**Scope:** chord blocks and text editing, per-chord voicings, duration controls, undo/redo, pathway previews, saved projects, versioned JSON import/export, MIDI export, and existing notation views. Keep edit and practice versions identifiable so changes do not corrupt a running attempt.

**Acceptance:**

- [ ] A legacy text progression can be opened, edited, saved, reopened, played, and exported.
- [ ] Text/block transitions preserve representable information and disclose richer features that text cannot encode.
- [ ] Saved projects migrate predictably; corrupt/unsupported files fail safely; notation states its relationship to the performed arrangement.

**Depends on:** E04–E06, E08, E10. **Refinement:** editor/undo; local persistence; export/notation adapters.

### M3 — Guided playing alpha

#### E12 — Implement the simple 2D falling-note stage

**Problem:** learners need to anticipate what to play while keeping notes aligned with the real keyboard layout.

**Scope:** Canvas 2D falling notes using E08's geometry and E10's timeline; strike line, duration bars, beat grid, hand/role labels, zoom, clipping, range controls, and optional learner traces. Adapt Lumina's 2D approach without its 3D projection and effects stack.

**Acceptance:**

- [ ] Notes arrive at the corresponding keys at their scheduled onset and display the intended duration.
- [ ] Pause, seek, looping, tempo changes, resizing, and device-pixel-ratio changes preserve alignment.
- [ ] Dense passages stay responsive on the agreed reference device; static/reduced-motion practice is available.

**Depends on:** E08 and E10. **Refinement:** renderer; transport integration; visual/performance verification.

#### E13 — Implement step practice and explicit answer policies

**Problem:** beginners need time to assemble notes and a fair definition of a correct answer.

**Scope:** exercise state machine, listen/try/retry flow, wait-for-answer mode, exact-voicing and role/pitch-class policies, assembly window, allowed extras/omissions, hint progression, and repeat-chord handling. Supply a minimal exercise contract now; E16 expands authoring and validation.

**Acceptance:**

- [ ] A learner can complete single-note, triad, inversion, shell, and rootless exercises with documented acceptance rules.
- [ ] Pedal residue, a held answer from the prior step, and accompaniment cannot advance an exercise incorrectly.
- [ ] The UI explains missing/unexpected notes and supports an accessible nonmoving view.

**Depends on:** E04–E06, E08–E10. **Refinement:** state machine; matching policies; retry/hints UI.

#### E14 — Implement timed practice with calibration and tolerances

**Problem:** timing scores are unfair when input latency, chord staggering, and device limitations are ignored.

**Scope:** count-in, timing windows, optional latency adjustment, early/late/missed feedback, loop practice, slow tempo, rest/release policies, and attempt isolation. Define pause/background-tab behavior and separate input methods in reporting.

**Acceptance:**

- [ ] Synthetic event replay produces deterministic outcomes at timing-window boundaries and loop transitions.
- [ ] Calibration and timing tolerance are visible and resettable; unsupported conditions do not imply precise assessment.
- [ ] Physical keyboard trials verify fair handling of chord staggering, repeated chords, sustain, and route changes.

**Depends on:** E09–E10, E12–E13. **Refinement:** timed matcher; calibration; session lifecycle/hardware trials.

#### E15 — Deliver actionable practice feedback and session review

**Problem:** a single percentage or a wall of red notes does not tell a pianist what to practise next.

**Scope:** separate pitch and timing feedback; identify difficult chord changes and missing roles; show replay/target comparisons; provide one next action such as a slower two-chord loop. Keep explanations tied to recorded evidence and exercise policy.

**Acceptance:**

- [ ] Results distinguish pitch, onset, and any optional duration criteria rather than mixing them into an unexplained score.
- [ ] Feedback can launch a focused retry with the original material, policy, and source settings intact.
- [ ] Unobserved fingering/technique and self-assessed attempts are never represented as measured performance.

**Depends on:** E13–E14. **Refinement:** result schema; review UI; targeted retry integration.

### M4 — Learning beta

#### E16 — Create the lesson/exercise authoring system

**Problem:** hard-coded lessons become inconsistent and expensive to maintain as theory coverage grows.

**Scope:** versioned content definitions with objective, prerequisites, example, task, accepted variants, hint ladder, feedback, transfer exercise, and linked musical application. Add concept/level/style tags, source/author/reviewer metadata, accessibility alternatives, and content validation. Support shared concept pages and multiple exercise variants without duplicating the explanation. Use repository-authored data first; a visual authoring CMS is unnecessary for v1.

**Acceptance:**

- [ ] A new lesson can be authored without changing the rendering or assessment engine.
- [ ] Validation catches invalid pitches, unreachable prerequisites, unsatisfiable answers, and missing required metadata.
- [ ] Music examples and teaching text receive separate musical review; external links are optional further reading, not runtime dependencies.
- [ ] Each shipped unit supports read/listen/play/variation/application; validation checks typed references and prerequisite cycles without requiring every concept to link to every other type.
- [ ] A content manifest identifies reviewed, draft, unavailable, and deferred units; future curriculum headings do not appear as completed lessons.

**Depends on:** E03 and E13 contract. **Refinement:** schema/validator; authoring guide; lesson/player integration.

#### E17 — Ship the foundations learning pathway

**Problem:** an app aimed only at jazz voicings excludes beginners and encourages shape memorisation without understanding.

**Scope:** a concise pathway through keyboard notes, intervals, major/minor triads, inversions, basic scales and degrees, pulse/rests, and simple diatonic progressions. Combine explanation, listening, playing, and transposition. Use original short exercises and offer optional notation.

**Acceptance:**

- [ ] Each concept has a playable task, a useful error hint, and a transfer task beyond its first example.
- [ ] A new learner can complete the opening sequence with touch/computer input or a MIDI keyboard.
- [ ] Representative learners can explain and play the taught relationship with reduced visual hints.

**Depends on:** E05, E13–E16. **Refinement:** content sequence; exercise fixtures; beginner testing.

#### E18 — Ship the harmony and jazz-voicing pathway

**Problem:** a catalogue of shapes does not teach when to use a voicing or how to move between chords.

**Scope:** sevenths, shells, guide tones, rootless variants, extensions, and major/minor cadence examples. Practise bass versus upper voices, compare voicings over the same harmony, and connect guide-tone movement to a progression. Include non-jazz application where appropriate.

**Acceptance:**

- [ ] Lessons distinguish harmonic symbol, realised notes, omitted tones, bass context, and optional color tones.
- [ ] Learners can practise a reviewed ii–V–I progression in multiple keys, then choose a valid alternative voicing.
- [ ] Assessment accepts the declared alternatives and avoids presenting stylistic preferences as universal rules.

**Depends on:** E06–E07, E13–E16. **Refinement:** curriculum/examples; progression exercises; musical and learner review.

#### E19 — Add local progress and short practice sessions

**Problem:** users need a reason to return and a useful next exercise without an account system or opaque recommendations.

**Scope:** history by concept/key, difficult transitions, user-selected goals, short session presets, transparent review suggestions, optional gentle achievements, and export/reset. Track hint level, input method, and content/scoring version with results.

**Acceptance:**

- [ ] A returning learner can resume and understand why a review exercise is suggested.
- [ ] Listening-only, assisted, step, and timed results are distinguishable; changed scoring does not silently rewrite past mastery.
- [ ] Progress survives normal reloads, exports/restores, and offers a clear recovery path when local storage is unavailable.

**Depends on:** E11, E15–E18. **Refinement:** progress model; session selection; continuity and data controls.

**Revision 2 extension:** record progress by concept and observed skill with key, tempo, hand/part selection, assessment policy, and assistance level. Separate reading completion, guided success, independent retrieval, and transfer evidence. Routine completion and time spent do not automatically establish mastery; self-reported observations stay separate from measured results. Connect E28 routines and E31 pathways once their content is available.

### M4 additions — practical musicianship and repertoire

The new IDs preserve existing references to E01–E26. Each epic below is deliberately bounded to a first usable version; later curriculum depth is delivered incrementally through M6 and content issues.

#### E27 — Build the scale, mode, and pattern practice laboratory

**Problem:** memorising ascending note lists does not connect scale structure, modal sound, pattern fluency, and musical use.

**Scope:** spelled scale/mode definitions, tonic/degree inspection, audio comparison, reviewed runs and sequence patterns, range/hand/tempo settings, and transfer to another key. Start with major, natural minor, and a Dorian comparison, with one simple run and one ordered pattern. Store pattern order and rhythmic grouping separately from the pitch collection. Use E16 lessons and E13/E14 assessment; add broader mode and pattern content after the initial contract works.

**Acceptance:**

- [ ] A learner reads a mode comparison, hears it over the same tonic, plays it, and applies it to a short phrase or vamp.
- [ ] Generated notes retain correct spelling, pattern order, durations, and register after supported transposition; impossible ranges produce useful feedback.
- [ ] Runs, rests, repeated pitches, and turnaround notes have explicit target occurrences; the matcher cannot reuse one attack to satisfy multiple notes.
- [ ] A sequence can be practised with falling notes, static cues, or notation where available; hints can be reduced.
- [ ] Fingering is shown only for a reviewed key/range/pattern combination, or clearly omitted. A pitch transposition does not silently reuse unreviewed fingering.

**Depends on:** E04–E05, E10, E13–E16. **Refinement:** definition/pattern contracts; mode comparison; first run/sequence; content and device validation.

#### E28 — Add warm-ups, technique exercises, and resumable routines

**Problem:** individual lessons do not give learners a manageable practice habit or a way to combine technical and musical work.

**Scope:** reviewed short warm-up/coordination patterns, scale and arpeggio presets, articulation/rhythm variants, and a routine queue. Provide selectable keys, hands/parts, range, tempo, repetitions, breaks, and optional metronome. Start with fixed presets and an ordered playlist; the unrestricted recipe builder remains E26. Allow users to add a song section when E30 is available.

**Acceptance:**

- [ ] A learner starts, pauses, skips, resumes, edits, and saves a short routine without losing per-item settings or earlier results.
- [ ] The first routine combines a warm-up, a scale/pattern, and a harmonic application; chart passages can be added through the same item contract.
- [ ] Feedback reports only measured outcomes such as timing spread, velocity consistency, and declared release/overlap patterns, with technique/fingering prompts clearly identified as authored guidance.
- [ ] Tempo increases are optional and reversible; completion of a fast run is not labelled proof of healthy or correct physical technique.
- [ ] Pattern and hand-span choices receive pianist review; both-hand attribution is omitted unless separately observable or explicitly configured as a task assumption.

**Depends on:** E11, E15–E16, E27 and E19's progress contract; song-item integration E30. **Refinement:** preset content; routine queue/persistence; observed feedback; learner review.

#### E29 — Teach harmonisation through construction, comparison, and playing

**Problem:** a chord catalogue does not teach how to choose chords that support a scale, melody, phrase, or musical intention.

**Scope:** two bounded activities: build diatonic triads from a selected scale; harmonise a short original melody using a reviewed chord palette and fixed harmonic rhythm. Offer audible candidates, editable choices, melody/bass constraints, and A/B playback. Convert the chosen result into a concrete arrangement for practice. Extend to freer reharmonisation through E23.

**Acceptance:**

- [ ] Learners can construct and play chords on scale degrees and see why their qualities differ.
- [ ] One melody admits at least two reviewed harmonic solutions, with explained differences and no hidden single preferred answer.
- [ ] Assessment distinguishes required constraints, optional style suggestions, and reflective judgments; a valid alternative is not marked wrong solely because it differs from a reference.
- [ ] The melody and its rhythm remain unchanged during the fixed-melody comparison; later editable-melody work must be a separate explicit action.
- [ ] The selected harmonisation opens in Practice and Create with the same chord identities, duration, and provenance. Phrase and non-chord-tone assumptions are stated.

**Depends on:** E05–E07, E11, E13–E16 and E27's scale-definition contract. **Refinement:** diatonic construction; bounded melody fixture; candidate/policy model; comparison and practice integration.

#### E30 — Deliver editable song charts and synchronised play-along

**Problem:** learners need to apply theory to complete musical forms and their own repertoire, and a chord list alone does not define playable note targets.

**Scope:** structured chart editor, original starter compositions, sections/bars/chord spans, explicit performance order, meter/count-in, transposition, active bar/beat display, section looping, and a small set of accompaniment/arrangement presets. Reuse E11 persistence and E10 transport. Provide exact-arrangement, constrained-voicing, and unscored chart-only play. Initially accept versioned JSON and supported chord text; MIDI import remains E25 and arbitrary score/audio import remains deferred.

**Acceptance:**

- [ ] A user can author or import a supported chart, save/reopen it, transpose it, and play an identified section with accompaniment.
- [ ] Two original short charts demonstrate different applications; at least one offers both a simple and a richer arrangement without altering the underlying chart.
- [ ] Chord durations, section order, pickup handling, repeated occurrences, loops, and cursor movement agree with playback; unsupported notation is diagnosed.
- [ ] Changing arrangement or assessment policy visibly changes expected tasks; a chart symbol alone does not create hidden exact-note or onset requirements.
- [ ] Part muting, stop/seek/restart, and accompaniment routing cannot create false learner hits or stale notes.
- [ ] Chart and arrangement provenance, supported format limits, and local-import behaviour are documented.

**Depends on:** E04, E06, E08, E10–E16; E19 progress integration. **Refinement:** chart/occurrence model; editor and starter content; arrangement/accompaniment adapters; play-along/policy integration.

#### E31 — Connect the reference catalogue, pathways, and musical applications

**Problem:** separate theory pages, drills, and songs can leave users unsure what to learn next or how a concept applies to music.

**Scope:** searchable Learn catalogue, topic/prerequisite map, beginner/intermediate/advanced entry routes, glossary, My Practice queue links, and song-to-concept navigation. Reuse shared concept text with activities at several demands. Present recommendations with their reason and allow users to choose another path. A lightweight self-selection/diagnostic flow is sufficient; do not infer global ability from one test.

**Acceptance:**

- [ ] A concept page launches its exercise with material/settings intact; review can return to the relevant explanation or song passage.
- [ ] All three entry routes contain at least one complete reviewed read/listen/play/transfer/application journey using the section 9 evidence set.
- [ ] A user can find content by concept, level/demand, style, and available input; draft/future content is visibly distinct or excluded.
- [ ] Reading completion, assisted play, independent performance, and transfer evidence remain distinct in progress views.
- [ ] Navigation has usable keyboard, touch, and reduced-motion flows and never resets a saved project merely because a reference page was opened.

**Depends on:** E08, E11, E16–E19 and the shipped content in E27–E30. **Refinement:** catalogue/search; shared concept view; entry routes; cross-topic learner pilot.

### M5 — Release readiness

#### E20 — Verify accessibility, responsiveness, and performance

**Problem:** visually impressive practice fails if keys are unreadable, controls inaccessible, or animation stalls.

**Scope:** keyboard navigation, touch targets, non-color feedback, reduced motion, static alternatives, screen-reader summaries, layout at zoom, rendering profiles, audio start/recovery, and asset budgets. Avoid announcing every animation frame through assistive technology.

**Acceptance:**

- [ ] Core Explore/Create/Practice flows pass the agreed keyboard, touch, zoom, and assistive-technology checks.
- [ ] Published performance evidence names device, browser, workload, and frame/scheduling measurements.
- [ ] Low-motion or low-performance settings preserve the learning objective and all essential controls.

**Depends on:** E08 onward; complete after M4 integration. **Refinement:** accessibility audit; rendering/audio profile; responsive fixes.

#### E21 — Validate musical correctness and real-device learning

**Problem:** unit tests cannot establish that the material is musically sound or that hardware practice feels fair.

**Scope:** independent musical review, device/browser matrix, long sessions, reconnect/pedal/echo tests, and a small learner pilot. Include both novice and intermediate participants. Check whether learners can transfer an idea after hiding hints, not merely complete falling-note patterns.

**Acceptance:**

- [ ] Every shipped recipe and lesson has traceable musical review and representative transposition checks.
- [ ] Named devices/browsers have recorded input, output, pedal, recovery, and timing observations.
- [ ] Pilot findings are triaged; release-blocking correctness/usability issues are fixed and rechecked.

**Depends on:** M3–M4; can start with the alpha. **Refinement:** review fixtures; hardware matrix; pilot and corrections.

**Revision 2 extension:** include advanced participants and a teacher review of the bounded harmonisation/voicing sampler. Check scale-pattern fingering metadata, multiple acceptable harmonisations, chart-to-arrangement distinction, and learning transfer into chart-only practice. Record the AP-470 result explicitly as tested or not yet tested.

#### E22 — Complete migration, release checks, and rollout

**Problem:** the new application must preserve valuable existing workflows and deploy predictably.

**Scope:** CI for types/lint/unit/integration/browser checks; representative export fixtures; production build and Pages base-path/assets; sample/content availability; dependency updates; migration guide, known limitations, and recoverable rollout. Remove obsolete implementations only after replacements pass their gates.

**Acceptance:**

- [ ] E01's migration matrix is closed or explicitly documented, including text entry, pathways, MIDI, and notation.
- [ ] Production build and deployed smoke checks pass; local project/progress migration and recovery are exercised.
- [ ] Release evidence links tested commit, checks, musical review, hardware/pilot findings, and rollback instructions that preserve newer user data.

**Depends on:** M4, E20–E21. **Refinement:** CI/regressions; migration/docs; release validation.

### M6 — Theory playground expansion

#### E23 — Add advanced voicings and a reharmonisation laboratory

**Problem:** more experienced learners need to compare harmonic choices in musical context.

**Scope:** independently introduce reviewed drop-2, quartal, upper-structure, and altered-dominant families; fixed-melody experiments; secondary dominants, tritone substitutions, and borrowed chords. Extend existing Pathways with explained before/after comparison and preserved originals.

**Acceptance:**

- [ ] Each added family declares supported contexts and offers playable, reviewed alternatives.
- [ ] A learner can hold melody or bass constant while comparing changes and hearing their effect.
- [ ] Alternatives are presented as musical choices; ambiguous analysis is labelled and changes are reversible.

**Depends on:** E06–E07, E11, E16, E18, E29–E30. **Refinement:** one family/transformation per child issue.

#### E24 — Connect ear training, rhythm, scales, and improvisation

**Problem:** keyboard patterns alone do not develop listening or expressive use of theory.

**Scope:** extend the M4 scale/mode and listening examples with a broader set of listen-and-identify/call-and-response tasks, rhythm imitation, chord-tone targeting over simple accompaniment, contextual scale/chord comparisons, and improvisation prompts. Swing is adjustable and contextual; do not encode one ratio as the definition of jazz feel. Start with constrained, assessable tasks. Basic mode lessons and routines already ship through E27/E28 and are not deferred to this epic.

**Acceptance:**

- [ ] Each activity states which dimensions are evaluated and which are creative/self-assessed.
- [ ] Hints can be removed, examples transposed, and answers heard in context.
- [ ] Improvisation is not graded solely by membership in a preferred scale; free play remains available.

**Depends on:** E10, E13–E19, E27 and E30. **Refinement:** ear games; rhythm activities; constrained improvisation.

#### E25 — Import MIDI repertoire into bounded practice workflows

**Problem:** users will want to practise material beyond authored chord progressions, but arbitrary MIDI is not a ready-made lesson.

**Scope:** local MIDI import, file/event limits, tempo/meter maps, track selection, range inspection, loop regions, and user-confirmed hand/part assignments. Keep source data and any inferred harmony separate. Start with selected excerpts; score/lead-sheet import is another future decision.

**Acceptance:**

- [ ] Supported files preserve timing and track semantics; unsupported or oversized inputs give clear diagnostics.
- [ ] Users choose the part and evaluation policy before practice; hand assignments are never silently treated as known.
- [ ] Chord inference is optional and labelled; user files remain local unless a later feature explicitly changes that contract.

**Depends on:** E10–E15, E22. **Refinement:** importer/limits; part/range UI; practice integration.

#### E26 — Build reusable practice recipes from theory dimensions

**Problem:** combining theory into practical exercises should not require a separate bespoke feature for every combination.

**Scope:** extend the M4 fixed presets and routine queue into a constrained recipe builder: concept/progression, key order, scale/pattern or voicing family, hand/part, rhythm, tempo, hint level, and acceptance policy. Combine supported dimensions and reject incompatible combinations. Save/share a portable recipe file; cloud accounts and community publishing remain separate proposals.

**Acceptance:**

- [ ] A user can build, preview, save, and practise a recipe such as shells through several keys with a fixed rhythm.
- [ ] Validation explains impossible ranges, unsupported chord/family combinations, and policies that cannot observe the requested skill.
- [ ] Exported recipes reopen deterministically with versioned content references and a readable summary.

**Depends on:** E06–E07, E11, E16–E19, E27–E28 and E30. **Refinement:** recipe model/validation; builder; portability.

## 7. A concrete first vertical slice

Use one original, short exercise to prove the architecture before expanding the catalogue:

**Task:** practise a major ii–V–I in C, first as shells, then as rootless color voicings over optional bass accompaniment.

For the rootless variation, an authored example could use:

| Harmony | Learner pitches | Roles in that harmony | Optional accompaniment |
|---|---|---|---|
| Dm9 | F3, A3, C4, E4 | ♭3, 5, ♭7, 9 | D2 |
| G13 | F3, A3, B3, E4 | ♭7, 9, 3, 13 | G2 |
| Cmaj9 | E3, G3, B3, D4 | 3, 5, 7, 9 | C2 |

These are specific proposed teaching examples, not a universal preferred voicing. Display actual color tones; do not hide the ninth/thirteenth behind an unexplained basic-chord label. Have a pianist review register, hand comfort, and lesson wording.

The slice is complete when a user can select the exercise, hear it, inspect the roles, play it in step mode, repeat it slowly with falling notes, receive one actionable observation, transpose it, and save/reopen it. Use a beginner triad exercise alongside it to ensure the architecture also works for simpler material.

The early implementation order should be E01–E03, then the minimum E04/E06/E08/E09/E10 contracts needed for this slice, followed by E12/E13. Deliver the rest of each epic incrementally; do not wait for every musical family before integrating the application.

### Next slice: a concept that becomes music

After the input/timing slice works, prove the broader product with **Dorian in practice**:

1. Open the concept page and read a short explanation with degree-labelled piano examples.
2. Compare D Dorian and D natural minor over the same D tonic; inspect the sixth-degree difference. [S10]
3. Play an authored Dorian run in step mode, then a short timed pattern with optional reviewed fingering.
4. Try a short original D-centred modal chart with an authored accompaniment that supports the lesson.
5. Choose either an exact phrase/arrangement exercise or free improvisation with recording; do not apply the scale-run scoring policy to free playing.
6. Transpose the supported exercise, reduce hints, and review pitch/timing observations separately from creative reflection.

Use a second original four-bar melody for the harmonisation journey: choose two supported chord solutions, hear both, practise the chosen arrangement, and save it as a chart. This verifies that content, generation, chart editing, and practice share data without forcing one correct artistic answer.

## 8. Refinement and development workflow

### How to turn these epics into GitHub work

- Create milestones M0–M6 and one parent issue per epic when this plan is adopted. Keep M6 explicitly optional/post-release.
- Give every issue a stable ID, milestone, priority, area, dependencies, and a link to its parent. Suggested areas: `music`, `ui`, `midi`, `audio`, `practice`, `content`, `quality`.
- Split an epic into small vertical or contract-based child issues before assigning implementation. Each child should have one demonstrable outcome, not “finish the engine”.
- Record blocking relationships explicitly. Do not start consumers of a changing interface without an agreed contract and fixture.
- Use one canonical execution plan in the repository, for example `docs/exec-plans/active/piano-learning-studio.md`, with links to the published issues. Keep progress in the repository's chosen progress file rather than duplicating status manually in several documents.

### Child issue template

1. **Context and learner outcome:** who is helped, and what changes for them?
2. **Problem:** current behavior or missing capability, with a reproducible example.
3. **Scope/non-goals:** one implementable slice and explicit boundaries.
4. **Contracts/dependencies:** musical models, UI behavior, device/timing assumptions, and prerequisite issues.
5. **Acceptance checklist:** observable results, including a representative musical fixture and failure/recovery behavior.
6. **Validation:** appropriate unit/integration/browser checks; musical or hardware review where required.
7. **Review evidence:** commit, demo or screenshots when useful, tests run, limitations, and resolved findings.

### Definition of done

- [ ] Acceptance criteria are demonstrated; changes do not silently alter musical semantics or existing supported workflows.
- [ ] Relevant automated checks pass, and regression cases target meaningful failure modes.
- [ ] Musical content/algorithms receive musical review; MIDI/timing changes receive hardware evidence where applicable.
- [ ] UI work includes keyboard/touch/responsive checks and understandable empty/error/recovery states.
- [ ] An independent code review is completed. When another coding agent implements the work, use Codex as the independent reviewer; resolve findings and re-review changed behavior.
- [ ] The PR describes resulting behavior, evidence, and remaining limits. Current-head CI is green before merge under the repository's merge policy.

Do not use one very large rewrite PR. Keep implementation branches short-lived and the default branch usable. If a temporary legacy route or feature flag is used, give it a removal issue and a concrete retirement gate.

## 9. Validation targets and scope controls

These are proposed targets to refine against actual devices in M0/M3, not measured properties of the current application.

| Risk | Evidence needed |
|---|---|
| Musical errors | Golden chord/voicing fixtures, transposition properties, impossible-constraint cases, and pianist review |
| False success/failure | Replayed MIDI streams covering timing boundaries, staggered chords, repeats, sustain, rests, and source separation |
| Timing/visual disagreement | Timestamp traces and aligned visual tests; distinguish internal scheduling from external audio/input latency |
| Poor rendering | Target smooth 60 Hz rendering on an agreed laptop; record percentile frame times under a stated dense-exercise workload and provide a reduced-effects fallback |
| Device fragility | Real input/output, pedals, disconnect/reconnect, output switching, and panic checks on named browser/OS/device combinations |
| Lost work | Versioned project/progress migrations, export/import, invalid-file tests, and recovery after unavailable/full local storage |
| Weak learning value | A small formative pilot, for example 5–8 learners across the three entry levels plus a piano teacher; observe unsupported first-use steps and transfer with hints removed; this is formative evidence, not proof of educational efficacy |
| False judgments in open tasks | Fixtures with multiple accepted harmonisations/voicings, free-play sessions without hidden note targets, and clear separation of measured and reflective results |
| Chart/timeline disagreement | Pickups, multi-chord bars, repeated sections, transposition, arrangement switching, and loop/seek fixtures with distinct performance occurrences |
| Misleading technique claims | Reviewed exercise/fingering metadata, withheld unobservable scores, and separate guidance versus recorded MIDI observations |

The first release includes the piano workspace, core chords/voicings, 2D falling notes and static/chart views, step/timed practice, three entry routes into a bounded reviewed curriculum, local projects/progress/routines, song-chart play-along, and retained creation/export workflows. An advanced entry route initially supplies a useful sampler using supported rootless voicings and alternative choices; it does not advertise a completed advanced course.

### Minimum M4 learning and application evidence

Several rows can reuse a short composition or concept; they do not require separate engines or a large lesson catalogue. Each row must connect explanation, demonstration, playing, variation, and application before release.

| Evidence unit | Required first usable scope | Main owner |
|---|---|---|
| Foundations | A concise note/interval/triad/inversion sequence with a simple cadence and reduced-hint transfer | E17 |
| Scale practice | A reviewed major/natural-minor comparison, an ascending/descending run, and one ordered sequence with key/range controls | E27 |
| Modal application | Same-tonic Dorian comparison, characteristic-degree task, and an original modal-vamp application | E27 |
| Routine | One reviewed short warm-up, one scale/pattern drill, and one harmonic application; save/resume and optional song-section item | E28 |
| Harmonising a scale | Construct, inspect, hear, and play the diatonic triads of a supported major scale | E29 |
| Harmonising a melody | One original four-bar melody with at least two reviewed supported solutions and a playable chosen arrangement | E29 |
| Advanced entry sampler | Rootless/guide-tone progression, declared permitted alternatives, and transfer to another supported key or chart passage | E18 |
| Song charts | Two original short charts, section looping/transposition/accompaniment, and simple/richer arrangements for at least one | E30 |
| Connected reference and progress | Searchable concept pages and three entry journeys connecting the above, with reading/assistance/independent/transfer evidence distinguished | E19, E31 |

Defer a broad advanced syllabus, additional modes/scale systems and technique studies beyond the reviewed set, a general exercise-combination editor, complex chart-notation import, recorded backing-track synchronisation, and community song publishing. Existing M6 epics provide the expansion route; basic modes, routines, harmonisation, and editable charts must not all be postponed there.

Defer 3D highways, microphone pitch recognition, automatic fingering assessment, a full DAW, arbitrary score import, cloud accounts, social leaderboards, generated AI lessons, and large licensed song catalogues. These can be evaluated later against concrete learning needs.

Avoid calendar commitments until M0 and the first vertical slice expose the musical-content and device-testing effort. Refine and estimate the next milestone in detail; leave later epics at the outcome level. Content authoring and pianist review are real work and must be planned alongside implementation.

## 10. Sources and how to use them

The product and architecture recommendations above are a synthesis for this repository. The external articles are references for topic selection and review, not executable specifications. Write original explanations/exercises, record sources, and review the musical assumptions. Do not bulk-copy diagrams, arrangements, audio, or paid teaching material.

| ID | Source | Contribution to this plan |
|---|---|---|
| S1 | [Jazz Tutorial — professional jazz voicings](https://jazztutorial.com/articles/chord-voicings-used-by-a-professional-jazz-pianist) | Accessible comparison of close, shell, open, and rootless approaches; inspiration for audition-and-compare activities |
| S2 | [tonebase — jazz theory overview](https://www.tonebase.co/music-blog/complete-guide-to-jazz-music-theory-a-complete-overview) | Connect harmony with lead-sheet reading, rhythm, progressions, and improvisation rather than treating voicings in isolation |
| S3 | [piano.org — theory index](https://piano.org/theory/) | Breadth of foundations, intervals, harmony, scales, voicings, and reading topics; useful for curriculum coverage checks |
| S4 | [FreeJazzLessons — harmony theory](https://www.freejazzlessons.com/harmony-theory/) | The idea of comparing harmonisations around a fixed melody note; motivates the later creative laboratory |
| S5 | [Open Music Theory — Jazz Voicings, Megan Lavengood](https://viva.pressbooks.pub/openmusictheory/chapter/jazz-voicings/) | Additional pedagogical cross-check on spacing, omissions, guide tones, and contextual voice leading. The page identifies a CC BY-SA licence with exceptions; check individual assets before reuse |
| S6 | [Lumina at the inspected commit](https://github.com/quaat/lumina/tree/61686b3dd37797cdc6e4f373f40d29cc24df02fc) | Reference implementation for 2D falling notes, piano geometry/ranges, and MIDI input/output concepts |
| S7 | [W3C — Web MIDI API](https://www.w3.org/TR/webmidi/) | Input/output events, permissions, timestamps, and device lifecycle; the retrieved document is a working draft |
| S8 | [MDN — Web MIDI API](https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API) | Secure-context requirement and current browser availability limitations |
| S9 | [W3C — Web Audio API 1.1](https://www.w3.org/TR/webaudio-1.1/) | Audio-time scheduling semantics; basis for separating transport clocks from animation |
| S10 | [Open Music Theory — Introduction to Diatonic Modes](https://viva.pressbooks.pub/openmusictheory/chapter/intro-to-diatonic-modes-and-the-chromatic-scale/) and [Diatonic Modes](https://viva.pressbooks.pub/openmusictheory/chapter/diatonic-modes/) | Tonic-relative comparisons and characteristic degrees; basis for the proposed Dorian comparison, not a complete pedagogy specification |
| S11 | [Comprehensive Musicianship — Introduction to Harmonizing a Melody](https://iastate.pressbooks.pub/comprehensivemusicianship/chapter/11-1-introduction-to-harmonizing-a-melody-tutorial/) | Reference for connecting melody, harmonic rhythm, phrases, cadence, and bass/inner-voice choices. Its stylistic part-writing rules are not universal constraints for pop/jazz activities; author original examples |
| S12 | [Casio AP-470 full user guide](https://www.casio.com/content/dam/casio/global/support/manuals/electronic-musical-instruments/pdf/008-en/w/Web_AP470-E-3A_EN.pdf) and [applicable MIDI implementation](https://support.casio.com/storage/en/manual/pdf/EN/008/PX770_midiimplementation_EN.pdf) | Documentary basis for the AP-470 USB MIDI reference case; physical compatibility and latency still require a named hardware trial |

### Repository evidence links

- [Current package and dependencies](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/package.json)
- [Studio layout and state](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/ui/components/ChordStudio.tsx)
- [Existing piano](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/ui/components/PianoKeyboard.tsx)
- [Voicing and voice leading](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/theory/voicing.ts)
- [Note spelling](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/theory/notes.ts)
- [Playback scheduler](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/playback/scheduler.ts)
- [MIDI export](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/midi/buildMidiFile.ts)
- [MusicXML generation](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/notation/generateMusicXml.ts)
- [Chord Pathways](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/src/theory/pathways.ts)
- [Deployment workflow](https://github.com/quaat/midi_chords_ui/blob/c6d043a9860f16112d26a21936ad2b8e9125fe19/.github/workflows/deploy.yml)
- [Lumina keyboard geometry](https://github.com/quaat/lumina/blob/61686b3dd37797cdc6e4f373f40d29cc24df02fc/services/KeyLayout.ts)
- [Lumina 2D/3D rendering](https://github.com/quaat/lumina/blob/61686b3dd37797cdc6e4f373f40d29cc24df02fc/components/PianoRoll.tsx)
- [Lumina entry point](https://github.com/quaat/lumina/blob/61686b3dd37797cdc6e4f373f40d29cc24df02fc/index.tsx)
