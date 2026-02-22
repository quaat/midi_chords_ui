"use client";

import type { SynthSettings, VoicingMode } from "@/types";

const INSTRUMENTS = [
  "1 Acoustic Grand Piano",
  "2 Bright Acoustic Piano",
  "3 Electric Grand Piano",
  "4 Honky-tonk Piano",
  "5 Electric Piano 1",
  "6 Electric Piano 2",
  "7 Harpsichord",
  "8 Clavinet",
  "9 Celesta",
  "10 Glockenspiel",
  "11 Music Box",
  "12 Vibraphone",
  "13 Marimba",
  "14 Xylophone",
  "15 Tubular Bells",
  "16 Dulcimer",
  "17 Drawbar Organ",
  "18 Percussive Organ",
  "19 Rock Organ",
  "20 Church Organ",
  "25 Acoustic Guitar (nylon)",
  "26 Acoustic Guitar (steel)",
  "33 Acoustic Bass",
  "41 Violin",
  "49 String Ensemble 1",
  "57 Trumpet",
  "74 Flute"
];

interface SettingsPanelProps {
  settings: SynthSettings;
  onSettingsChange: (settings: SynthSettings) => void;
  playbackTarget: "internal" | "webmidi";
  onPlaybackTargetChange: (target: "internal" | "webmidi") => void;
  midiAvailable: boolean;
  midiOutputs: { id: string; name: string }[];
  selectedMidiOutputId: string;
  onMidiOutputChange: (id: string) => void;
  midiError?: string;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function SettingsPanel({
  settings,
  onSettingsChange,
  playbackTarget,
  onPlaybackTargetChange,
  midiAvailable,
  midiOutputs,
  selectedMidiOutputId,
  onMidiOutputChange,
  midiError
}: SettingsPanelProps): JSX.Element {
  const set = <K extends keyof SynthSettings>(key: K, value: SynthSettings[K]): void => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Settings</h2>
        <span className="panel-subtitle">Generation + voicing + playback controls.</span>
      </header>
      <div className="settings-grid">
        <NumberField label="BPM" value={settings.tempoBpm} min={20} max={320} onChange={(v) => set("tempoBpm", v)} />
        <NumberField
          label="Time Sig Num"
          value={settings.timeSignature.numerator}
          min={1}
          max={12}
          onChange={(v) => set("timeSignature", { ...settings.timeSignature, numerator: v })}
        />
        <NumberField
          label="Time Sig Den"
          value={settings.timeSignature.denominator}
          min={1}
          max={16}
          onChange={(v) => set("timeSignature", { ...settings.timeSignature, denominator: v })}
        />
        <NumberField
          label="Default Measures"
          value={settings.defaultChordMeasures}
          min={0.125}
          max={16}
          step={0.125}
          onChange={(v) => set("defaultChordMeasures", v)}
        />
        <NumberField label="PPQ" value={settings.ticksPerBeat} min={24} max={1920} onChange={(v) => set("ticksPerBeat", v)} />
        <NumberField label="MIDI Channel" value={settings.midiChannel} min={1} max={16} onChange={(v) => set("midiChannel", v)} />
        <NumberField label="Velocity" value={settings.velocity} min={1} max={127} onChange={(v) => set("velocity", v)} />
        <label className="field">
          <span>Instrument (GM)</span>
          <select value={settings.program} onChange={(event) => set("program", Number(event.target.value))}>
            {INSTRUMENTS.map((name) => {
              const value = Number(name.split(" ")[0]);
              return (
                <option key={name} value={value}>
                  {name}
                </option>
              );
            })}
          </select>
        </label>
        <NumberField label="Base Octave" value={settings.baseOctave} min={0} max={8} onChange={(v) => set("baseOctave", v)} />
        <NumberField label="Bass Octave" value={settings.bassOctave} min={-1} max={7} onChange={(v) => set("bassOctave", v)} />
        <label className="field">
          <span>Voicing Mode</span>
          <select value={settings.voicingMode} onChange={(event) => set("voicingMode", event.target.value as VoicingMode)}>
            <option value="close">close</option>
            <option value="open">open</option>
            <option value="spread">spread</option>
            <option value="root5_3up">root5_3up</option>
          </select>
        </label>
        <label className="field checkbox-field">
          <span>Voice Leading</span>
          <input
            type="checkbox"
            checked={settings.voiceLeading}
            onChange={(event) => set("voiceLeading", event.target.checked)}
          />
        </label>
        <NumberField label="Max Spread" value={settings.maxSpread} min={12} max={72} onChange={(v) => set("maxSpread", v)} />
        <NumberField label="Min Note" value={settings.minNote} min={0} max={127} onChange={(v) => set("minNote", v)} />
        <NumberField label="Max Note" value={settings.maxNote} min={0} max={127} onChange={(v) => set("maxNote", v)} />
      </div>
      <div className="divider" />
      <div className="settings-grid">
        <label className="field">
          <span>Playback Target</span>
          <select
            value={playbackTarget}
            onChange={(event) => onPlaybackTargetChange(event.target.value as "internal" | "webmidi")}
          >
            <option value="internal">Internal Synth (Tone.js)</option>
            <option value="webmidi" disabled={!midiAvailable}>
              Web MIDI Device
            </option>
          </select>
        </label>
        <label className="field">
          <span>MIDI Output</span>
          <select
            value={selectedMidiOutputId}
            onChange={(event) => onMidiOutputChange(event.target.value)}
            disabled={!midiAvailable || playbackTarget !== "webmidi"}
          >
            <option value="">Select output</option>
            {midiOutputs.map((out) => (
              <option key={out.id} value={out.id}>
                {out.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!midiAvailable ? <div className="hint">{midiError ?? "Web MIDI unavailable in this browser."}</div> : null}
    </section>
  );
}
