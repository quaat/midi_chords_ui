"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, ExternalLink, FlaskConical, Music, Volume2, Square } from "lucide-react";
import type { ConceptDefinition, ConceptExample, ProgressEvidence, SpelledPitchClass } from "@/model/contracts";
import { chartsForConcept, getChart, getExerciseSpec, getPlayable } from "@/content";
import { formatPitchClass } from "@/music/pitch";
import { modeComparison, vampTimeline } from "@/scalelab/compare";
import { useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import {
  DEMAND_LABELS,
  HARMONISATION_CONCEPTS,
  STATUS_LABELS,
  STRAND_LABELS,
  examplePlan,
  knownConcepts,
  noteNameOf,
  readEvidence,
  timelineToAuditionNotes,
  unitMarker
} from "@/ui/learn/learnLogic";
import type { ChordExampleNotes, ExamplePlan, LearnTarget } from "@/ui/learn/learnLogic";
import { hear, openChartInSongs, practiseExercise, practiseRun, runSafely, showOnPiano } from "@/ui/learn/learnActions";
import { ExerciseCard } from "@/ui/learn/ExerciseCard";

const READ_DELAY_MS = 1500;
const D_TONIC: SpelledPitchClass = { letter: "D", accidental: 0 };

export interface ConceptPageProps {
  concept: ConceptDefinition;
  evidence: readonly ProgressEvidence[];
  onOpenConcept: (conceptId: string) => void;
  onOpenExercise: (exerciseId: string) => void;
  onOpenLab: (focus: "scale" | "melody") => void;
  /** Called after "read" evidence was recorded (so markers can refresh). */
  onEvidenceRecorded?: () => void;
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
// Examples
// ---------------------------------------------------------------------------

function ExampleCard({ example, siblings }: { example: ConceptExample; siblings: ConceptExample[] }): JSX.Element {
  const runtime = useStudioRuntime();
  const plan: ExamplePlan = useMemo(() => examplePlan(example, siblings), [example, siblings]);
  const [message, setMessage] = useState<string | null>(null);

  const show = (targets: LearnTarget[], caption: string, chord: ExamplePlan["chord"]): void => {
    if (targets.length === 0) {
      setMessage("Nothing to show on the piano for this example.");
      return;
    }
    setMessage(null);
    showOnPiano(runtime, targets, chord, caption, "learn");
  };

  const showChord = (entry: ChordExampleNotes): void => {
    show(
      entry.midi.map((midi: number, index: number) => {
        const target: LearnTarget = { midi, noteName: noteNameOf(midi) };
        const label = entry.labels[index];
        if (label) target.degreeLabel = label;
        return target;
      }),
      entry.symbol,
      entry.chord
    );
  };

  return (
    <li className="pls-learn-example">
      <div className="pls-learn-example__head">
        <p className="pls-learn-example__label">{example.label}</p>
        <span className="pls-badge">{example.kind}</span>
      </div>
      {example.description ? <p className="pls-learn-muted">{example.description}</p> : null}
      {plan.summary ? <p className="pls-learn-example__summary">{plan.summary}</p> : null}
      <div className="pls-learn-actions">
        {plan.variants.length > 0 ? (
          plan.variants.map((variant) => (
            <button key={variant.label} type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(hear(runtime, variant.notes))}>
              <Volume2 size={14} aria-hidden="true" /> {variant.label}
            </button>
          ))
        ) : (
          <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(hear(runtime, plan.notes))}>
            <Volume2 size={14} aria-hidden="true" /> Hear
          </button>
        )}
        <button type="button" className="pls-btn pls-btn--small" onClick={() => show(plan.targets, plan.caption, plan.chord)}>
          <Eye size={14} aria-hidden="true" /> Show on piano
        </button>
        <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => runtime.audition.stop()} aria-label="Stop listening">
          <Square size={14} aria-hidden="true" />
        </button>
      </div>
      {plan.chords.length > 1 ? (
        <div className="pls-learn-chips" aria-label={`Chords of ${example.label}`}>
          {plan.chords.map((entry: ChordExampleNotes, index: number) => (
            <span key={`${entry.symbol}-${index}`} className="pls-learn-chip">
              <button
                type="button"
                className="pls-learn-chip__main"
                onClick={() => {
                  setMessage(hear(runtime, entry.midi.map((midi: number) => ({ midi, onsetBeat: 0, durationBeats: 2 }))));
                  showChord(entry);
                }}
                title="Hear and show this chord"
              >
                {entry.symbol}
                {example.labels && example.labels.length === plan.chords.length ? <span className="pls-learn-chip__numeral">{example.labels[index]}</span> : null}
              </button>
              <button type="button" className="pls-learn-chip__inspect" onClick={() => runtime.navigate.openInExplore(entry.symbol)} title={`Inspect ${entry.symbol} in Explore`}>
                Inspect
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {plan.problems.map((problem: string) => (
        <p key={problem} className="pls-error-text">
          {problem}
        </p>
      ))}
      <Message text={message} />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Dorian in practice (plan §7 "Next slice")
// ---------------------------------------------------------------------------

function DorianInPractice({ onOpenExercise }: { onOpenExercise: (id: string) => void }): JSX.Element {
  const runtime = useStudioRuntime();
  const [message, setMessage] = useState<string | null>(null);
  const comparison = useMemo(() => {
    try {
      return modeComparison(D_TONIC, "naturalMinor", "dorian", 4);
    } catch {
      return null;
    }
  }, []);
  const runSpec = getExerciseSpec("ex-d-dorian-run");
  const transferKeys: SpelledPitchClass[] = runSpec && runSpec.transferKeys ? runSpec.transferKeys : [];

  const showSixth = (): void => {
    if (!comparison) return;
    const targets: LearnTarget[] = comparison.characteristicDegreeMidi.map((midi: number) => {
      const fromB = comparison.scales[1].notes.find((note) => note.midi === midi);
      const fromA = comparison.scales[0].notes.find((note) => note.midi === midi);
      const source = fromB ?? fromA;
      return source ? { midi, noteName: source.pitchName, degreeLabel: source.label } : { midi, noteName: noteNameOf(midi) };
    });
    showOnPiano(runtime, targets, null, "D natural minor (B♭) vs D Dorian (B): the sixth", "learn");
  };

  const playVamp = (): void => {
    const vamp = vampTimeline(D_TONIC, "dorian");
    if (!vamp.ok) {
      setMessage(vamp.reason);
      return;
    }
    setMessage(
      runSafely(() => {
        runtime.loadTimeline(vamp.timeline, { sourceKind: "scratch", sourceId: vamp.sequence.id, title: vamp.sequence.title, sequence: vamp.sequence, version: vamp.sequence.version });
        runtime.transport.setLoop(null);
        void runtime.transport.play(0);
      })
    );
  };

  return (
    <section className="pls-learn-section pls-learn-flow" aria-labelledby="pls-dorian-flow">
      <h3 id="pls-dorian-flow" className="pls-learn-section__title">
        Dorian in practice
      </h3>
      <ol className="pls-learn-flow__steps">
        <li>
          <p className="pls-learn-flow__step">Read the explanation above and show the examples on the piano with degree labels.</p>
        </li>
        <li>
          <p className="pls-learn-flow__step">Compare D Dorian with D natural minor over the same D.</p>
          {comparison ? (
            <>
              <p className="pls-learn-muted">{comparison.summary}</p>
              <div className="pls-learn-actions">
                <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(hear(runtime, timelineToAuditionNotes(comparison.timelines.a)))}>
                  <Volume2 size={14} aria-hidden="true" /> {comparison.scales[0].displayName}
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(hear(runtime, timelineToAuditionNotes(comparison.timelines.b)))}>
                  <Volume2 size={14} aria-hidden="true" /> {comparison.scales[1].displayName}
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(hear(runtime, timelineToAuditionNotes(comparison.timelines.aThenB)))}>
                  <Volume2 size={14} aria-hidden="true" /> One then the other
                </button>
                <button type="button" className="pls-btn pls-btn--small" onClick={showSixth}>
                  <Eye size={14} aria-hidden="true" /> Show the sixth
                </button>
              </div>
              <details className="pls-learn-details">
                <summary>The relative view (secondary)</summary>
                <ul className="pls-learn-list">
                  {comparison.relativeExplanation.map((line: string) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="pls-error-text">The comparison could not be built.</p>
          )}
        </li>
        <li>
          <p className="pls-learn-flow__step">Play the D Dorian run step by step, then timed.</p>
          <div className="pls-learn-actions">
            <button
              type="button"
              className="pls-btn pls-btn--small pls-btn--primary"
              onClick={() => setMessage(practiseRun(runtime, { tonic: D_TONIC, scaleId: "dorian", patternId: "run-one-octave", startOctave: 4, octaves: 1, hand: "right" }))}
            >
              Play the run (step)
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(practiseExercise(runtime, "ex-d-dorian-run", { mode: "timed" }))}>
              Timed run
            </button>
          </div>
        </li>
        <li>
          <p className="pls-learn-flow__step">Hear the Dm7–G7 vamp, then try Dorian Drift, a short original modal chart.</p>
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={playVamp}>
              <Volume2 size={14} aria-hidden="true" /> Play the vamp
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.transport.stop()}>
              <Square size={14} aria-hidden="true" /> Stop
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => openChartInSongs(runtime, "dorian-drift")}>
              <Music size={14} aria-hidden="true" /> Open Dorian Drift
            </button>
          </div>
        </li>
        <li>
          <p className="pls-learn-flow__step">Choose: an exact phrase over the vamp (scored), or free improvisation (recorded, not scored — the run's scoring does not apply).</p>
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(practiseExercise(runtime, "ex-dorian-vamp-phrase", { mode: "step" }))}>
              Exact phrase
            </button>
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(practiseExercise(runtime, "ex-dorian-free-improv"))}>
              Free improvisation
            </button>
            <button type="button" className="pls-btn pls-btn--small pls-btn--ghost" onClick={() => onOpenExercise("ex-dorian-free-improv")}>
              About free play
            </button>
          </div>
        </li>
        <li>
          <p className="pls-learn-flow__step">Transfer: play the run in another key, then with fewer hints.</p>
          <div className="pls-learn-actions">
            {transferKeys.map((key: SpelledPitchClass) => (
              <button
                key={`${key.letter}${key.accidental}`}
                type="button"
                className="pls-btn pls-btn--small"
                onClick={() => setMessage(practiseExercise(runtime, "ex-d-dorian-run", { mode: "step", transposeTo: key }))}
              >
                {formatPitchClass(key, { unicode: true })} Dorian run
              </button>
            ))}
            <button type="button" className="pls-btn pls-btn--small" onClick={() => setMessage(practiseExercise(runtime, "ex-d-dorian-run", { mode: "timed", assistance: "reduced" }))}>
              Fewer hints
            </button>
          </div>
        </li>
      </ol>
      <Message text={message} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ConceptPage({ concept, evidence, onOpenConcept, onOpenExercise, onOpenLab, onEvidenceRecorded }: ConceptPageProps): JSX.Element {
  const runtime = useStudioRuntime();
  const conceptId = concept.id;
  const notifyRef = useRef<(() => void) | undefined>(onEvidenceRecorded);
  notifyRef.current = onEvidenceRecorded;

  // "Read" evidence once per opened page, after a short dwell (quick browsing records nothing).
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const result = runtime.stores.progress.recordEvidence(readEvidence(conceptId));
        const notify = notifyRef.current;
        if (result.ok && notify) notify();
      } catch {
        // Progress is optional; ignore storage failures.
      }
    }, READ_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runtime, conceptId]);

  const prerequisites = knownConcepts(concept.prerequisites);
  const prerequisiteExercises = concept.prerequisites.filter((id: string) => !prerequisites.some((c) => c.id === id) && getPlayable(id) !== undefined);
  const related = knownConcepts(concept.related);
  const charts = chartsForConcept(concept.id);
  const marker = unitMarker(evidence, "concept", concept.id);
  const isHarmonisation = HARMONISATION_CONCEPTS.includes(concept.id);

  return (
    <article className="pls-learn-page" aria-labelledby="pls-learn-page-title">
      <header className="pls-learn-page__head">
        <h2 id="pls-learn-page-title" className="pls-learn-page__title">
          {concept.title}
        </h2>
        <div className="pls-learn-badges">
          <span className="pls-badge">{STRAND_LABELS[concept.strand]}</span>
          {concept.demand.map((demand) => (
            <span key={demand} className="pls-badge">
              {DEMAND_LABELS[demand]}
            </span>
          ))}
          {concept.meta.status !== "reviewed" ? (
            <span className="pls-badge pls-learn-badge--draft" title="Not yet reviewed by a pianist">
              {STATUS_LABELS[concept.meta.status]}
            </span>
          ) : null}
          {marker.done ? <span className="pls-badge pls-learn-badge--done">{marker.label}</span> : null}
        </div>
        <p className="pls-learn-page__summary">{concept.summary}</p>
      </header>

      {prerequisites.length > 0 || prerequisiteExercises.length > 0 ? (
        <p className="pls-learn-inline-links">
          <span className="pls-learn-muted">Before this:</span>{" "}
          {prerequisites.map((item) => (
            <button key={item.id} type="button" className="pls-link-button" onClick={() => onOpenConcept(item.id)}>
              {item.title}
            </button>
          ))}
          {prerequisiteExercises.map((id: string) => (
            <button key={id} type="button" className="pls-link-button" onClick={() => onOpenExercise(id)}>
              {id}
            </button>
          ))}
        </p>
      ) : null}

      <section className="pls-learn-section" aria-label="Explanation">
        {concept.explanation.map((paragraph: string) => (
          <p key={paragraph} className="pls-learn-paragraph">
            {paragraph}
          </p>
        ))}
      </section>

      {concept.glossary && concept.glossary.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-glossary">
          <h3 id="pls-learn-glossary" className="pls-learn-section__title">
            Terms
          </h3>
          <div className="pls-learn-glossary">
            {concept.glossary.map((entry) => (
              <details key={entry.term} className="pls-learn-details">
                <summary>{entry.term}</summary>
                <p>{entry.definition}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {concept.examples.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-examples">
          <h3 id="pls-learn-examples" className="pls-learn-section__title">
            Hear it
          </h3>
          <ul className="pls-learn-examples">
            {concept.examples.map((example: ConceptExample) => (
              <ExampleCard key={example.id} example={example} siblings={concept.examples} />
            ))}
          </ul>
        </section>
      ) : null}

      {concept.id === "dorian-mode" ? <DorianInPractice onOpenExercise={onOpenExercise} /> : null}

      {isHarmonisation ? (
        <section className="pls-learn-section pls-learn-flow" aria-label="Harmonisation lab">
          <p className="pls-learn-flow__step">Build chords on every scale degree, then choose and compare chords for a short melody.</p>
          <div className="pls-learn-actions">
            <button type="button" className="pls-btn pls-btn--primary" onClick={() => onOpenLab(concept.id === "harmonising-melody" ? "melody" : "scale")}>
              <FlaskConical size={16} aria-hidden="true" /> Open the harmonisation lab
            </button>
          </div>
        </section>
      ) : null}

      {concept.exerciseIds.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-exercises">
          <h3 id="pls-learn-exercises" className="pls-learn-section__title">
            Play it
          </h3>
          <div className="pls-learn-exlist">
            {concept.exerciseIds.map((id: string) => (
              <ExerciseCard key={id} exerciseId={id} marker={unitMarker(evidence, "exercise", id)} />
            ))}
          </div>
        </section>
      ) : null}

      {concept.applications.length > 0 || charts.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-apply">
          <h3 id="pls-learn-apply" className="pls-learn-section__title">
            Use it in music
          </h3>
          <ul className="pls-learn-links">
            {concept.applications.map((application) => {
              const chart = application.chartId ? getChart(application.chartId) : undefined;
              return (
                <li key={`${application.label}-${application.chartId ?? application.exerciseId ?? application.conceptId ?? ""}`}>
                  {chart ? (
                    <button type="button" className="pls-link-button" onClick={() => openChartInSongs(runtime, chart.id)}>
                      <Music size={14} aria-hidden="true" /> {application.label} — {chart.title}
                    </button>
                  ) : application.exerciseId ? (
                    <button type="button" className="pls-link-button" onClick={() => onOpenExercise(application.exerciseId ?? "")}>
                      {application.label}
                    </button>
                  ) : application.conceptId ? (
                    <button type="button" className="pls-link-button" onClick={() => onOpenConcept(application.conceptId ?? "")}>
                      {application.label}
                    </button>
                  ) : (
                    <span>{application.label}</span>
                  )}
                </li>
              );
            })}
            {charts
              .filter((chart) => !concept.applications.some((application) => application.chartId === chart.id))
              .map((chart) => (
                <li key={chart.id}>
                  <button type="button" className="pls-link-button" onClick={() => openChartInSongs(runtime, chart.id)}>
                    <Music size={14} aria-hidden="true" /> Song: {chart.title}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-related">
          <h3 id="pls-learn-related" className="pls-learn-section__title">
            Related
          </h3>
          <p className="pls-learn-inline-links">
            {related.map((item) => (
              <button key={item.id} type="button" className="pls-link-button" onClick={() => onOpenConcept(item.id)}>
                {item.title}
              </button>
            ))}
          </p>
        </section>
      ) : null}

      {concept.furtherReading && concept.furtherReading.length > 0 ? (
        <section className="pls-learn-section" aria-labelledby="pls-learn-reading">
          <h3 id="pls-learn-reading" className="pls-learn-section__title">
            Further reading <span className="pls-learn-muted">(optional, external)</span>
          </h3>
          <ul className="pls-learn-links">
            {concept.furtherReading.map((item) => (
              <li key={item.url}>
                <a className="pls-link" href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.title} <ExternalLink size={12} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          <p className="pls-learn-muted">External pages are supplements; the lesson and its practice work without them.</p>
        </section>
      ) : null}
    </article>
  );
}
