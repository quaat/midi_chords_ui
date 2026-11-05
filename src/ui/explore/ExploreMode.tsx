"use client";

import { useEffect, useId, useMemo } from "react";
import clsx from "clsx";
import { Eye, Send, Volume2 } from "lucide-react";
import type { ChordDefinition } from "@/model/contracts";
import { chordPracticePayload } from "@/ui/runtime/practicePayload";
import { sameMidiSet } from "@/ui/runtime/runtimeHelpers";
import { DisplaySettings } from "@/ui/runtime/DisplaySettings";
import { OnboardingCard } from "@/ui/runtime/OnboardingCard";
import { useExploreState, useExploreTargets, useHeldState, useStudioRuntime } from "@/ui/runtime/useStudioRuntime";
import { CurrentNextStrip } from "@/ui/workspace/CurrentNextStrip";
import { ChordInspector } from "@/ui/explore/ChordInspector";
import { ScaleExplorer } from "@/ui/explore/ScaleExplorer";
import { VoicingCompare } from "@/ui/explore/VoicingCompare";
import type { ExploreTab } from "@/ui/explore/exploreLogic";
import { QUICK_PICKS, chordDegreeRows, inversionOptions, inversionView, parseChordInput, scaleComparisonView } from "@/ui/explore/exploreLogic";

const TABS: { value: ExploreTab; label: string }[] = [
  { value: "chord", label: "Chords & voicings" },
  { value: "scale", label: "Scales & modes" }
];

/** The chord currently explored (last valid symbol). */
function useExploreChord(): ChordDefinition | null {
  const [explore] = useExploreState();
  return useMemo(() => {
    const parsed = parseChordInput(explore.symbol);
    return parsed.ok ? parsed.chord : null;
  }, [explore.symbol]);
}

function ChordTab(): JSX.Element {
  const runtime = useStudioRuntime();
  const [explore, setExplore] = useExploreState();
  const inputId = useId();
  const errorId = useId();
  const chord = useExploreChord();
  const parsedInput = useMemo(() => parseChordInput(explore.symbolInput), [explore.symbolInput]);
  const inversion = useMemo(() => (chord ? inversionView(chord, explore.inversion) : null), [chord, explore.inversion]);

  // Default piano view: the chosen inversion in close position.
  useEffect(() => {
    if (chord && inversion && inversion.ok) {
      runtime.setExploreTargets(inversion.targets, chord, `${chord.symbol} · ${inversion.name}`);
    } else {
      runtime.setExploreTargets([], chord, "");
    }
  }, [runtime, chord, inversion]);

  const onInput = (text: string): void => {
    const parsed = parseChordInput(text);
    if (parsed.ok && parsed.chord.symbol !== explore.symbol) {
      setExplore({ symbolInput: text, symbol: text.trim(), inversion: 0, voicingA: null, voicingB: null });
    } else {
      setExplore({ symbolInput: text });
    }
  };

  const pick = (symbol: string): void => {
    setExplore({ symbolInput: symbol, symbol, inversion: 0, voicingA: null, voicingB: null });
  };

  const options = chord ? inversionOptions(chord) : [];
  const degrees = chord ? chordDegreeRows(chord, 4) : [];

  return (
    <div className="pls-explore__chord">
      <div className="pls-explore__input">
        <div className="pls-field">
          <label className="pls-field__label" htmlFor={inputId}>
            Chord symbol
          </label>
          <input
            id={inputId}
            className={clsx("pls-input", "pls-input--symbol", !parsedInput.ok && "pls-input--invalid")}
            value={explore.symbolInput}
            onChange={(event) => onInput(event.target.value)}
            aria-invalid={!parsedInput.ok}
            aria-describedby={!parsedInput.ok ? errorId : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          {!parsedInput.ok ? (
            <p id={errorId} className="pls-error-text">
              {parsedInput.error}
            </p>
          ) : null}
        </div>
        <div className="pls-quickpicks" role="group" aria-label="Quick picks">
          {QUICK_PICKS.map((symbol) => (
            <button key={symbol} type="button" className={clsx("pls-btn pls-btn--small", explore.symbol === symbol && "pls-toggle--on")} aria-pressed={explore.symbol === symbol} onClick={() => pick(symbol)}>
              {symbol}
            </button>
          ))}
        </div>
      </div>

      {chord ? (
        <>
          <div className="pls-explore__detail">
            <p className="pls-explore__symbol">{chord.symbol}</p>
            <ul className="pls-degree-chips" aria-label="Chord tones">
              {degrees.map((row) => (
                <li key={row.label} className={clsx("pls-degree-chip", row.essential && "pls-degree-chip--essential")}>
                  <span className="pls-degree-chip__degree">{row.pretty}</span>
                  <span className="pls-degree-chip__note">{row.noteName}</span>
                  <span className="pls-degree-chip__role">{row.roleName}</span>
                </li>
              ))}
            </ul>
          </div>

          <section className="pls-inversions" aria-label="Inversions">
            <div className="pls-inversions__buttons" role="group" aria-label="Choose an inversion">
              {options.map((option) => (
                <button
                  key={option.n}
                  type="button"
                  className={clsx("pls-btn pls-btn--small", explore.inversion === option.n && "pls-toggle--on")}
                  aria-pressed={explore.inversion === option.n}
                  disabled={!option.available}
                  title={option.reason}
                  onClick={() => setExplore({ inversion: option.n })}
                >
                  {option.n === 0 ? "Root" : option.n === 1 ? "1st" : option.n === 2 ? "2nd" : "3rd"}
                </button>
              ))}
              {inversion && inversion.ok ? (
                <>
                  <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.audition.playChord(inversion.targets.map((t) => t.midi), 2)}>
                    <Volume2 size={14} aria-hidden="true" /> Hear
                  </button>
                  <button type="button" className="pls-btn pls-btn--small" onClick={() => runtime.setExploreTargets(inversion.targets, chord, `${chord.symbol} · ${inversion.name}`)}>
                    <Eye size={14} aria-hidden="true" /> Show on piano
                  </button>
                  <button
                    type="button"
                    className="pls-btn pls-btn--small"
                    onClick={() =>
                      runtime.navigate.openInPractice(
                        chordPracticePayload(
                          chord,
                          inversion.targets.map((t) => ({ midi: t.midi, role: t.role })),
                          { title: `Play ${chord.symbol} in ${inversion.name}`, recipeId: `inv${explore.inversion}`, recipeName: inversion.name }
                        )
                      )
                    }
                  >
                    <Send size={14} aria-hidden="true" /> Send to Practice
                  </button>
                </>
              ) : null}
            </div>
            {inversion ? (
              <div className="pls-inversions__explain" aria-live="polite">
                {inversion.explanation.map((line, index) => (
                  <p key={index}>{line}</p>
                ))}
              </div>
            ) : null}
          </section>

          <VoicingCompare chord={chord} />
        </>
      ) : (
        <p className="pls-inspector__note">Choose a chord to inspect it.</p>
      )}
    </div>
  );
}

/** Explore stage (above the piano): chord inspection/voicings or scale comparison. */
export function ExploreStage(): JSX.Element {
  const [explore, setExplore] = useExploreState();
  return (
    <div className="pls-explore">
      <div className="pls-segmented" role="tablist" aria-label="Explore">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={explore.tab === tab.value}
            className={clsx("pls-segmented__option", explore.tab === tab.value && "pls-segmented__option--active")}
            onClick={() => setExplore({ tab: tab.value })}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {explore.tab === "chord" ? <ChordTab /> : <ScaleExplorer />}
    </div>
  );
}

/** Alias kept for the mode-slot naming in the plan. */
export const ExploreMode = ExploreStage;

/** Explore context panel: onboarding, chord inspector (or scale summary), display settings. */
export function ExploreContextPanel(): JSX.Element {
  const [explore] = useExploreState();
  const chord = useExploreChord();
  const comparison = useMemo(
    () => (explore.tab === "scale" ? scaleComparisonView(explore.tonic, explore.scaleA, explore.scaleB) : null),
    [explore.tab, explore.tonic, explore.scaleA, explore.scaleB]
  );
  return (
    <>
      <OnboardingCard />
      {explore.tab === "chord" && chord ? <ChordInspector chord={chord} /> : null}
      {comparison ? (
        <section className="pls-panel" aria-label="Scale comparison">
          <h2 className="pls-panel__title">
            {comparison.nameA} vs {comparison.nameB}
          </h2>
          <p className="pls-inspector__note">{comparison.ok ? comparison.summary : comparison.error}</p>
          <p className="pls-inspector__note">Both scales share the tonic, so only the highlighted degrees change the colour. Hear A and B back to back to compare.</p>
        </section>
      ) : null}
      <DisplaySettings />
    </>
  );
}

/** Current/next strip for Explore: the shown chord and whether the learner is playing it. */
export function ExploreCurrentNext(): JSX.Element {
  const [explore] = useExploreState();
  const targets = useExploreTargets();
  const held = useHeldState();
  const midis = targets.targets.map((t) => t.midi);
  const matched = midis.length > 0 && sameMidiSet(midis, held.pressed);
  const detail = targets.targets.map((t) => t.noteName).join(" ");
  let prompt: string;
  if (midis.length === 0) {
    prompt = explore.tab === "chord" ? "Choose a chord." : "Choose two scales to compare.";
  } else if (matched) {
    prompt = `Yes — that is ${targets.caption || "it"}.`;
  } else if (explore.tab === "scale") {
    prompt = "The highlighted keys are the degrees that differ. Hear A and B, then play each.";
  } else {
    prompt = `Play ${detail} on the piano.`;
  }
  return <CurrentNextStrip current={{ symbol: targets.caption || "—", detail: detail || undefined }} next={null} prompt={prompt} positionLabel="—" />;
}
