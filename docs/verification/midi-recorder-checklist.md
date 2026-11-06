# MIDI performance recorder — manual verification checklist

Status: **not yet performed** (authored 2026-11-06 in a headless environment; automated Vitest
coverage only). Record the browser, OS, device/firmware and date next to each item when it is run.
Do not tick an item from memory.

Setup: open the studio, switch to **Create**. The **Record** button sits in the Create stage bar;
the full **Record** panel is in the context panel (Show panel). Choose the input in the device panel.

## A. On-screen piano and computer keys (no hardware)

- [ ] Record → play a few notes on the on-screen piano → Stop: the panel shows "Take ready", the
      note count, length in bars/beats and seconds, and the piano-roll preview.
- [ ] Play: the notes sound through the built-in sound with the recorded timing and velocities
      (quiet/loud), and light up on the piano's accompaniment layer; playing live meanwhile still
      lights your own keys and does not alter the take.
- [ ] Computer keys: Z/X/C… record; Space (sustain) extends the sounding length on playback.
- [ ] Stop recording while keys are held: nothing keeps sounding; the take ends at Stop.
- [ ] Record with nothing played → "Nothing was played, so no take was kept."
- [ ] Record while the progression is playing: playback stops first, the take starts.

## B. Count-in, metronome, loop

- [ ] Transport: Count-in on, Metronome on → Record: four clicks, "Count-in" badge, then
      "Recording"; the transport position counts bars; tempo and count-in controls are locked.
- [ ] Record exactly four bars of chords, stop a little after bar 4 → with "Fit loop to whole bars"
      on, the length reads "4 bars"; Loop on → the progression repeats seamlessly; a chord held
      across the loop point is released at the boundary and re-attacked.
- [ ] Loop off → playback stops at the recorded length including trailing silence.
- [ ] Transport Stop during a click-track take finishes the take; the previous progression and its
      loop are back in the transport.
- [ ] Pause / Resume / Restart from the recording panel and from the main transport agree.

## C. MIDI keyboard (Casio Celviano AP-470 or other)

Device: ______  Connection: ______  OS/browser: ______  Local Control: ______

- [ ] Device panel → Connect → the piano is listed and selected; "Hear what I play" is off (the
      piano's own sound plays, nothing is doubled).
- [ ] Record a four-bar progression with sustain pedal, dynamics and a repeated note → Stop →
      playback through the built-in sound reproduces onsets, lengths (pedal-extended), velocities
      and the repeated note.
- [ ] Output = the piano (Web MIDI): playback sounds on the piano on channel 2 while you play
      along on the keys; no doubled or stuck notes; Panic releases everything.
- [ ] Unplug the USB cable during a take: held notes are closed, a warning appears, the take can
      still be stopped and played.
- [ ] Switch the selected input during a take: notes held on the previous device are closed.
- [ ] Latency: with the calibrated latency offset applied, the first chord played on the downbeat
      of the count-in lands at bar 1 beat 1 in the preview (within a few ms).

## D. Save, reopen, export

- [ ] Name the take, Save → "Saved recordings" lists it; refresh the page → it is still listed;
      Load restores the same notes; Play works.
- [ ] Rename and Delete (with confirmation) from the list; deleting the open take marks it unsaved.
- [ ] Export MIDI → a `.mid` named after the take downloads; open it in a DAW / MIDI player
      (e.g. MuseScore, GarageBand, Logic, Reaper): correct tempo, time signature, notes, channels,
      sustain pedal, length (trailing silence kept). Compare with "Export MIDI" in the Project panel,
      which still exports the authored progression.
- [ ] Storage full / private mode: the save fails with a clear message, the take stays open and
      Export MIDI still works.
- [ ] Closing the tab with an unsaved take or during a take prompts before leaving.

## E. Regression

- [ ] Practice mode: step/timed/free practice unaffected; take playback never counts as learner input.
- [ ] Explore audition and "Play it for me" still work after a take was recorded and played.
- [ ] Mobile layout: the Record panel wraps; buttons are reachable; focus states visible; the
      recording badge is readable (text, not colour only).
