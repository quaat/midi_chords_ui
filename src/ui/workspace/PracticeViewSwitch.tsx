"use client";

import { useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import clsx from "clsx";
import type { PracticeView } from "@/state/sessionStore";

export const PRACTICE_VIEWS: { value: PracticeView; label: string; description: string }[] = [
  { value: "fallingNotes", label: "Falling notes", description: "Notes move toward the keys" },
  { value: "static", label: "Static steps", description: "Current and next chords, no motion" },
  { value: "notation", label: "Notation", description: "Staff notation when available" },
  { value: "chart", label: "Chord chart", description: "Bar-based chord symbols only" }
];

export interface PracticeViewSwitchProps {
  value: PracticeView;
  onChange: (view: PracticeView) => void;
  unavailable?: PracticeView[];
  className?: string;
}

/** Radio-group segmented control; arrow keys move between views. */
export function PracticeViewSwitch({ value, onChange, unavailable = [], className }: PracticeViewSwitchProps): JSX.Element {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = PRACTICE_VIEWS.filter((v) => !unavailable.includes(v.value));

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    event.preventDefault();
    const current = enabled.findIndex((v) => v.value === value);
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const next = enabled[(current + delta + enabled.length) % enabled.length];
    if (next) {
      onChange(next.value);
      const index = PRACTICE_VIEWS.findIndex((v) => v.value === next.value);
      refs.current[index]?.focus();
    }
  };

  return (
    <div className={clsx("pls-segmented", className)} role="radiogroup" aria-label="Practice view" onKeyDown={handleKeyDown}>
      {PRACTICE_VIEWS.map((view, index) => {
        const checked = view.value === value;
        const off = unavailable.includes(view.value);
        return (
          <button
            key={view.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={off}
            title={view.description}
            className={clsx("pls-segmented__option", checked && "pls-segmented__option--active")}
            onClick={() => onChange(view.value)}
          >
            {view.label}
          </button>
        );
      })}
    </div>
  );
}
