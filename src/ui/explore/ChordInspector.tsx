"use client";

import type { ChordDefinition } from "@/model/contracts";
import { formatPitchClass } from "@/music/pitch";
import { prettyDegree } from "@/ui/piano/pianoLabels";
import { chordDegreeRows, chordHeadline, slashBassText } from "@/ui/explore/exploreLogic";

export interface ChordInspectorProps {
  chord: ChordDefinition;
}

/** Context-panel inspection of one chord: root, quality, degrees with roles, slash bass. */
export function ChordInspector({ chord }: ChordInspectorProps): JSX.Element {
  const rows = chordDegreeRows(chord, 4);
  const slash = slashBassText(chord);
  const extras: string[] = [];
  if (chord.extensions.length > 0) extras.push(`Extensions: ${chord.extensions.map(prettyDegree).join(", ")}`);
  if (chord.alterations.length > 0) extras.push(`Alterations: ${chord.alterations.map(prettyDegree).join(", ")}`);
  if (chord.added.length > 0) extras.push(`Added: ${chord.added.map(prettyDegree).join(", ")}`);
  return (
    <section className="pls-panel" aria-label={`Chord ${chord.symbol}`}>
      <h2 className="pls-panel__title">{chord.symbol}</h2>
      <p className="pls-inspector__headline">{chordHeadline(chord)}</p>
      <dl className="pls-inspector__facts">
        <div>
          <dt>Root</dt>
          <dd>{formatPitchClass(chord.root, { unicode: true })}</dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd>{chord.qualityLabel}</dd>
        </div>
        {chord.bass ? (
          <div>
            <dt>Bass</dt>
            <dd>{formatPitchClass(chord.bass, { unicode: true })}</dd>
          </div>
        ) : null}
      </dl>
      <table className="pls-inspector__table">
        <caption className="pls-sr-only">Chord degrees</caption>
        <thead>
          <tr>
            <th scope="col">Degree</th>
            <th scope="col">Note</th>
            <th scope="col">Role</th>
            <th scope="col">Essential</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="pls-inspector__degree">{row.pretty}</td>
              <td>
                {row.noteName}
                {row.respelled ? <span title="Respelled enharmonically"> *</span> : null}
              </td>
              <td>{row.roleName}</td>
              <td>{row.essential ? "yes" : "optional"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {extras.length > 0 ? <p className="pls-inspector__note">{extras.join(" · ")}</p> : null}
      {slash !== "" ? <p className="pls-inspector__note">{slash}</p> : null}
      <p className="pls-inspector__note">Essential tones define the chord; optional ones may be left out by a voicing without changing its name.</p>
    </section>
  );
}
