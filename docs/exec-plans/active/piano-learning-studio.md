# Execution plan — Piano Learning Studio

Canonical progress file for the reimplementation described in
`midi_chords_ui-reimplementation-plan-2026-11-04.md`. Issue IDs follow that plan. Status values:
`done` (implemented with tests), `partial` (usable but incomplete; gaps listed), `open`.

Quality gates not yet run in the authoring environment: `tsc --strict`, `next lint`, `vitest`,
`next build`, browser rendering, hardware. Only the offline harness was run (2026-11-04: 267 files
syntax-clean, 0 unresolved imports, 755 pure-logic tests passing across 74 files).

| ID | Epic | Status | Where | Gaps / notes |
|---|---|---|---|---|
| E01 | Baseline and migration inventory | done | `docs/baseline/2026-11-04-baseline.md` | Build/dev server not exercised here. |
| E02 | Piano-centred experience design | partial | `src/ui/workspace/`, `src/ui/runtime/OnboardingCard.tsx` | Implemented directly in code (three modes, entry points, onboarding, focus mode); no prototype study with learners; not rendered in a browser yet. |
| E03 | Shared contracts | done | `src/model/contracts.ts`, `docs/adr/0001-*.md` | |
| E04 | Spelling-aware music model + parser adapter | done | `src/music/` | |
| E05 | Chord/interval/inversion operations | done | `src/music/chords.ts` | |
| E06 | Teachable voicing families | partial | `src/voicing/` | Close/open/shell/guide-tone/rootless; drop-2/quartal deferred to E23. Not pianist-reviewed. |
| E07 | Explainable voice leading | partial | `src/voicing/voiceLeading.ts` | Bounded search with explanations; large progressions untested on hardware. |
| E08 | Persistent interactive piano + shell | partial | `src/ui/piano/`, `src/ui/workspace/` | Visual verification pending (no browser in authoring env). |
| E09 | Learner MIDI input + routing | partial | `src/input/` | Replay fixtures done; AP-470 physical test not performed (report template included). |
| E10 | Unified playback/transport/timeline | done | `src/timeline/`, `src/playback/transport.ts` | Real-device latency unmeasured. |
| E11 | Progression editing + save/reopen | done | `src/ui/create/`, `src/persistence/`, `src/ui/notation/` | Block/text editing, undo/redo, pathways, projects, JSON/MIDI export, notation labelled as harmonic reduction. Browser check pending. |
| E12 | 2D falling-note stage | partial | `src/ui/stage/` | Rendering performance not profiled. |
| E13 | Step practice + answer policies | done | `src/practice/` | |
| E14 | Timed practice + calibration | partial | `src/practice/timedPractice.ts`, `src/ui/practice/CalibrationSection.tsx` | Windows, loops, count-in, latency slider done; hardware trials pending. |
| E15 | Feedback + session review | done | `src/practice/feedback.ts`, `src/ui/practice/ReviewPanel.tsx` | Pitch/timing separated, next action launches a focused retry. |
| E16 | Lesson/exercise authoring system | done | `src/content/`, `src/content/AUTHORING.md` | Repository-authored data + validator; no CMS. |
| E17 | Foundations pathway | partial | `src/content/concepts/foundations.ts`, `paths.ts` | Content is draft, not reviewed. |
| E18 | Harmony/jazz voicing pathway | partial | `src/content/concepts/harmony.ts` | Draft content. |
| E19 | Local progress + short sessions | done | `src/persistence/progress*.ts`, `src/ui/myPractice/` | Evidence kinds kept distinct; transparent review reasons; export/import/reset. |
| E20 | Accessibility/responsiveness/performance | open | | Static views and reduced motion exist; audit pending. |
| E21 | Musical correctness + real-device validation | open | | Needs pianist review, device matrix, pilot. |
| E22 | Migration/release checks | open | | Run CI gates; `/legacy` retirement issue. |
| E23–E26 | M6 expansion | open | | Post-release. |
| E27 | Scale/mode/pattern lab | partial | `src/music/scales.ts`, `patterns.ts`, `src/scalelab/`, `src/ui/explore/ScaleExplorer.tsx` | Major/minor/Dorian/Mixolydian/pentatonic/blues runs and thirds; only C major run carries fingering (unreviewed). |
| E28 | Warm-ups, technique, routines | partial | `src/content/warmups.ts`, `routines.ts`, `src/ui/practice/RoutineRunner.ts` | Fixed presets + resumable queue; release/overlap observations not captured. |
| E29 | Harmonisation activities | partial | `src/harmonisation/`, `src/content/melodies.ts`, `src/ui/learn/HarmonisationLab.tsx` | Diatonic construction + one four-bar melody with three solutions; harmonisation attempts are not credited to the authored exercise id. |
| E30 | Song charts + play-along | partial | `src/charts/`, `src/content/charts.ts`, `src/ui/songs/` | Two original charts, editor, arrangements, section loops, transposition; practice loops only the first pass of a section. |
| E31 | Catalogue, pathways, applications | partial | `src/ui/learn/` | Search/filters, three entry routes, concept pages, Dorian journey; learner pilot not run. |

Update this table in the PR that changes an epic's status.
