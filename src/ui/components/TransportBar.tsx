"use client";

import { Pause, Play, Square, Repeat, SkipForward } from "lucide-react";

interface TransportBarProps {
  isPlaying: boolean;
  loopEnabled: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onPlayFromSelection: () => void;
  progressSeconds: number;
  totalSeconds: number;
  onSeek: (seconds: number) => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function TransportBar({
  isPlaying,
  loopEnabled,
  onTogglePlay,
  onStop,
  onToggleLoop,
  onPlayFromSelection,
  progressSeconds,
  totalSeconds,
  onSeek
}: TransportBarProps): JSX.Element {
  return (
    <section className="panel transport-panel">
      <header className="panel-header">
        <h2>Transport</h2>
        <span className="panel-subtitle">
          {formatTime(progressSeconds)} / {formatTime(totalSeconds)}
        </span>
      </header>
      <div className="transport-buttons">
        <button className="action-btn primary" onClick={onTogglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />} {isPlaying ? "Pause" : "Play"}
        </button>
        <button className="action-btn" onClick={onStop} aria-label="Stop playback">
          <Square size={16} /> Stop
        </button>
        <button className={loopEnabled ? "action-btn toggled" : "action-btn"} onClick={onToggleLoop} aria-label="Toggle loop">
          <Repeat size={16} /> Loop
        </button>
        <button className="action-btn" onClick={onPlayFromSelection} aria-label="Play from selected event">
          <SkipForward size={16} /> Play from Event
        </button>
      </div>
      <div className="seek-wrap">
        <input
          type="range"
          min={0}
          max={Math.max(0.001, totalSeconds)}
          step={0.01}
          value={Math.min(progressSeconds, totalSeconds)}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="Playback position"
        />
      </div>
    </section>
  );
}
