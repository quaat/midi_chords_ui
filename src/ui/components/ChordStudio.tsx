"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Moon, RefreshCw, Sun } from "lucide-react";
import { parseChordSequence } from "@/parser/parseChordSequence";
import { resolveSequence } from "@/theory/renderSequence";
import { buildMidiFile } from "@/midi/buildMidiFile";
import type { SynthSettings } from "@/types";
import { SAMPLE_PROGRESSIONS } from "@/samples/progressions";
import { ChordEditor } from "@/ui/components/ChordEditor";
import { EventPreviewTable } from "@/ui/components/EventPreviewTable";
import { PianoKeyboard } from "@/ui/components/PianoKeyboard";
import { TimelineView } from "@/ui/components/TimelineView";
import { LeadSheetView } from "@/ui/components/LeadSheetView";
import { SettingsPanel } from "@/ui/components/SettingsPanel";
import { TransportBar } from "@/ui/components/TransportBar";
import { TonePlaybackEngine } from "@/playback/toneEngine";
import { getMidiAccess, getWebMidiState, WebMidiPlaybackEngine } from "@/playback/webMidiEngine";
import { PlaybackScheduler } from "@/playback/scheduler";

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
  voiceLeading: true,
  maxSpread: 30,
  minNote: 24,
  maxNote: 96
};

export function ChordStudio(): JSX.Element {
  const [settings, setSettings] = useState<SynthSettings>(DEFAULT_SETTINGS);
  const [inputText, setInputText] = useState<string>(SAMPLE_PROGRESSIONS[0].text);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [cursorLine, setCursorLine] = useState<number>(1);

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
  }, [playbackTarget, resolved.events, resolved.totalSeconds, settings.velocity, settings.midiChannel, loopEnabled]);

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

  return (
    <main className="studio-root">
      <header className="hero">
        <div>
          <h1>Chord to MIDI Studio</h1>
          <p>
            Parse plain-text chord charts, audition them in sync, and export a DAW-ready MIDI file. Browser-only, no
            backend.
          </p>
        </div>
        <div className="hero-actions">
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

      <section className="panel sample-panel">
        <header className="panel-header">
          <h2>Sample Progressions</h2>
          <span className="panel-subtitle">Load a starter chart with slash chords, rests, and alterations.</span>
        </header>
        <div className="sample-list">
          {SAMPLE_PROGRESSIONS.map((sample) => (
            <button
              key={sample.id}
              className="sample-card"
              onClick={() => {
                setInputText(sample.text);
                setSelectedEventIndex(null);
              }}
            >
              <strong>{sample.title}</strong>
              <span>{sample.description}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <ChordEditor value={inputText} onChange={setInputText} errors={parseResult.errors} onCursorLineChange={setCursorLine} />
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

      <section className="summary-row">
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

      <TimelineView
        events={resolved.events}
        activeEventIndex={activeEventIndex}
        selectedEventIndex={selectedEventIndex}
        onSelectEvent={setSelectedEventIndex}
        progressSeconds={progressSeconds}
        totalSeconds={resolved.totalSeconds}
      />

      <div className="grid-2">
        <PianoKeyboard activeNotes={activeNotes} currentChordLabel={currentChordLabel} />
        <LeadSheetView events={resolved.events} />
      </div>

      <EventPreviewTable
        events={resolved.events}
        activeEventIndex={activeEventIndex}
        selectedEventIndex={selectedEventIndex}
        onSelectEvent={setSelectedEventIndex}
      />
    </main>
  );
}
