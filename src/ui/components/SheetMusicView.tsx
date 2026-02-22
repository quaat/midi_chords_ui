"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ResolvedEvent, SynthSettings } from "@/types";
import { generateMusicXml } from "@/notation/generateMusicXml";

interface SheetMusicViewProps {
  events: ResolvedEvent[];
  settings: SynthSettings;
  hasParseErrors: boolean;
  activeEventIndex: number | null;
}

interface OsmdCursorLike {
  hide: () => void;
  show: () => void;
  reset: () => void;
  next: () => void;
  iterator?: {
    CurrentMeasure?: Record<string, unknown>;
    EndReached?: boolean;
  };
}

interface OsmdLike {
  load: (xml: string) => Promise<void>;
  render: () => void;
  Zoom: number;
  cursor?: OsmdCursorLike;
}

type OsmdConstructor = new (container: HTMLElement, options: Record<string, unknown>) => OsmdLike;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function resolveCursorMeasureNumber(currentMeasure?: Record<string, unknown>): number | null {
  const explicitMeasureNumber =
    toFiniteNumber(currentMeasure?.["MeasureNumber"]) ??
    toFiniteNumber(currentMeasure?.["measureNumber"]) ??
    toFiniteNumber(currentMeasure?.["MeasureNumberInSystem"]);

  if (explicitMeasureNumber !== null) {
    return explicitMeasureNumber >= 1 ? explicitMeasureNumber : 1;
  }

  const listIndex = toFiniteNumber(currentMeasure?.["measureListIndex"]);
  if (listIndex !== null) {
    return Math.max(1, listIndex + 1);
  }

  return null;
}

export function SheetMusicView({ events, settings, hasParseErrors, activeEventIndex }: SheetMusicViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OsmdLike | null>(null);
  const renderVersionRef = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);

  const musicXmlResult = useMemo(() => generateMusicXml(events, settings), [events, settings]);
  const maxMeasureNumber = useMemo(() => {
    const values = Object.values(musicXmlResult.eventMap).map((entry) => entry.measureNumber);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [musicXmlResult.eventMap]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (hasParseErrors || events.length === 0) {
      renderVersionRef.current += 1;
      container.innerHTML = "";
      osmdRef.current = null;
      setRenderError(null);
      return;
    }

    let cancelled = false;
    const renderVersion = ++renderVersionRef.current;

    const render = async (): Promise<void> => {
      try {
        const osmdModule = await import("opensheetmusicdisplay");
        if (cancelled || renderVersion !== renderVersionRef.current || !containerRef.current) {
          return;
        }

        const OpenSheetMusicDisplay = osmdModule.OpenSheetMusicDisplay as unknown as OsmdConstructor;
        const containerNode = containerRef.current;
        containerNode.innerHTML = "";
        const osmd = new OpenSheetMusicDisplay(containerNode, {
          autoResize: true,
          drawTitle: false,
          drawPartNames: false,
          drawComposer: false,
          drawCredits: false,
          followCursor: true,
          backend: "svg"
        });
        osmdRef.current = osmd;
        await osmd.load(musicXmlResult.xml);
        if (cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }
        osmd.Zoom = zoom;
        osmd.render();
        if (cancelled || renderVersion !== renderVersionRef.current) {
          return;
        }
        if (osmd.cursor) {
          osmd.cursor.hide();
        }
        setRenderError(null);
      } catch (error) {
        setRenderError(error instanceof Error ? error.message : "Failed to render sheet music.");
      }
    };

    void render();

    return () => {
      cancelled = true;
    };
  }, [musicXmlResult.xml, hasParseErrors, events.length, zoom]);

  useEffect(() => {
    const activeLocation = activeEventIndex !== null ? musicXmlResult.eventMap[activeEventIndex] : undefined;
    if (!activeLocation || !containerRef.current) {
      return;
    }

    const scrollable = containerRef.current;
    const maxScroll = Math.max(0, scrollable.scrollWidth - scrollable.clientWidth);
    const ratio = maxMeasureNumber > 1 ? (activeLocation.measureNumber - 1) / (maxMeasureNumber - 1) : 0;
    scrollable.scrollTo({
      left: ratio * maxScroll,
      behavior: "smooth"
    });

    const osmd = osmdRef.current;
    if (osmd?.cursor) {
      try {
        const cursor = osmd.cursor;
        cursor.reset();
        cursor.show();
        let guard = 0;
        while (guard < 4000) {
          const currentMeasureNumber = resolveCursorMeasureNumber(cursor.iterator?.CurrentMeasure);
          if (currentMeasureNumber !== null && currentMeasureNumber >= activeLocation.measureNumber) {
            break;
          }

          if (cursor.iterator?.EndReached) {
            break;
          }

          cursor.next();
          guard += 1;
        }
      } catch {
        // Cursor API differs across OSMD versions; rendering still works without cursor sync.
      }
    }
  }, [activeEventIndex, maxMeasureNumber, musicXmlResult.eventMap]);

  const activeMeasure = activeEventIndex !== null ? musicXmlResult.eventMap[activeEventIndex]?.measureNumber : undefined;

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Sheet Music</h2>
        <span className="panel-subtitle">MusicXML engraving rendered with OpenSheetMusicDisplay.</span>
      </header>
      <div className="notation-controls">
        <label>
          <span>Zoom</span>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Sheet music zoom"
          />
        </label>
        <span className="notation-zoom-value">{zoom.toFixed(2)}x</span>
        {activeMeasure !== undefined ? <span className="notation-active">Active measure: {activeMeasure}</span> : null}
      </div>

      {hasParseErrors ? <div className="notation-empty">Fix parse errors to render notation.</div> : null}
      {!hasParseErrors && events.length === 0 ? <div className="notation-empty">Add chords to render notation.</div> : null}
      {!hasParseErrors && events.length > 0 && renderError ? <div className="notation-empty">{renderError}</div> : null}

      {!hasParseErrors && events.length > 0 ? (
        <div className="notation-container" ref={containerRef} aria-label="Sheet music notation view" />
      ) : null}
    </section>
  );
}
