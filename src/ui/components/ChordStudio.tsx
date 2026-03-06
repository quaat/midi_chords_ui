"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Download, Moon, RefreshCw, Sun } from "lucide-react";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { resolveSequence } from "@/theory/renderSequence";
import { buildMidiFile } from "@/midi/buildMidiFile";
import type { SynthSettings } from "@/types";
import { ChordEditor } from "@/ui/components/ChordEditor";
import { ChordPathwaysPanel } from "@/ui/components/ChordPathwaysPanel";
import { EventPreviewTable } from "@/ui/components/EventPreviewTable";
import { PianoKeyboard } from "@/ui/components/PianoKeyboard";
import { TimelineView } from "@/ui/components/TimelineView";
import { LeadSheetView } from "@/ui/components/LeadSheetView";
import { SheetMusicView } from "@/ui/components/SheetMusicView";
import { SettingsPanel } from "@/ui/components/SettingsPanel";
import type { TabOption } from "@/ui/components/Tabs";
import { Tabs } from "@/ui/components/Tabs";
import { TransportBar } from "@/ui/components/TransportBar";
import { TonePlaybackEngine } from "@/playback/toneEngine";
import { getMidiAccess, getWebMidiState, WebMidiPlaybackEngine } from "@/playback/webMidiEngine";
import { PlaybackScheduler } from "@/playback/scheduler";

type PreviewTab = "timeline" | "keyboard" | "leadsheet" | "sheet" | "events";
type MobileMode = "compose" | "preview";

const PREVIEW_TABS: TabOption<PreviewTab>[] = [
  { value: "timeline", label: "Timeline" },
  { value: "keyboard", label: "Keyboard" },
  { value: "leadsheet", label: "Lead Sheet" },
  { value: "sheet", label: "Sheet Music" },
  { value: "events", label: "Events" }
];

const MOBILE_MODE_TABS: TabOption<MobileMode>[] = [
  { value: "compose", label: "Compose" },
  { value: "preview", label: "Preview" }
];

const DEFAULT_SETTINGS: SynthSettings = {
  tempoBpm: 110,
  timeSignature: { numerator: 4, denominator: 4 },
  defaultChordMeasures: 1,
  ticksPerBeat: 480,
  midiChannel: 1,
  velocity: 92,
  program: 1,
  baseOctave: 4,
  bassOctave: 2,
  voicingMode: "close",
  arpeggiateOctaves: 0,
  voiceLeading: true,
  maxSpread: 30,
  minNote: 24,
  maxNote: 96
};

export function ChordStudio(): JSX.Element {
  const [settings, setSettings] = useState<SynthSettings>(DEFAULT_SETTINGS);
  const [inputText, setInputText] = useState<string>("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [cursorLine, setCursorLine] = useState<number>(1);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("timeline");
  const [mobileMode, setMobileMode] = useState<MobileMode>("compose");
  const [settingsExpanded, setSettingsExpanded] = useState(true);

  const [playbackTarget, setPlaybackTarget] = useState<"internal" | "webmidi">("internal");
  const [midiOutputs, setMidiOutputs] = useState<{ id: string; name: string }[]>([]);
  const [midiAvailable, setMidiAvailable] = useState(false);
  const [midiError, setMidiError] = useState<string | undefined>(undefined);
  const [selectedMidiOutputId, setSelectedMidiOutputId] = useState<string>("");

  const [activeEventIndex, setActiveEventIndex] = useState<number | null>(null);
  const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(null);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);

  const parseResult = useMemo(
    () => parseChordSequence(inputText, settings.defaultChordMeasures),
    [inputText, settings.defaultChordMeasures]
  );

  const resolved = useMemo(() => resolveSequence(parseResult, settings), [parseResult, settings]);

  const midiResult = useMemo(() => buildMidiFile(resolved, settings), [resolved, settings]);

  const currentChordLabel =
    activeEventIndex !== null ? resolved.events.find((event) => event.index === activeEventIndex)?.chordSymbol ?? "" : "";

  const toneEngineRef = useRef<TonePlaybackEngine>(new TonePlaybackEngine());
  const webMidiEngineRef = useRef<WebMidiPlaybackEngine>(new WebMidiPlaybackEngine());
  const schedulerRef = useRef<PlaybackScheduler | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const refreshMidiOutputs = useCallback(async (): Promise<void> => {
    const state = await getWebMidiState();
    setMidiAvailable(state.available);
    setMidiOutputs(state.outputs);
    setMidiError(state.error);
    if (state.outputs.length > 0 && !state.outputs.some((output) => output.id === selectedMidiOutputId)) {
      setSelectedMidiOutputId(state.outputs[0].id);
    }
  }, [selectedMidiOutputId]);

  useEffect(() => {
    void refreshMidiOutputs();
  }, [refreshMidiOutputs]);

  useEffect(() => {
    let cancelled = false;
    const connect = async (): Promise<void> => {
      if (!midiAvailable || !selectedMidiOutputId) {
        webMidiEngineRef.current.setOutput(null);
        return;
      }
      const access = await getMidiAccess();
      const output = access?.outputs.get(selectedMidiOutputId) ?? null;
      if (!cancelled) {
        webMidiEngineRef.current.setOutput(output);
      }
    };
    void connect();
    return () => {
      cancelled = true;
    };
  }, [midiAvailable, selectedMidiOutputId]);

  useEffect(() => {
    const engine = playbackTarget === "webmidi" ? webMidiEngineRef.current : toneEngineRef.current;
    schedulerRef.current?.stop();
    schedulerRef.current = new PlaybackScheduler(
      engine,
      resolved.events,
      resolved.totalSeconds,
      settings.velocity,
      settings.midiChannel,
      settings.arpeggiateOctaves,
      {
        onProgress: (seconds) => setProgressSeconds(seconds),
        onActiveEvent: (eventIndex, notes) => {
          setActiveEventIndex(eventIndex);
          setActiveNotes(notes);
        },
        onStop: () => {
          setIsPlaying(false);
          setActiveNotes([]);
          setActiveEventIndex(null);
        }
      }
    );
    schedulerRef.current.setLoop(loopEnabled);

    return () => {
      schedulerRef.current?.stop();
    };
  }, [
    playbackTarget,
    resolved.events,
    resolved.totalSeconds,
    settings.velocity,
    settings.midiChannel,
    settings.arpeggiateOctaves,
    loopEnabled
  ]);

  const togglePlay = async (): Promise<void> => {
    if (parseResult.errors.length > 0 || resolved.events.length === 0) {
      return;
    }

    if (!schedulerRef.current) {
      return;
    }

    if (isPlaying) {
      schedulerRef.current.pause();
      setIsPlaying(false);
      return;
    }

    await schedulerRef.current.play();
    setIsPlaying(true);
  };

  const stop = (): void => {
    schedulerRef.current?.stop();
    setIsPlaying(false);
  };

  const playFromSelected = async (): Promise<void> => {
    if (!schedulerRef.current || resolved.events.length === 0 || parseResult.errors.length > 0) {
      return;
    }

    const fallbackIndex = resolved.events.findIndex((event) => event.line >= cursorLine);
    const targetIndex = selectedEventIndex ?? (fallbackIndex >= 0 ? resolved.events[fallbackIndex].index : 0);
    const event = resolved.events.find((item) => item.index === targetIndex);
    const startSeconds = event?.startSeconds ?? 0;
    schedulerRef.current.stop();
    await schedulerRef.current.play(startSeconds);
    setIsPlaying(true);
  };

  const seek = async (seconds: number): Promise<void> => {
    if (!schedulerRef.current) {
      return;
    }

    const wasPlaying = isPlaying;
    if (wasPlaying) {
      schedulerRef.current.pause();
      setIsPlaying(false);
    }

    schedulerRef.current.setPosition(seconds);
    setProgressSeconds(seconds);

    if (wasPlaying) {
      await schedulerRef.current.play(seconds);
      setIsPlaying(true);
    }
  };

  const handleDownloadMidi = (): void => {
    const url = URL.createObjectURL(midiResult.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "chord-sequence.mid";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const previewPanelId = `preview-panel-${previewTab}`;
  const previewTabId = `preview-tab-${previewTab}`;

  return (
    <main className="studio-root studio-shell" data-mobile-mode={mobileMode}>
      <header className="topbar-shell">
        <div className="topbar-title">
          <h1>Chord to MIDI Studio</h1>
          <p>Compose, audition, and export MIDI with synchronized notation and event previews.</p>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} {theme === "dark" ? "Light" : "Dark"}
          </button>
          <button
            className="action-btn primary"
            disabled={parseResult.errors.length > 0 || resolved.events.length === 0}
            onClick={handleDownloadMidi}
          >
            <Download size={16} /> Download MIDI
          </button>
        </div>
      </header>

      <section className="summary-row summary-chips">
        <div className="summary-pill">
          Tempo: <strong>{settings.tempoBpm} BPM</strong>
        </div>
        <div className="summary-pill">
          Signature: <strong>{settings.timeSignature.numerator}/{settings.timeSignature.denominator}</strong>
        </div>
        <div className="summary-pill">
          Total Length: <strong>{resolved.totalSeconds.toFixed(2)}s</strong>
        </div>
        <div className="summary-pill">
          Events: <strong>{resolved.events.length}</strong>
        </div>
        <button className="icon-btn" onClick={() => void refreshMidiOutputs()}>
          <RefreshCw size={14} /> Refresh MIDI Devices
        </button>
      </section>

      <div className="mobile-mode-switch">
        <Tabs
          tabs={MOBILE_MODE_TABS}
          value={mobileMode}
          onChange={setMobileMode}
          ariaLabel="Workspace mode"
          idBase="mobile-mode"
          variant="segmented"
          linkPanels={false}
        />
      </div>

      <div className="content-grid">
        <aside className="compose-sidebar">
          <ChordEditor value={inputText} onChange={setInputText} errors={parseResult.errors} onCursorLineChange={setCursorLine} />
          <ChordPathwaysPanel
            sourceEvents={parseResult.events}
            hasParseErrors={parseResult.errors.length > 0}
            defaultTurnaroundMeasures={settings.defaultChordMeasures}
            onApplyExpandedText={setInputText}
          />
          <section className="compose-settings">
            <button
              className="icon-btn settings-toggle"
              onClick={() => setSettingsExpanded((prev) => !prev)}
              aria-expanded={settingsExpanded}
              aria-controls="compose-settings-panel"
            >
              {settingsExpanded ? "Hide Settings" : "Show Settings"}
            </button>
            <div
              id="compose-settings-panel"
              className={clsx("compose-settings-panel", {
                "is-collapsed": !settingsExpanded
              })}
            >
              <SettingsPanel
                settings={settings}
                onSettingsChange={setSettings}
                playbackTarget={playbackTarget}
                onPlaybackTargetChange={setPlaybackTarget}
                midiAvailable={midiAvailable}
                midiOutputs={midiOutputs}
                selectedMidiOutputId={selectedMidiOutputId}
                onMidiOutputChange={setSelectedMidiOutputId}
                midiError={midiError}
              />
            </div>
          </section>
        </aside>

        <section className="preview-workspace" aria-label="Preview Workspace">
          <div className="workspace-transport">
            <TransportBar
              isPlaying={isPlaying}
              loopEnabled={loopEnabled}
              onTogglePlay={() => {
                void togglePlay();
              }}
              onStop={stop}
              onToggleLoop={() => {
                setLoopEnabled((prev) => {
                  const next = !prev;
                  schedulerRef.current?.setLoop(next);
                  return next;
                });
              }}
              onPlayFromSelection={() => {
                void playFromSelected();
              }}
              progressSeconds={progressSeconds}
              totalSeconds={resolved.totalSeconds}
              onSeek={(seconds) => {
                void seek(seconds);
              }}
            />
          </div>

          <div className="preview-tabs-wrap">
            <Tabs tabs={PREVIEW_TABS} value={previewTab} onChange={setPreviewTab} ariaLabel="Preview panels" idBase="preview" />
          </div>

          <div className="preview-tabpanel" id={previewPanelId} role="tabpanel" aria-labelledby={previewTabId}>
            {previewTab === "timeline" ? (
              <TimelineView
                events={resolved.events}
                activeEventIndex={activeEventIndex}
                selectedEventIndex={selectedEventIndex}
                onSelectEvent={setSelectedEventIndex}
                progressSeconds={progressSeconds}
                totalSeconds={resolved.totalSeconds}
              />
            ) : null}

            {previewTab === "keyboard" ? <PianoKeyboard activeNotes={activeNotes} currentChordLabel={currentChordLabel} /> : null}
            {previewTab === "leadsheet" ? <LeadSheetView events={resolved.events} /> : null}
            {previewTab === "sheet" ? (
              <SheetMusicView
                events={resolved.events}
                settings={settings}
                hasParseErrors={parseResult.errors.length > 0}
                activeEventIndex={activeEventIndex}
              />
            ) : null}
            {previewTab === "events" ? (
              <EventPreviewTable
                events={resolved.events}
                activeEventIndex={activeEventIndex}
                selectedEventIndex={selectedEventIndex}
                onSelectEvent={setSelectedEventIndex}
              />
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
