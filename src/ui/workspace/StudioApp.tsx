"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import type { PerformedNote } from "@/model/contracts";
import { parsePitchClass, pitchClassOf } from "@/music/pitch";
import { beatsPerBar } from "@/music/legacy";
import { useSessionDispatch, useSessionStore } from "@/state/useSessionStore";
import { createKeyLayout, defaultRangeForWidth } from "@/ui/piano/geometry";
import type { KeyLayout, MidiRange } from "@/ui/piano/geometry";
import { InteractivePiano } from "@/ui/piano/InteractivePiano";
import { buildLabels, midiToNoteName, prettyDegree, scaleDegreeLabels, spelledToName } from "@/ui/piano/pianoLabels";
import { useElementSize } from "@/ui/piano/useElementSize";
import { CreateContextPanel, CreateStage } from "@/ui/create/CreateMode";
import { ExploreContextPanel, ExploreCurrentNext, ExploreStage } from "@/ui/explore/ExploreMode";
import { degreeLabelMap } from "@/ui/explore/exploreLogic";
import { LearnView } from "@/ui/learn/LearnView";
import { MyPracticeView } from "@/ui/myPractice/MyPracticeView";
import { PracticeContextPanel, PracticeMode } from "@/ui/practice/PracticeMode";
import { SongsView } from "@/ui/songs/SongsView";
import { DisplaySettings } from "@/ui/runtime/DisplaySettings";
import { OnboardingCard } from "@/ui/runtime/OnboardingCard";
import { StudioRuntimeProvider } from "@/ui/runtime/StudioRuntime";
import { PianoLayoutContext } from "@/ui/runtime/runtimeContext";
import { formatPositionLabel, learnerNotesOf, sameMidiSet, uniqueSorted } from "@/ui/runtime/runtimeHelpers";
import {
  useCurrentOccurrence,
  useDevices,
  useExploreState,
  useHeldState,
  useMaterial,
  usePianoTargets,
  useSounding,
  useStudioRuntime,
  useTransportState
} from "@/ui/runtime/useStudioRuntime";
import { CurrentNextStrip } from "@/ui/workspace/CurrentNextStrip";
import { DevicePanel } from "@/ui/workspace/DevicePanel";
import { TransportControls } from "@/ui/workspace/TransportControls";
import type { ModeContent } from "@/ui/workspace/WorkspaceShell";
import { WorkspaceShell } from "@/ui/workspace/WorkspaceShell";

/** Client root: studio runtime (session, transport, input, persistence) + workspace shell. */
export function StudioApp(): JSX.Element {
  return (
    <StudioRuntimeProvider>
      <StudioWorkspace />
    </StudioRuntimeProvider>
  );
}

// ---------------------------------------------------------------------------
// Piano (re-renders on input / playback highlights only)
// ---------------------------------------------------------------------------

interface RuntimePianoProps {
  range: MidiRange;
  layout: KeyLayout | undefined;
  height: number;
}

function noteNameFor(midi: number, sounding: readonly PerformedNote[]): string {
  const note = sounding.find((candidate) => candidate.midi === midi && candidate.spelled);
  return note && note.spelled ? spelledToName(note.spelled) : midiToNoteName(midi);
}

function RuntimePiano({ range, layout, height }: RuntimePianoProps): JSX.Element {
  const runtime = useStudioRuntime();
  const dispatch = useSessionDispatch();
  const labelMode = useSessionStore((s) => s.labelMode);
  const mode = useSessionStore((s) => s.mode);
  const layer = usePianoTargets();
  const held = useHeldState();
  const sounding = useSounding();
  const position = useCurrentOccurrence();
  const material = useMaterial();
  const [explore] = useExploreState();

  const labels = useMemo(() => {
    const map = new Map<number, string>();
    if (labelMode === "none") {
      return map;
    }
    if (layer.labels) {
      return layer.labels;
    }
    const midis = uniqueSorted([...layer.targets.map((t) => t.midi), ...held.pressed, ...held.sustained, ...sounding.demonstration, ...sounding.accompaniment]);
    const fromTargets = new Map(layer.notes.map((note) => [note.midi, note]));
    if (labelMode === "noteNames") {
      midis.forEach((midi) => {
        const target = fromTargets.get(midi);
        map.set(midi, target && target.noteName ? target.noteName : noteNameFor(midi, sounding.notes));
      });
      return map;
    }
    if (labelMode === "chordDegrees") {
      const chord = layer.chord ?? (position.current ? position.current.chord ?? null : null);
      const computed = chord ? degreeLabelMap(chord, midis) : buildLabels("chordDegrees", sounding.notes);
      midis.forEach((midi) => {
        const target = fromTargets.get(midi);
        const label = target && target.degreeLabel ? prettyDegree(target.degreeLabel) : computed.get(midi);
        if (label !== undefined) {
          map.set(midi, label);
        }
      });
      return map;
    }
    if (labelMode === "scaleDegrees") {
      let tonicPc: number | null = null;
      if (mode === "explore" && explore.tab === "scale") {
        const tonic = parsePitchClass(explore.tonic);
        tonicPc = tonic ? pitchClassOf(tonic) : null;
      } else if (material.sequence && material.sequence.key) {
        tonicPc = pitchClassOf(material.sequence.key.tonic);
      } else if (layer.chord) {
        tonicPc = pitchClassOf(layer.chord.root);
      }
      return tonicPc === null ? map : scaleDegreeLabels(midis, tonicPc);
    }
    return buildLabels("fingers", sounding.notes);
  }, [labelMode, layer, held, sounding, position, material, mode, explore.tab, explore.tonic]);

  const fitNotes = useMemo(() => layer.targets.map((t) => t.midi), [layer]);
  const onNoteOn = useCallback((midi: number, velocity: number) => runtime.touchNoteOn(midi, velocity), [runtime]);
  const onNoteOff = useCallback((midi: number) => runtime.touchNoteOff(midi), [runtime]);
  const onReleaseAll = useCallback(() => runtime.touchReleaseAll(), [runtime]);

  return (
    <InteractivePiano
      range={range}
      layout={layout}
      onRangeChange={(next) => dispatch({ type: "setPianoRange", range: next })}
      labelMode={labelMode}
      labels={labels}
      targets={layer.targets}
      learnerPressed={held.pressed}
      learnerSustained={held.sustained}
      demonstration={sounding.demonstration}
      accompaniment={sounding.accompaniment}
      onNoteOn={onNoteOn}
      onNoteOff={onNoteOff}
      onReleaseAll={onReleaseAll}
      heights={{ white: height }}
      fitNotes={fitNotes}
    />
  );
}

// ---------------------------------------------------------------------------
// Transport, devices, current/next
// ---------------------------------------------------------------------------

function RuntimeTransport(): JSX.Element {
  const runtime = useStudioRuntime();
  const status = useTransportState();
  const material = useMaterial();
  const timeSignature = material.timeline ? material.timeline.timeSignature : undefined;
  const getPositionLabel = useCallback(() => formatPositionLabel(runtime.getTransportSnapshot().positionBeats, timeSignature), [runtime, timeSignature]);
  const barBeats = timeSignature ? Math.max(1, Math.round(beatsPerBar(timeSignature))) : 4;
  return (
    <TransportControls
      state={status.state}
      onPlayPause={() => runtime.togglePlay()}
      onStop={() => (material.demonstrating ? runtime.stopDemonstration() : runtime.stop())}
      tempoBpm={Math.round(status.tempoBpm)}
      onTempoChange={(bpm) => runtime.transport.setTempo(bpm)}
      countIn={status.countInBeats > 0}
      onCountInChange={(enabled) => runtime.transport.setCountIn(enabled ? barBeats : 0)}
      loop={status.loop !== null}
      onLoopChange={(enabled) => runtime.transport.setLoop(enabled ? { startBeat: 0, endBeat: status.totalBeats } : null)}
      metronome={status.metronomeEnabled}
      onMetronomeChange={(enabled) => runtime.transport.setMetronome(enabled)}
      onPlayForMe={() => void runtime.playForMe()}
      playForMeActive={material.demonstrating}
      getPositionLabel={getPositionLabel}
      disabled={!material.timeline}
    />
  );
}

function RuntimeDevicePanel(): JSX.Element {
  const devices = useDevices();
  const dispatch = useSessionDispatch();
  const inputSource = useSessionStore((s) => s.inputSource);
  const messages = [devices.statusMessage, ...devices.routingWarnings].filter((text): text is string => typeof text === "string" && text !== "");
  return (
    <DevicePanel
      inputSource={inputSource}
      onInputSourceChange={(source) => dispatch({ type: "setInputSource", source })}
      midiPermission={devices.permission}
      onRequestMidiAccess={devices.requestAccess}
      midiInputs={devices.inputs}
      selectedInputId={devices.selectedInputId}
      onSelectInput={devices.selectInput}
      midiOutputs={devices.outputs}
      selectedOutputId={devices.selectedOutputId}
      onSelectOutput={devices.selectOutput}
      monitoring={devices.monitoring}
      onMonitoringChange={devices.setMonitoring}
      onPanic={devices.panic}
      statusMessage={messages.length > 0 ? messages.join(" ") : undefined}
      lastInput={devices.lastInput}
    />
  );
}

function RuntimeCurrentNext(): JSX.Element {
  const runtime = useStudioRuntime();
  const mode = useSessionStore((s) => s.mode);
  const position = useCurrentOccurrence();
  const material = useMaterial();
  const status = useTransportState();
  const held = useHeldState();
  const layer = usePianoTargets();
  const timeSignature = material.timeline ? material.timeline.timeSignature : undefined;
  const getPositionLabel = useCallback(() => formatPositionLabel(runtime.getTransportSnapshot().positionBeats, timeSignature), [runtime, timeSignature]);
  const timeline = runtime.transport.getTimeline();
  const detailOf = (occurrenceId: string | null): string | undefined => {
    const notes = learnerNotesOf(timeline, occurrenceId);
    return notes.length > 0 ? notes.map((n) => (n.spelled ? spelledToName(n.spelled) : midiToNoteName(n.midi))).join(" ") : undefined;
  };
  const active = status.state === "playing" || status.state === "countingIn";
  const targetMidis = layer.targets.map((t) => t.midi);
  const matched = targetMidis.length > 0 && sameMidiSet(targetMidis, held.pressed);
  let prompt: string;
  if (material.demonstrating) {
    prompt = "Listen and watch the keys light up; then try it yourself.";
  } else if (mode === "create") {
    prompt = active ? "Edits play as soon as you make them." : "Click a block to jump there; press Play to hear the progression.";
  } else if (matched) {
    prompt = "That's the chord.";
  } else if (active) {
    prompt = "Play the highlighted keys as the notes reach them.";
  } else {
    prompt = "Press Play for a count-in, or play the highlighted chord in your own time.";
  }
  return (
    <CurrentNextStrip
      current={position.current ? { symbol: position.current.symbol, detail: detailOf(position.current.occurrenceId) } : null}
      next={position.next ? { symbol: position.next.symbol, detail: detailOf(position.next.occurrenceId) } : null}
      prompt={prompt}
      getPositionLabel={getPositionLabel}
    />
  );
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

function StudioWorkspace(): JSX.Element {
  const dispatch = useSessionDispatch();
  const mode = useSessionStore((s) => s.mode);
  const entryView = useSessionStore((s) => s.entryView);
  const pianoRange = useSessionStore((s) => s.pianoRange);
  const theme = useSessionStore((s) => s.theme);
  const focusMode = useSessionStore((s) => s.focusMode);
  const contextPanelOpen = useSessionStore((s) => s.contextPanelOpen);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // One KeyLayout, measured from the piano wrapper, shared by the piano and every stage.
  const pianoWrapRef = useRef<HTMLDivElement>(null);
  const { width: pianoWidth } = useElementSize(pianoWrapRef);
  useEffect(() => {
    if (pianoWidth > 0) {
      dispatch({ type: "setPianoRange", range: defaultRangeForWidth(pianoWidth, focusMode ? 30 : 22), user: false });
    }
  }, [pianoWidth, focusMode, dispatch]);
  const pianoHeight = focusMode ? 200 : pianoWidth > 0 && pianoWidth < 640 ? 120 : 150;
  const layout = useMemo(() => createKeyLayout(pianoRange, pianoWidth, pianoHeight), [pianoRange, pianoWidth, pianoHeight]);
  const sharedLayout = pianoWidth > 0 ? layout : null;

  const modes = useMemo<Partial<Record<"explore" | "practice" | "create", ModeContent>>>(
    () => ({
      explore: { stage: <ExploreStage />, contextTitle: "Explore", context: <ExploreContextPanel />, currentNext: <ExploreCurrentNext /> },
      practice: {
        stage: <PracticeMode />,
        contextTitle: "Practice",
        context: (
          <>
            <OnboardingCard />
            <PracticeContextPanel />
            <DisplaySettings />
          </>
        ),
        currentNext: <RuntimeCurrentNext />
      },
      create: { stage: <CreateStage />, contextTitle: "Create", context: <CreateContextPanel />, currentNext: <RuntimeCurrentNext /> }
    }),
    []
  );
  const views = useMemo(() => ({ learn: <LearnView />, songs: <SongsView />, myPractice: <MyPracticeView /> }), []);

  const piano = (
    <div ref={pianoWrapRef} className="pls-piano-wrap">
      <RuntimePiano range={pianoRange} layout={sharedLayout ?? undefined} height={pianoHeight} />
    </div>
  );

  return (
    <PianoLayoutContext.Provider value={sharedLayout}>
      <WorkspaceShell
        mode={mode}
        onModeChange={(next) => dispatch({ type: "setMode", mode: next })}
        entryView={entryView}
        onEntryViewChange={(view) => dispatch({ type: "setEntryView", view })}
        theme={theme}
        onToggleTheme={() => dispatch({ type: "toggleTheme" })}
        focusMode={focusMode}
        onToggleFocusMode={() => dispatch({ type: "toggleFocusMode" })}
        contextPanelOpen={contextPanelOpen}
        onToggleContextPanel={() => dispatch({ type: "toggleContextPanel" })}
        modes={modes}
        views={views}
        piano={piano}
        currentNext={<RuntimeCurrentNext />}
        transport={<RuntimeTransport />}
        devicePanel={<RuntimeDevicePanel />}
        topBarExtras={
          <Link href="/legacy" className="pls-btn pls-btn--ghost pls-hide-narrow">
            Classic studio
          </Link>
        }
      />
    </PianoLayoutContext.Provider>
  );
}
