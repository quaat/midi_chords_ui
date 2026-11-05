"use client";

import clsx from "clsx";
import { Ear, GraduationCap, Keyboard, Plug, Sparkles, X } from "lucide-react";
import { useSessionStore } from "@/state/useSessionStore";
import { useStudioRuntime, useUiState } from "@/ui/runtime/useStudioRuntime";

/**
 * First-run card (plan "First-session example" steps 1–2): choose a learning goal, then an input.
 * Dismissible; the goal is saved to preferences.onboardingChoice.
 */
export function OnboardingCard(): JSX.Element | null {
  const runtime = useStudioRuntime();
  const ui = useUiState();
  const inputSource = useSessionStore((s) => s.inputSource);
  if (!ui.storesReady || !ui.onboardingVisible) {
    return null;
  }
  const chosen = ui.onboardingChoice;
  return (
    <section className="pls-panel pls-onboarding" aria-label="Getting started">
      <div className="pls-onboarding__head">
        <h2 className="pls-panel__title">
          <Sparkles size={16} aria-hidden="true" /> Getting started
        </h2>
        <button type="button" className="pls-btn pls-btn--ghost pls-btn--icon" onClick={() => runtime.dismissOnboarding()} aria-label="Close getting started">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <p className="pls-onboarding__step">1. What brings you here?</p>
      <div className="pls-onboarding__choices">
        <button
          type="button"
          className={clsx("pls-btn", chosen === "learningChords" && "pls-toggle--on")}
          aria-pressed={chosen === "learningChords"}
          onClick={() => runtime.chooseOnboarding("learningChords")}
        >
          <GraduationCap size={16} aria-hidden="true" /> I am learning chords
        </button>
        <button
          type="button"
          className={clsx("pls-btn", chosen === "betterVoicings" && "pls-toggle--on")}
          aria-pressed={chosen === "betterVoicings"}
          onClick={() => runtime.chooseOnboarding("betterVoicings")}
        >
          <Sparkles size={16} aria-hidden="true" /> I already play and want better voicings
        </button>
      </div>
      <p className="pls-onboarding__step">2. How will you play?</p>
      <div className="pls-onboarding__choices">
        <button type="button" className={clsx("pls-btn", inputSource === "midi" && "pls-toggle--on")} onClick={() => runtime.chooseInput("midi")}>
          <Plug size={16} aria-hidden="true" /> Connect MIDI
        </button>
        <button type="button" className={clsx("pls-btn", inputSource === "computerKeyboard" && "pls-toggle--on")} onClick={() => runtime.chooseInput("computerKeyboard")}>
          <Keyboard size={16} aria-hidden="true" /> Use computer keys
        </button>
        <button type="button" className={clsx("pls-btn", inputSource === "none" && "pls-toggle--on")} onClick={() => runtime.chooseInput("none")}>
          <Ear size={16} aria-hidden="true" /> Listen only
        </button>
      </div>
      <p className="pls-onboarding__note">
        {inputSource === "computerKeyboard"
          ? "Keys Z–M play C3–B3, Q–I play C4–C5; Space is the sustain pedal."
          : inputSource === "none"
            ? "Listening only: you can explore and hear everything; playing is not scored."
            : "The on-screen piano always works with mouse or touch."}
      </p>
      {chosen ? (
        <button type="button" className="pls-btn pls-btn--primary" onClick={() => runtime.dismissOnboarding()}>
          Done
        </button>
      ) : null}
    </section>
  );
}
