# Chord to MIDI Studio

A production-oriented Next.js web app for converting plain-text chord progressions into a standard MIDI file, with synchronized playback and visualizations.

## Stack

- Next.js 14 + React 18 + TypeScript
- Browser-only app (no backend)
- Tone.js internal synth fallback
- Web MIDI device output (when browser/device support exists)
- Vitest unit + smoke tests

## Features

- Editor with line numbers and live parse errors (line + message + offending input)
- Parser behavior aligned with the Python CLI spec:
  - one event per line: `<chord_symbol> [| duration_measures]`
  - ignores blank lines and `#` comments
  - optional float durations and global default duration
  - rests via `NC` / `N.C.`
- Chord engine supports:
  - triads: major, minor, dim, aug, sus2, sus4/sus
  - 6ths: 6, maj6, m6/min6
  - 7ths: 7, maj7, m7/min7, dim7/o7, m7b5/ø
  - extensions: 9/11/13 + major/minor variants
  - add tones: add2/add4/add6/add9/add11/add13
  - alterations: b5/#5/b9/#9/#11/b13
  - slash chords with lower bass handling
- MIDI generation in browser:
  - single-track SMF with time signature, tempo, and program change at tick 0
  - chord note-ons/note-offs by event duration
  - downloadable `.mid`
- Playback and sync:
  - play/pause/stop, loop, seek, and play-from-selected-event
  - target A: Web MIDI output device (with picker + refresh)
  - target B: internal Tone.js synth fallback
  - synchronized timeline and keyboard highlighting
- Visuals:
  - virtual keyboard (active notes highlighted)
  - chord block timeline with playhead
  - lead-sheet MVP (measure boxes + chord symbols)
  - sheet music notation rendered from generated MusicXML via OpenSheetMusicDisplay (OSMD)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Run dev server:

```bash
npm run dev
```

3. Open `http://localhost:3000`.

## Tests

```bash
npm test
npm run smoke
```

## Web MIDI Notes

- Web MIDI works in browsers that implement `navigator.requestMIDIAccess`.
- If unsupported or denied, the UI disables device routing and keeps internal synth playback enabled.
- To use Web MIDI output:
  1. Connect your external MIDI device.
  2. Select `Playback Target -> Web MIDI Device`.
  3. Pick the output port in `MIDI Output`.
  4. Click `Refresh MIDI Devices` if the device was connected after page load.

## Project Structure

```text
app/
  layout.tsx
  page.tsx
  globals.css
src/
  parser/
    parseChordSequence.ts
  theory/
    notes.ts
    chordParser.ts
    voicing.ts
    renderSequence.ts
  notation/
    generateMusicXml.ts
  midi/
    buildMidiFile.ts
  playback/
    types.ts
    toneEngine.ts
    webMidiEngine.ts
    scheduler.ts
  ui/components/
    ChordStudio.tsx
    ChordEditor.tsx
    SettingsPanel.tsx
    TransportBar.tsx
    TimelineView.tsx
    PianoKeyboard.tsx
    LeadSheetView.tsx
    SheetMusicView.tsx
    EventPreviewTable.tsx
  samples/
    progressions.ts
test/
  parser.test.ts
  theory.test.ts
  voicing.test.ts
  smoke.test.ts
```

## Limitations / Next Steps

- Lead-sheet rendering is an MVP chord-chart view (no full notation engraving yet).
- For full notation and export, extend with MusicXML generation + OSMD, or VexFlow rendering with slash stems and rhythmic notation.
