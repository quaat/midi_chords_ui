"use client";

import { useSessionDispatch, useSessionStore } from "@/state/useSessionStore";
import { LabelModeSelect } from "@/ui/workspace/LabelModeSelect";

/** Label mode + reduced motion (shared by every mode's context panel). */
export function DisplaySettings(): JSX.Element {
  const dispatch = useSessionDispatch();
  const labelMode = useSessionStore((s) => s.labelMode);
  const reducedMotion = useSessionStore((s) => s.reducedMotion);
  return (
    <section className="pls-panel" aria-label="Display">
      <h2 className="pls-panel__title">Display</h2>
      <LabelModeSelect value={labelMode} onChange={(value) => dispatch({ type: "setLabelMode", labelMode: value })} />
      <label className="pls-check">
        <input type="checkbox" checked={reducedMotion} onChange={(event) => dispatch({ type: "setReducedMotion", reducedMotion: event.target.checked })} />
        <span>Reduce motion (static steps instead of falling notes)</span>
      </label>
    </section>
  );
}
