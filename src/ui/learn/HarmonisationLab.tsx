"use client";

import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import { Eye, ListPlus, Play, Save, Send, Square, Volume2 } from "lucide-react";
import type { AnswerPolicy, ExerciseStep, ScaleId, SpelledPitchClass } from "@/model/contracts";
import { getChart, getMelody } from "@/content";
import type { MelodySpec } from "@/content";
import { buildDiatonicActivity, compareSolutions, evaluateSolution, harmoniseMelody, melodySlots, solutionToChart, solutionToSequence, spellInKey } from "@/harmonisation";
import type { DiatonicActivity, DiatonicDegreeInfo, HarmonyCandidate, SolutionEvaluation } from "@/harmonisation";
import { formatSpelledNote, parsePitchClass } from "@/music/pitch";
import { formatKey, keyFromTonicAndMode } from "@/music/scales";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { noteNameOf } from "@/ui/learn/learnLogic";
import type { LearnTarget } from "@/ui/learn/learnLogic";
import { hear, openChartInSongs, practiseExercise, runSafely, showOnPiano } from "@/ui/learn/learnActions";
import { withFreeId } from "@/ui/songs/songsLogic";

const MELODY_ID = "mel-four-bar-c";
const TONICS: readonly string[] = ["C", "G", "D", "A", "E", "F", "Bb", "Eb"];
const MODES: readonly { id: ScaleId; label: string }[] = [
  { id: "major", label: "major" },
  { id: "naturalMinor", label: "natural minor" }
];

/** Practice policy for a chosen harmonisation (same as ex-harmonise-melody). */
const HARMONY_POLICY: AnswerPolicy = { kind: "roles", requiredRoles: ["root", "third"], optionalRoles: ["fifth", "seventh"], octaveFree: true };

export interface HarmonisationLabProps {
  focus: "scale" | "melody";
  onBack: () => void;
  onOpenConcept: (conceptId: string) => void;
}

function Message({ text }: { text: string | null }): JSX.Element | null {
  if (!text) return null;
  return (
    <p className="pls-error-text" role="status">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// (a) Diatonic chords of a key
// ---------------------------------------------------------------------------

function DiatonicSection(): JSX.Element {
  const runtime = useStudioRuntime();
  const tonicId = useId();
  const modeId = useId();
  const [tonic, setTonic] = useState<string>("C");
  const [mode, setMode] = useState<ScaleId>("major");
  const [message, setMessage] = useState<string | null>(null);

  const built = useMemo((): { ok: true; activity: DiatonicActivity } | { ok: false; reason: string } => {
    try {
      return { ok: true, activity: buildDiatonicActivity(keyFromTonicAndMode(tonic, mode)) };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }, [tonic, mode]);

  const hearDegree = (degree: DiatonicDegreeInfo): void => {
    setMessage(runSafely(() => runtime.audition.playChord(degree.notes.map((note) => note.midi), 2)));
  };

  const showDegree = (degree: DiatonicDegreeInfo): void => {
    const targets: LearnTarget[] = degree.notes.map((note) => ({ midi: note.midi, noteName: noteNameOf(note.midi), degreeLabel: note.label }));
    showOnPiano(runtime, targets, degree.chord, `${degree.romanNumeral}: ${degree.symbol}`, "learn");
  };

  if (!built.ok) {
    return (
      <section className="pls-learn-section">
        <Message text={built.reason} />
      </section>
    );
  }
  const activity = built.activity;
  const keyName = formatKey(activity.key);
  const practiseTonic = parsePitchClass(tonic);

  const hearAll = (): void => {
    const notes = activity.degrees.flatMap((degree: DiatonicDegreeInfo, index: number) => degree.notes.map((note) => ({ midi: note.midi, onsetBeat: index * 2, durationBeats: 1.9 })));
    setMessage(hear(runtime, notes));
  };

  const practise = (): void => {
    if (mode !== "major") {
      setMessage("The diatonic-triad exercise is authored for major keys; choose a major key to practise it.");
      return;
    }
    const options: { mode: "step"; transposeTo?: SpelledPitchClass } = { mode: "step" };
    if (practiseTonic && !(practiseTonic.letter === "C" && practiseTonic.accidental === 0)) options.transposeTo = practiseTonic;
    setMessage(practiseExercise(runtime, "ex-c-diatonic-triads", options));
  };

  return (
    <section className="pls-learn-section" aria-labelledby="pls-harm-diatonic">
      <h3 id="pls-harm-diatonic" className="pls-learn-section__title">
        Chords on every degree of a scale
      </h3>
      <div className="pls-learn-controls">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={tonicId}>
            Tonic
          </label>
          <select id={tonicId} className="pls-select" value={tonic} onChange={(event) => setTonic(event.target.value)}>
            {TONICS.map((value: string) => (
              <option key={value} value={value}>
                {value.replace("b", "♭")}
              </option>
            ))}
          </select>
        </div>
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={modeId}>
            Scale
          </label>
          <select id={modeId} className="pls-select" value={mode} onChange={(event) => setMode(event.target.value as ScaleId)}>
            {MODES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="pls-learn-muted">
        {keyName}: step pattern {activity.stepPattern.join(" ")}
      </p>
      {activity.explanation.map((line: string) => (
        <p key={line} className="pls-learn-paragraph">
          {line}
        </p>
      ))}
      <div className="pls-learn-table-wrap">
        <table className="pls-learn-table">
          <thead>
            <tr>
              <th scope="col">Degree</th>
              <th scope="col">Chord</th>
              <th scope="col">Notes</th>
              <th scope="col">Why this quality</th>
              <th scope="col">
                <span className="pls-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {activity.degrees.map((degree: DiatonicDegreeInfo) => (
              <tr key={degree.degree}>
                <td>
                  <strong>{degree.romanNumeral}</strong>
                  <span className="pls-learn-muted"> ({degree.scaleDegreeLabel})</span>
                </td>
                <td>
                  <strong>{degree.symbol}</strong> <span className="pls-learn-muted">{degree.quality}</span>
                </td>
                <td>{degree.notes.map((note) => noteNameOf(note.midi)).join(" ")}</td>
                <td className="pls-learn-table__why">{degree.qualityExplanation}</td>
                <td>
                  <div className="pls-learn-actions pls-learn-actions--tight">
                    <button type="button" className="pls-btn pls-btn--small" onClick={() => hearDegree(degree)} aria-label={`Hear ${degree.symbol}`}>
                      <Volume2 size={14} aria-hidden="true" />
                    </button>
                    <button type="button" className="pls-btn pls-btn--small" onClick={() => showDegree(degree)} aria-label={`Show ${degree.symbol} on the piano`}>
                      <Eye size={14} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pls-learn-actions">
        <button type="button" className="pls-btn pls-btn--small" onClick={hearAll}>
          <Volume2 size={14} aria-hidden="true" /> Hear all
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.navigate.openInCreate(activity.sequence, `${keyName} diatonic chords`)}>
          <ListPlus size={14} aria-hidden="true" /> Send all to Create
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={practise}>
          <Play size={14} aria-hidden="true" /> Practise
        </button>
      </div>
      <Message text={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// (b) Harmonise a fixed melody
// ---------------------------------------------------------------------------

interface SolutionOption {
  id: string;
  label: string;
  chords: string[];
}

function EvaluationView({ evaluation }: { evaluation: SolutionEvaluation }): JSX.Element {
  const slotNotes = evaluation.slots.flatMap((slot) => slot.styleNotes.map((note: string) => `${slot.label}: ${note}`));
  return (
    <div className="pls-harm-eval">
      <div className="pls-harm-eval__col">
        <p className="pls-harm-eval__title">Constraints</p>
        {evaluation.constraints.allSatisfied ? (
          <p className="pls-harm-ok">All required constraints are met: melody unchanged, chords from the palette, one chord per slot.</p>
        ) : (
          <ul className="pls-learn-list">
            {evaluation.constraints.problems.map((problem: string) => (
              <li key={problem} className="pls-error-text">
                {problem}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pls-harm-eval__col">
        <p className="pls-harm-eval__title">Style notes</p>
        <p className="pls-learn-muted">Observations for this style; none of them makes a solution wrong.</p>
        <ul className="pls-learn-list">
          {evaluation.styleNotes.map((note: string) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
        {slotNotes.length > 0 ? (
          <details className="pls-learn-details">
            <summary>Bar by bar</summary>
            <ul className="pls-learn-list">
              {slotNotes.map((note: string, index: number) => (
                <li key={`${index}-${note}`}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <div className="pls-harm-eval__col">
        <p className="pls-harm-eval__title">Reflection</p>
        <ul className="pls-learn-list">
          {evaluation.reflection.map((line: string) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MelodySection({ melody }: { melody: MelodySpec }): JSX.Element {
  const runtime = useStudioRuntime();
  const aId = useId();
  const bId = useId();
  const titleId = useId();
  const slots = useMemo(() => melodySlots(melody), [melody]);
  const [choices, setChoices] = useState<string[]>(() => (melody.solutions[0] ? [...melody.solutions[0].chords] : slots.map(() => melody.palette[0] ?? "C")));
  const [message, setMessage] = useState<string | null>(null);
  const [compareA, setCompareA] = useState<string>(melody.solutions[0] ? melody.solutions[0].id : "mine");
  const [compareB, setCompareB] = useState<string>(melody.solutions[1] ? melody.solutions[1].id : "mine");
  const [chartTitle, setChartTitle] = useState<string>("");

  const activity = useMemo(() => harmoniseMelody(melody, { choices }), [melody, choices]);
  const evaluation = useMemo(() => evaluateSolution(melody, choices), [melody, choices]);
  const options: SolutionOption[] = useMemo(
    () => [...melody.solutions.map((solution) => ({ id: solution.id, label: solution.label, chords: solution.chords })), { id: "mine", label: "Your choice", chords: choices }],
    [melody, choices]
  );
  const optionA = options.find((option) => option.id === compareA) ?? options[0];
  const optionB = options.find((option) => option.id === compareB) ?? options[options.length - 1];
  const comparison = useMemo(() => compareSolutions(melody, optionA.chords, optionB.chords), [melody, optionA, optionB]);
  const key = melody.key;
  const matchingPreset = melody.solutions.find((solution) => solution.chords.join(" ") === choices.join(" "));

  const choose = (slotIndex: number, symbol: string): void => {
    setChoices((current: string[]) => current.map((value: string, index: number) => (index === slotIndex ? symbol : value)));
  };

  const hearChords = (chords: string[]): void => {
    const result = solutionToSequence(melody, chords);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    setMessage(
      runSafely(() => {
        runtime.loadTimeline(result.timeline, { sourceKind: "scratch", sourceId: result.sequence.id, title: `${melody.title}: ${chords.join(" ")}`, sequence: result.sequence, version: result.sequence.version });
        runtime.transport.setLoop(null);
        runtime.transport.setPartMuted("learner", false);
        runtime.transport.setPartMuted("demonstration", false);
        void runtime.transport.play(0);
      })
    );
  };

  const practise = (): void => {
    const result = solutionToSequence(melody, choices);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    const timeline = result.timeline;
    const steps: ExerciseStep[] = timeline.occurrences.map((occurrence) => {
      const targets = timeline.notes.filter((note) => note.part === "learner" && note.occurrenceId === occurrence.occurrenceId);
      const names = targets.map((note) => (note.spelled ? formatSpelledNote(note.spelled, { unicode: true }) : noteNameOf(note.midi))).join(" ");
      const step: ExerciseStep = {
        id: `step:${occurrence.occurrenceId}`,
        occurrenceId: occurrence.occurrenceId,
        prompt: `${occurrence.symbol}: play the chord under the melody — root and third required, your voicing.`,
        targets,
        policy: HARMONY_POLICY,
        hints: [`Chord: ${occurrence.symbol}`, `Notes: ${names}`, `Keys: ${targets.map((note) => `${noteNameOf(note.midi)} (MIDI ${note.midi})`).join(", ")}`]
      };
      if (occurrence.chord) step.chord = occurrence.chord;
      return step;
    });
    setMessage(runSafely(() => runtime.navigate.openInPractice({ timeline, steps, title: `Harmonise “${melody.title}”: ${choices.join(" ")}` })));
  };

  const openInCreate = (): void => {
    const result = solutionToSequence(melody, choices);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    runtime.navigate.openInCreate(result.sequence, `${melody.title}: ${choices.join(" ")}`);
  };

  const saveAsChart = (): void => {
    const title = chartTitle.trim() || `${melody.title} — ${choices.join(" ")}`;
    const result = solutionToChart(melody, choices, title);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    const listed = runtime.stores.charts.list();
    const taken: string[] = listed.ok ? listed.value.map((summary) => summary.id) : [];
    if (getChart(result.chart.id)) taken.push(result.chart.id);
    const chart = withFreeId(result.chart, taken);
    const saved = runtime.stores.charts.save(chart);
    if (!saved.ok) {
      setMessage(`Not saved: ${saved.error.message}`);
      return;
    }
    openChartInSongs(runtime, chart.id);
  };

  return (
    <section className="pls-learn-section" aria-labelledby="pls-harm-melody">
      <h3 id="pls-harm-melody" className="pls-learn-section__title">
        Choose chords for “{melody.title}”
      </h3>
      <p className="pls-learn-muted">
        {formatKey({ tonic: key.tonic, mode: key.mode })} · one chord every {melody.harmonicRhythmBeats} beats · palette {melody.palette.join(", ")}. The melody and its rhythm never change here.
      </p>
      <details className="pls-learn-details">
        <summary>Style assumptions</summary>
        <ul className="pls-learn-list">
          {melody.assumptions.map((line: string) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      <div className="pls-learn-actions">
        <span className="pls-learn-muted">Authored solutions:</span>
        {melody.solutions.map((solution) => (
          <button
            key={solution.id}
            type="button"
            className={clsx("pls-btn", "pls-btn--small", matchingPreset && matchingPreset.id === solution.id && "pls-toggle--on")}
            aria-pressed={matchingPreset !== undefined && matchingPreset.id === solution.id}
            onClick={() => setChoices([...solution.chords])}
          >
            {solution.label}: {solution.chords.join(" ")}
          </button>
        ))}
      </div>
      {matchingPreset ? (
        <ul className="pls-learn-list">
          {matchingPreset.explanation.map((line: string) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}

      <ol className="pls-harm-slots">
        {activity.slots.map((slot) => {
          const chosen = choices[slot.index] ?? "";
          const evaluated = evaluation.slots[slot.index];
          const candidate: HarmonyCandidate | undefined = slot.candidates.find((entry) => entry.symbol === chosen);
          const selectId = `pls-harm-slot-${slot.index}`;
          return (
            <li key={slot.index} className="pls-harm-slot">
              <p className="pls-harm-slot__label">{slot.label}</p>
              <p className="pls-harm-slot__melody" aria-label={`Melody of ${slot.label}`}>
                {(evaluated ? evaluated.notes : []).map((note, index: number) => (
                  <span key={`${note.startBeat}-${index}`} className={clsx("pls-harm-note", note.strong && "pls-harm-note--strong", `pls-harm-note--${note.relation}`)}>
                    {note.name}
                    <span className="pls-sr-only">
                      {note.strong ? ", strong beat" : ""}, {note.relation === "chordTone" ? "chord tone" : note.relation === "passingTone" ? "passing tone" : "non-chord tone"}
                    </span>
                  </span>
                ))}
                {!evaluated
                  ? slot.melodyNotes.map((note, index: number) => (
                      <span key={`${note.startBeat}-${index}`} className="pls-harm-note">
                        {formatSpelledNote(spellInKey(note.midi, { tonic: key.tonic, mode: key.mode }), { unicode: true })}
                      </span>
                    ))
                  : null}
              </p>
              <label className="pls-field__label" htmlFor={selectId}>
                Chord
              </label>
              <select id={selectId} className="pls-select" value={chosen} onChange={(event) => choose(slot.index, event.target.value)}>
                {slot.candidates.map((entry: HarmonyCandidate) => (
                  <option key={entry.symbol} value={entry.symbol}>
                    {entry.symbol} ({entry.romanNumeral})
                  </option>
                ))}
              </select>
              {candidate ? (
                <ul className="pls-learn-list pls-harm-slot__reasons">
                  {candidate.reasons.map((reason: string) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="pls-learn-muted">
        Bass line {evaluation.bassLine.join("–")} · ending: {evaluation.cadence === "none" ? "no standard cadence" : `${evaluation.cadence} cadence`}
      </p>
      <EvaluationView evaluation={evaluation} />

      <div className="pls-learn-actions">
        <button type="button" className="pls-btn pls-btn--small" onClick={() => hearChords(choices)}>
          <Volume2 size={14} aria-hidden="true" /> Hear this harmonisation
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.transport.stop()}>
          <Square size={14} aria-hidden="true" /> Stop
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--primary" onClick={practise}>
          <Play size={14} aria-hidden="true" /> Practise this arrangement
        </button>
        <button type="button" className="pls-btn pls-btn--small" onClick={openInCreate}>
          <Send size={14} aria-hidden="true" /> Open in Create
        </button>
      </div>

      <div className="pls-harm-compare">
        <p className="pls-harm-eval__title">Compare two solutions</p>
        <div className="pls-learn-controls">
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={aId}>
              A
            </label>
            <select id={aId} className="pls-select" value={optionA.id} onChange={(event) => setCompareA(event.target.value)}>
              {options.map((option: SolutionOption) => (
                <option key={option.id} value={option.id}>
                  {option.label}: {option.chords.join(" ")}
                </option>
              ))}
            </select>
          </div>
          <div className="pls-field">
            <label className="pls-field__label" htmlFor={bId}>
              B
            </label>
            <select id={bId} className="pls-select" value={optionB.id} onChange={(event) => setCompareB(event.target.value)}>
              {options.map((option: SolutionOption) => (
                <option key={option.id} value={option.id}>
                  {option.label}: {option.chords.join(" ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="pls-learn-paragraph">{comparison.summary}</p>
        {comparison.differences.length > 0 ? (
          <ul className="pls-learn-list">
            {comparison.differences.map((line: string) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="pls-learn-actions">
          <button type="button" className="pls-btn pls-btn--small" onClick={() => hearChords(optionA.chords)}>
            <Volume2 size={14} aria-hidden="true" /> Hear A
          </button>
          <button type="button" className="pls-btn pls-btn--small" onClick={() => hearChords(optionB.chords)}>
            <Volume2 size={14} aria-hidden="true" /> Hear B
          </button>
        </div>
      </div>

      <div className="pls-harm-save">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={titleId}>
            Chart title
          </label>
          <input
            id={titleId}
            className="pls-input"
            value={chartTitle}
            placeholder={`${melody.title} — ${choices.join(" ")}`}
            onChange={(event) => setChartTitle(event.target.value)}
          />
        </div>
        <button type="button" className="pls-btn pls-btn--small" onClick={saveAsChart}>
          <Save size={14} aria-hidden="true" /> Save as chart
        </button>
      </div>
      <Message text={message} />
    </section>
  );
}

/** Harmonisation activities (E29): diatonic construction and fixed-melody harmonisation. */
export function HarmonisationLab({ focus, onBack, onOpenConcept }: HarmonisationLabProps): JSX.Element {
  const melody = getMelody(MELODY_ID);
  return (
    <article className="pls-learn-page" aria-labelledby="pls-harm-title">
      <header className="pls-learn-page__head">
        <h2 id="pls-harm-title" className="pls-learn-page__title">
          Harmonisation lab
        </h2>
        <p className="pls-learn-page__summary">
          Harmonising a <em>scale</em> builds chords mechanically from its notes; harmonising a <em>melody</em> means choosing among several chords that can all work.
        </p>
        <div className="pls-learn-actions">
          <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={onBack}>
            Back
          </button>
          <button type="button" className="pls-link-button" onClick={() => onOpenConcept("harmonising-scale")}>
            Concept: harmonising a scale
          </button>
          <button type="button" className="pls-link-button" onClick={() => onOpenConcept("harmonising-melody")}>
            Concept: choosing chords for a melody
          </button>
        </div>
      </header>
      {focus === "melody" ? (
        <>
          {melody ? <MelodySection melody={melody} /> : <p className="pls-error-text">The melody for this activity is missing.</p>}
          <DiatonicSection />
        </>
      ) : (
        <>
          <DiatonicSection />
          {melody ? <MelodySection melody={melody} /> : <p className="pls-error-text">The melody for this activity is missing.</p>}
        </>
      )}
    </article>
  );
}
