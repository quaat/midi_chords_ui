"use client";

import { useId } from "react";
import clsx from "clsx";
import type { LabelMode } from "@/ui/piano/pianoLabels";
import { LABEL_MODES } from "@/ui/piano/pianoLabels";

export interface LabelModeSelectProps {
  value: LabelMode;
  onChange: (mode: LabelMode) => void;
  /** Modes that cannot be shown for the current material (e.g. fingers not authored). */
  unavailable?: LabelMode[];
  label?: string;
  className?: string;
}

export function LabelModeSelect({ value, onChange, unavailable = [], label = "Key labels", className }: LabelModeSelectProps): JSX.Element {
  const id = useId();
  return (
    <div className={clsx("pls-field", className)}>
      <label htmlFor={id} className="pls-field__label">
        {label}
      </label>
      <select id={id} className="pls-select" value={value} onChange={(event) => onChange(event.target.value as LabelMode)}>
        {LABEL_MODES.map((option) => {
          const off = unavailable.includes(option.value);
          return (
            <option key={option.value} value={option.value} disabled={off}>
              {option.label}
              {off ? " (not available)" : ""}
            </option>
          );
        })}
      </select>
    </div>
  );
}
