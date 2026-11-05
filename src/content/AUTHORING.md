# Authoring learning content

Content is repository-authored TypeScript data under `src/content/`. Content files hold data only: chord symbols as strings, pitches as MIDI numbers (C4 = 60), keys as `SpelledPitchClass`. They never import the music, voicing, timeline or practice modules. Those modules resolve and compile the data.

| File | Contents |
|---|---|
| `authoring.ts` | Authoring types (`ExerciseSpec`, `ExerciseMaterial`, `WarmupSpec`, `MelodySpec`, `ContentBundle`), known recipe and pattern IDs, `draftMeta()` |
| `concepts/*.ts` | `ConceptDefinition` pages by strand (foundations, harmony, scales/modes, technique) |
| `exercises.ts` | `ExerciseSpec` list (compiled to `ExerciseDefinition` by the practice module) |
| `warmups.ts`, `melodies.ts` | Technique warm-ups and harmonisation melodies |
| `charts.ts` | `SongChart`s and their `ArrangementDefinition`s |
| `routines.ts`, `paths.ts` | Routine presets and the three entry routes |
| `glossary.ts` | Glossary aggregated from concept pages |
| `validate.ts` | `validateContent`, `buildManifest`, `publishedOnly` |
| `index.ts` | `contentBundle`, `contentManifest`, lookups, `searchContent`, chart/concept navigation |

## Adding a concept

1. Add a `ConceptDefinition` to the right `concepts/<strand>.ts` array. Use a kebab-case `id` that is unique among concepts.
2. Write an original `summary` and 2–4 short `explanation` paragraphs. Do not copy external text. External sources go in `furtherReading` only. A dead link must never block practice.
3. Give at least one audible `example`. A comparison example names the example it is heard against with `compareWith`, and both examples must be in the same concept.
4. Link at least one playable task (`exerciseIds`, which can name exercises or warm-ups), one `application` (a chart, exercise or concept), the `related` concepts and the `prerequisites`.
5. Add `glossary` terms where the page defines vocabulary.
6. Set `meta: draftMeta()`.

## Adding an exercise

Add an `ExerciseSpec` to `exercises.ts`. Choose one `material` kind:

- `chordSequence`: symbols, with optional `durationsBeats` (default 4 beats each) and an optional `voicingRecipeId`. The practice module realises the notes with that recipe.
- `explicitNotes`: authored steps. All notes in a step sound together, and `notes: []` is a rest.
- `scaleRun`: tonic, scale, `patternId`, `startOctave`, `octaves` and hand. The pattern order is stored separately from the pitch collection.
- `singleNotes`: one target note per prompt.

Then set the following:

- **`contract` and `policy`:**
  - `reproduce` checks authored notes, using `exactVoicing`.
  - `satisfyConstraints` accepts any answer that meets the declared roles or pitch classes, using `roles` or `pitchClass`.
  - `exploreReflect` is for `listen` and `free` tasks.
- **`timing`:** `step` by default. A `timed` variant needs `onsetWindowMs`. The defaults are `TIMED_TIMING` (120 ms window, 4-beat count-in, 60 ms chord assembly).
- **`hintLadder`:** three concrete rungs, from vague to specific.
- **Transfer:** `transferKeys`, or a separate transposed exercise with `variantOf`.
- **`application`:** a chart or concept where the skill is used.
- **`explanation`:** context the assessment does not grade, such as the accompaniment bass.

The voicing module must implement every recipe ID in `KNOWN_VOICING_RECIPE_IDS`, and the pattern module every ID in `KNOWN_PATTERN_IDS`. Add new IDs there first.

## Adding a chart

Add a `SongChart` to `charts.ts`:

- Use explicit `sections` and `bars`. Every span has a unique `id` within the chart.
- In each bar, spans must be contiguous from beat 0 and fill the bar exactly.
- A pickup bar sets `beats`. It must be the opening bar, and it should match `pickupBeats`.
- `performanceOrder` lists section IDs explicitly, for example `["A", "A", "B", "A"]`.
- Rests use `isRest: true` with the symbol `"NC"`.
- Set `provenance` honestly. Bundle only original or cleared material.

Each `ArrangementDefinition` names its `chartId`, and the chart lists it in `arrangementIds`. A `chartOnly` learner part must use policy `free`, and `free` is allowed only for `chartOnly`. A chart symbol alone never creates exact-note targets.

## Warm-ups and technique wording

- Text such as fingering, relaxation and posture goes in `guidance` (`kind: "authoredGuidance"`) and starts with "Authored guidance, not measured".
- Feedback may only report the `measuredObservations` that MIDI can observe: timing spread, velocity consistency, release overlap and hand synchrony.
- Hand synchrony requires a declared `handAttribution` assumption, because MIDI does not say which hand played.
- Fingering is displayed only when `reviewed: true`.

## Status and review rules

| Status | Meaning | Shown to learners |
|---|---|---|
| `reviewed` | Musical and teaching review complete. Requires `author` and `reviewer` (and `reviewed: true` for warm-ups). | Yes |
| `draft` | Authored, not yet reviewed. | Yes, visibly flagged as a draft |
| `unavailable` | Temporarily withdrawn. | No |
| `deferred` | A planned future heading. | No, and never as a completed lesson |

All shipped content is currently `draft` with author `"Studio content draft"` and no reviewer. Only set a reviewer's name after a pianist or teacher has checked the register, hand comfort, fingering and wording. Do not invent one. Bump `version` whenever musical material changes, so that stored attempts can detect stale content.

`buildManifest(bundle)` lists `kind:id` keys by status. `publishedOnly(bundle)` keeps `reviewed` and `draft` items and prunes references to removed items.

## What the validator checks

Run the content tests with `npm test -- test/content`, or in the offline harness with `node <harness>/run-tests.js test/content`. The validator checks:

- **IDs:** unique per collection, and section, bar, span, example, solution and routine-item IDs unique within their owner.
- **References:** every reference resolves to an item of the right kind:
  - prerequisites, `exerciseIds`, applications and related concepts
  - path units and routine items (by `kind`), plus chart `sectionId`
  - `arrangement.chartId` and `chart.arrangementIds`
  - `melodyId`, `variantOf` and `compareWith`

  A published item that references deferred or unavailable content gets a warning.
- **Prerequisite cycles** across concepts and exercises, with the cycle reported.
- **MIDI range:** every pitch, register and scale-run extent is within 21..108.
- **Chord symbols** are plausible (root, accidental, suffix tokens, optional slash bass). Full parsing happens elsewhere.
- **Chart bars:** span durations sum to the meter (or `bar.beats`), spans have no gaps or overlaps, `performanceOrder` names existing sections, and arrangement `explicitNotes` keys are chart span IDs.
- **Policy and contract:**
  - `free` requires `exploreReflect`, and `reproduce` cannot be `free`.
  - Chart-only and `free` go together.
  - Timed scored exercises need an onset window.
- **Unsatisfiable answers:**
  - a roles policy with required roles missing from the authored notes, or applied to single notes or scale runs
  - `exactVoicing` over chord symbols without a recipe
  - rests only
- **Metadata:** title, objective or summary, explanation, valid status, version ≥ 1, demand. Reviewed items need an author and a reviewer.
- **Melodies:** every solution chord is in the palette, there is one chord per harmonic-rhythm slot, there are at least two solutions, and the style assumptions are stated.
- **Completeness (warnings):** published concepts lack an example, a task or an application; hint ladders are shorter than three rungs; a path places a unit before its prerequisite; recipe or pattern IDs are unknown.
