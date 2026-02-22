"use client";

import { useMemo, useRef } from "react";
import type { ParseError } from "@/types";

interface ChordEditorProps {
  value: string;
  onChange: (value: string) => void;
  errors: ParseError[];
  onCursorLineChange: (line: number) => void;
}

export function ChordEditor({ value, onChange, errors, onCursorLineChange }: ChordEditorProps): JSX.Element {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lines = useMemo(() => value.split(/\r?\n/), [value]);
  const errorLines = useMemo(() => new Set(errors.map((error) => error.line)), [errors]);

  const updateCursorLine = (): void => {
    if (!ref.current) {
      return;
    }
    const idx = ref.current.selectionStart;
    const line = value.slice(0, idx).split(/\r?\n/).length;
    onCursorLineChange(line);
  };

  return (
    <section className="panel editor-panel" aria-label="Chord Sequence Editor">
      <header className="panel-header">
        <h2>Chord Sequence</h2>
        <span className="panel-subtitle">One event per line, optional duration: `Cmaj7 | 0.5`</span>
      </header>
      <div className="editor-shell">
        <div className="line-numbers" aria-hidden>
          {lines.map((_, idx) => (
            <div key={idx} className={errorLines.has(idx + 1) ? "line-number error" : "line-number"}>
              {idx + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={ref}
          className="editor-input"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={updateCursorLine}
          onKeyUp={updateCursorLine}
          onSelect={updateCursorLine}
          aria-label="Chord sequence editor"
        />
      </div>
      {errors.length > 0 ? (
        <ul className="error-list" role="alert" aria-live="assertive">
          {errors.slice(0, 5).map((error) => (
            <li key={`${error.line}-${error.message}`}>
              <strong>Line {error.line}:</strong> {error.message}
              <code>{error.rawLine}</code>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ok-message">No parse errors.</div>
      )}
    </section>
  );
}
