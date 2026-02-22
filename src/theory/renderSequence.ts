import type { ParsedSequence, RenderSequenceResult, ResolvedEvent, SynthSettings } from "@/types";
import { parseChordSymbol } from "@/theory/chordParser";
import { buildVoicing } from "@/theory/voicing";

function beatsPerMeasure(numerator: number, denominator: number): number {
  return numerator * (4 / denominator);
}

export function measuresToTicks(measures: number, settings: Pick<SynthSettings, "timeSignature" | "ticksPerBeat">): number {
  const beats = beatsPerMeasure(settings.timeSignature.numerator, settings.timeSignature.denominator);
  return Math.round(measures * beats * settings.ticksPerBeat);
}

export function ticksToSeconds(ticks: number, settings: Pick<SynthSettings, "tempoBpm" | "ticksPerBeat">): number {
  const beats = ticks / settings.ticksPerBeat;
  return (60 / settings.tempoBpm) * beats;
}

export function resolveSequence(parsed: ParsedSequence, settings: SynthSettings): RenderSequenceResult {
  let cursorTick = 0;
  let prevNotes: number[] | undefined;
  const events: ResolvedEvent[] = [];

  parsed.events.forEach((event, index) => {
    const durationTicks = measuresToTicks(event.durationMeasures, settings);
    const startTick = cursorTick;
    const startSeconds = ticksToSeconds(startTick, settings);
    const durationSeconds = ticksToSeconds(durationTicks, settings);

    if (event.isRest) {
      events.push({
        index,
        line: event.line,
        chordSymbol: event.chordSymbol,
        isRest: true,
        noteNumbers: [],
        noteNames: [],
        startTick,
        durationTicks,
        startSeconds,
        durationSeconds,
        durationMeasures: event.durationMeasures
      });
    } else {
      const parsedChord = parseChordSymbol(event.chordSymbol);
      const voicing = buildVoicing(parsedChord, settings, prevNotes);
      prevNotes = voicing.notes;

      events.push({
        index,
        line: event.line,
        chordSymbol: event.chordSymbol,
        isRest: false,
        noteNumbers: voicing.notes,
        noteNames: voicing.noteNames,
        startTick,
        durationTicks,
        startSeconds,
        durationSeconds,
        durationMeasures: event.durationMeasures
      });
    }

    cursorTick += durationTicks;
  });

  return {
    events,
    totalTicks: cursorTick,
    totalSeconds: ticksToSeconds(cursorTick, settings)
  };
}
