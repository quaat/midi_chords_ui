# ADR 0002 — MIDI performance recorder and recorded backing tracks

Status: accepted (2026-11-06). Advances the "recorded backing track" capability that the
reimplementation plan deferred (plan §"Accompaniment and backing tracks", M6 expansion), in the
smallest form that is useful for practice: record a take, loop it, save it, export it as `.mid`.

## Context

Learners want to record a short chord progression on their own instrument, loop it as a backing
track while they improvise, and keep it as a standard MIDI file. The studio already has a
normalised learner-input pipeline (`InputEvent` from MIDI, computer keyboard, on-screen piano),
one performed-note representation (`PerformanceTimeline`), one transport with loops, count-in,
metronome and output routing, a format-0 MIDI writer, and versioned local persistence. The
free-practice trace (`src/ui/practice/traceModel.ts`) approximates note lengths and is an
assessment visual, not a faithful recording.

## Decisions

1. **Capture is a list of normalised input events relative to an explicit start.**
   `src/recording/` owns a framework-free `PerformanceRecorder` fed by the three learner sources
   through `MidiInputManager.onEvent`, `ComputerKeyboardInput.onEvent` and `TouchInput.onEvent`
   (never `subscribeAttacks`, which drops note-offs and pedals; never transport note events, so
   playback is never recorded). Every event is stored with `atMs` = performance-clock time minus
   `zeroMs`, the explicit recording start. Tempo and time signature are fixed metadata of the take
   (v1); no quantisation is applied anywhere.
2. **Notes are derived, not stored.** `pairRecordedNotes(events, durationMs)` replays the events
   through a fresh `HeldStateTracker`, so note-on/off matching, velocity-0 note-offs, retriggers,
   unmatched note-offs, sustain/sostenuto hold and per-device resets follow the live input rules.
   Each note carries both its pressed length and its pedal-extended sounding length. Later
   features (overdub, editing, different pedal rules) can re-interpret the same capture.
3. **Playback reuses the shared timeline and transport.** `recordingTimeline()` turns a take into a
   `PerformanceTimeline` (part `"accompaniment"`, sounding lengths, one occurrence per bar). The
   runtime loads it into the **main transport** as material of a new kind `"recording"` — the path
   exercises and charts already use — so play/pause/stop/loop/tempo/metronome/count-in, output
   engine switching (Tone / Web MIDI), piano highlighting (accompaniment layer) and the position
   strip work unchanged. The Create editor document is never replaced: the existing "The transport
   is playing …" notice offers the progression back, and an edit reloads it. The take stays loaded
   across mode switches (unlike exercise material) so a backing loop survives a visit to Explore.
   *Trade-off:* only one thing plays at a time; recording over a playing progression, or looping a
   take while auditioning chords in Explore, is not supported in this iteration.
4. **Count-in and metronome come from the transport.** When the transport has a count-in or the
   metronome on, Record loads a temporary click-track timeline (metronome notes only), plays it,
   derives `zeroMs` from the transport clock (beat 0 = end of the count-in), and restores the
   previous material and loop when the take stops. Notes played during the count-in are not part
   of the take except an 80 ms anticipation window (clamped to 0); pedal state established before
   the downbeat is written as pedal events at 0. Tempo and count-in controls are locked while
   recording. *Trade-off:* pickups (anacruses) are not captured with a count-in; record without one.
5. **Loop length = recorded length; "Fit loop to whole bars" is an option.** The loop covers the
   full capture including trailing silence. The option rounds to the *nearest* bar but never fewer
   bars than the last note onset needs, so a take stopped slightly after the last bar line loops as
   the intended number of bars. It defaults on for takes recorded with a count-in.
6. **Export extends the existing writer.** `buildMidiFromTimeline` gained additive options:
   `controllers` (CC events), `channelMode: "note"` (keep a note's own channel) and `trackName`.
   `buildMidiFromRecording` exports pressed lengths, recorded channels, CC64/66/67 pedal events,
   tempo, time signature and end-of-track at the recorded length, 480 PPQ. The progression export
   (`exportMidi`) is untouched and separate.
7. **Persistence follows the project store.** `RecordingStore` (`pls:recording:<id>` + index)
   validates every document, limits events (20 000) and serialised size (~1.5 M chars), keeps the
   previous record on a failed write, never overwrites newer-schema records, and rebuilds a damaged
   index. Recordings are not part of the chord-project document and (for now) not part of the
   backup file.

## Consequences

- Faithful timing, velocity, polyphony, repeats and pedal are preserved from all input sources;
  stuck notes are impossible by construction (stop boundary, device switch and panic all close
  notes in the capture; the transport releases notes on every stop/seek/loop).
- Live playing during take playback is independent: input never reaches the transport and
  playback never reaches the learner input or the practice assessment.
- Monitoring is unchanged: a digital piano with Local Control on keeps its own sound; the app's
  monitor stays off for MIDI input by default.
- Hardware/browser behaviour (AP-470, Web MIDI timing, Tone output) is not verified in the
  authoring environment; see `docs/verification/midi-recorder-checklist.md`.
