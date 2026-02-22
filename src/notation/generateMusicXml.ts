import type { ResolvedEvent, SynthSettings } from "@/types";

export interface EventMeasureSegment {
  measureNumber: number;
  startTickWithinMeasure: number;
  durationDivisions: number;
}

export interface EventScoreLocation {
  measureNumber: number;
  startTickWithinMeasure: number;
  durationDivisions: number;
  segments: EventMeasureSegment[];
}

export type EventToScoreMap = Record<number, EventScoreLocation>;

interface DurationPart {
  duration: number;
  type: "whole" | "half" | "quarter" | "eighth" | "16th" | "32nd" | "64th";
}

interface EventSpan {
  measureIndex: number;
  startTickWithinMeasure: number;
  duration: number;
}

interface NotationToken {
  eventIndex: number;
  order: number;
  measureIndex: number;
  staff: StaffNumber;
  voice: number;
  startTickWithinMeasure: number;
  duration: number;
  type: DurationPart["type"];
  chordSymbol: string;
  noteNumbers: number[];
  isRest: boolean;
  emitHarmony: boolean;
  tieStart: boolean;
  tieStop: boolean;
}

type StaffNumber = 1 | 2;

const TREBLE_STAFF: StaffNumber = 1;
const BASS_STAFF: StaffNumber = 2;
const TREBLE_MIN_MIDI = 60;

const DURATION_TYPES: Array<DurationPart["type"]> = ["whole", "half", "quarter", "eighth", "16th", "32nd", "64th"];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBeatsPerMeasure(settings: SynthSettings): number {
  return settings.timeSignature.numerator * (4 / settings.timeSignature.denominator);
}

function getMeasureDivisions(settings: SynthSettings): number {
  return Math.max(1, Math.round(getBeatsPerMeasure(settings) * settings.ticksPerBeat));
}

function splitEventAcrossMeasures(event: ResolvedEvent, measureDivisions: number): EventSpan[] {
  if (event.durationTicks <= 0) {
    return [];
  }

  const spans: EventSpan[] = [];
  let remaining = event.durationTicks;
  let cursor = event.startTick;

  while (remaining > 0) {
    const measureIndex = Math.floor(cursor / measureDivisions);
    const startTickWithinMeasure = cursor - measureIndex * measureDivisions;
    const available = measureDivisions - startTickWithinMeasure;
    const duration = Math.min(remaining, available);

    spans.push({
      measureIndex,
      startTickWithinMeasure,
      duration
    });

    cursor += duration;
    remaining -= duration;
  }

  return spans;
}

function durationTypeDivisions(divisions: number, type: DurationPart["type"]): number {
  switch (type) {
    case "whole":
      return Math.max(1, Math.round(divisions * 4));
    case "half":
      return Math.max(1, Math.round(divisions * 2));
    case "quarter":
      return Math.max(1, divisions);
    case "eighth":
      return Math.max(1, Math.round(divisions / 2));
    case "16th":
      return Math.max(1, Math.round(divisions / 4));
    case "32nd":
      return Math.max(1, Math.round(divisions / 8));
    case "64th":
      return Math.max(1, Math.round(divisions / 16));
    default:
      return Math.max(1, divisions);
  }
}

function decomposeDuration(duration: number, divisions: number): DurationPart[] {
  const durationTable: DurationPart[] = DURATION_TYPES.map((type) => ({
    type,
    duration: durationTypeDivisions(divisions, type)
  }))
    .filter((entry) => entry.duration > 0)
    .sort((a, b) => b.duration - a.duration);

  const result: DurationPart[] = [];
  let remaining = duration;
  let safety = 0;

  while (remaining > 0 && safety < 1024) {
    safety += 1;

    const exactOrBelow = durationTable.find((entry) => entry.duration <= remaining);
    if (exactOrBelow) {
      result.push(exactOrBelow);
      remaining -= exactOrBelow.duration;
      continue;
    }

    const smallest = durationTable[durationTable.length - 1];
    if (!smallest) {
      break;
    }

    result.push({ type: "64th", duration: remaining });
    remaining = 0;
  }

  if (result.length === 0) {
    result.push({ type: "quarter", duration: Math.max(1, duration) });
  }

  return result;
}

function midiToPitch(midi: number): { step: string; alter?: number; octave: number } {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;

  switch (pitchClass) {
    case 0:
      return { step: "C", octave };
    case 1:
      return { step: "C", alter: 1, octave };
    case 2:
      return { step: "D", octave };
    case 3:
      return { step: "D", alter: 1, octave };
    case 4:
      return { step: "E", octave };
    case 5:
      return { step: "F", octave };
    case 6:
      return { step: "F", alter: 1, octave };
    case 7:
      return { step: "G", octave };
    case 8:
      return { step: "G", alter: 1, octave };
    case 9:
      return { step: "A", octave };
    case 10:
      return { step: "A", alter: 1, octave };
    case 11:
      return { step: "B", octave };
    default:
      return { step: "C", octave };
  }
}

function chordKindFromSuffix(rawSuffix: string): string {
  const suffix = rawSuffix.toLowerCase();

  if (suffix.includes("m7b5") || suffix.includes("ø")) {
    return "half-diminished";
  }
  if (suffix.includes("dim7") || suffix.includes("o7")) {
    return "diminished-seventh";
  }
  if (suffix.includes("dim") || suffix === "o") {
    return "diminished";
  }
  if (suffix.includes("aug") || suffix.includes("+")) {
    return "augmented";
  }
  if (suffix.includes("sus2")) {
    return "suspended-second";
  }
  if (suffix.includes("sus")) {
    return "suspended-fourth";
  }
  if (suffix.includes("maj13")) {
    return "major-13th";
  }
  if (suffix.includes("maj11")) {
    return "major-11th";
  }
  if (suffix.includes("maj9")) {
    return "major-ninth";
  }
  if (suffix.includes("maj7")) {
    return "major-seventh";
  }
  if (suffix.startsWith("m13") || suffix.includes("min13")) {
    return "minor-13th";
  }
  if (suffix.startsWith("m11") || suffix.includes("min11")) {
    return "minor-11th";
  }
  if (suffix.startsWith("m9") || suffix.includes("min9")) {
    return "minor-ninth";
  }
  if (suffix.startsWith("m7") || suffix.includes("min7")) {
    return "minor-seventh";
  }
  if (suffix.includes("13")) {
    return "dominant-13th";
  }
  if (suffix.includes("11")) {
    return "dominant-11th";
  }
  if (suffix.includes("9")) {
    return "dominant-ninth";
  }
  if (suffix.startsWith("m6") || suffix.includes("min6")) {
    return "minor-sixth";
  }
  if (suffix.includes("6")) {
    return "major-sixth";
  }
  if (suffix === "7" || suffix.includes("7")) {
    return "dominant";
  }
  if (suffix === "m" || suffix.startsWith("m") || suffix.includes("min")) {
    return "minor";
  }

  return "major";
}

function parseChordForHarmony(chordSymbol: string): {
  rootStep: string;
  rootAlter?: number;
  bassStep?: string;
  bassAlter?: number;
  kind: string;
} {
  const match = chordSymbol.trim().match(/^([A-Ga-g])([#b]?)([^/]*)?(?:\/([A-Ga-g])([#b]?))?$/);

  if (!match) {
    return {
      rootStep: "C",
      kind: "other"
    };
  }

  const rootStep = match[1].toUpperCase();
  const rootAlter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : undefined;
  const suffix = (match[3] ?? "").trim();
  const bassStep = match[4] ? match[4].toUpperCase() : undefined;
  const bassAlter = match[5] === "#" ? 1 : match[5] === "b" ? -1 : undefined;

  return {
    rootStep,
    rootAlter,
    bassStep,
    bassAlter,
    kind: chordKindFromSuffix(suffix)
  };
}

function buildHarmonyXml(chordSymbol: string): string {
  const harmony = parseChordForHarmony(chordSymbol);

  return [
    "<harmony>",
    "<root>",
    `<root-step>${harmony.rootStep}</root-step>`,
    harmony.rootAlter !== undefined ? `<root-alter>${harmony.rootAlter}</root-alter>` : "",
    "</root>",
    harmony.bassStep
      ? [
          "<bass>",
          `<bass-step>${harmony.bassStep}</bass-step>`,
          harmony.bassAlter !== undefined ? `<bass-alter>${harmony.bassAlter}</bass-alter>` : "",
          "</bass>"
        ].join("")
      : "",
    `<kind text="${escapeXml(chordSymbol)}">${harmony.kind}</kind>`,
    "</harmony>"
  ].join("");
}

function buildNoteXml(token: NotationToken, noteNumber: number, includeChordTag: boolean): string {
  const pitch = midiToPitch(noteNumber);

  const tieTags: string[] = [];
  const tiedNotation: string[] = [];

  if (token.tieStop) {
    tieTags.push('<tie type="stop"/>');
    tiedNotation.push('<tied type="stop"/>');
  }
  if (token.tieStart) {
    tieTags.push('<tie type="start"/>');
    tiedNotation.push('<tied type="start"/>');
  }

  return [
    "<note>",
    includeChordTag ? "<chord/>" : "",
    "<pitch>",
    `<step>${pitch.step}</step>`,
    pitch.alter !== undefined ? `<alter>${pitch.alter}</alter>` : "",
    `<octave>${pitch.octave}</octave>`,
    "</pitch>",
    `<duration>${token.duration}</duration>`,
    `<voice>${token.voice}</voice>`,
    `<staff>${token.staff}</staff>`,
    `<type>${token.type}</type>`,
    tieTags.join(""),
    tiedNotation.length > 0 ? `<notations>${tiedNotation.join("")}</notations>` : "",
    "</note>"
  ].join("");
}

function buildRestXml(part: DurationPart, staff: StaffNumber, voice: number): string {
  return [
    "<note>",
    "<rest/>",
    `<duration>${part.duration}</duration>`,
    `<voice>${voice}</voice>`,
    `<staff>${staff}</staff>`,
    `<type>${part.type}</type>`,
    "</note>"
  ].join("");
}

function splitNotesForGrandStaff(noteNumbers: number[]): { treble: number[]; bass: number[] } {
  const sorted = [...noteNumbers].sort((a, b) => a - b);
  return {
    treble: sorted.filter((note) => note >= TREBLE_MIN_MIDI),
    bass: sorted.filter((note) => note < TREBLE_MIN_MIDI)
  };
}

function createMeasureTokenBuckets(): Record<StaffNumber, NotationToken[]> {
  return {
    1: [],
    2: []
  };
}

export function generateMusicXml(
  events: ResolvedEvent[],
  settings: SynthSettings
): { xml: string; eventMap: EventToScoreMap } {
  const divisions = Math.max(1, Math.round(settings.ticksPerBeat));
  const measureDivisions = getMeasureDivisions(settings);
  const eventMap: EventToScoreMap = {};

  const totalTicks =
    events.length > 0 ? Math.max(...events.map((event) => event.startTick + event.durationTicks)) : measureDivisions;
  const totalMeasures = Math.max(1, Math.ceil(totalTicks / measureDivisions));

  const measureTokens: Array<Record<StaffNumber, NotationToken[]>> = Array.from(
    { length: totalMeasures },
    createMeasureTokenBuckets
  );

  events.forEach((event) => {
    const spans = splitEventAcrossMeasures(event, measureDivisions);

    if (spans.length === 0) {
      return;
    }

    eventMap[event.index] = {
      measureNumber: spans[0].measureIndex + 1,
      startTickWithinMeasure: spans[0].startTickWithinMeasure,
      durationDivisions: event.durationTicks,
      segments: spans.map((span) => ({
        measureNumber: span.measureIndex + 1,
        startTickWithinMeasure: span.startTickWithinMeasure,
        durationDivisions: span.duration
      }))
    };

    const partsPerSpan = spans.map((span) => decomposeDuration(span.duration, divisions));
    const totalParts = partsPerSpan.reduce((sum, parts) => sum + parts.length, 0);

    let partCounter = 0;

    spans.forEach((span, spanIndex) => {
      const parts = partsPerSpan[spanIndex];
      let localOffset = span.startTickWithinMeasure;

      parts.forEach((part, partIndex) => {
        const isEventRest = event.isRest || event.noteNumbers.length === 0;
        const splitNotes = isEventRest
          ? { treble: [] as number[], bass: [] as number[] }
          : splitNotesForGrandStaff(event.noteNumbers);

        const staffData: Array<{ staff: StaffNumber; notes: number[]; voice: number }> = [
          { staff: TREBLE_STAFF, notes: splitNotes.treble, voice: 1 },
          { staff: BASS_STAFF, notes: splitNotes.bass, voice: 2 }
        ];

        staffData.forEach(({ staff, notes, voice }) => {
          const hasNotes = notes.length > 0;
          const isRest = !hasNotes;
          const tieStop = hasNotes && partCounter > 0;
          const tieStart = hasNotes && partCounter < totalParts - 1;

          measureTokens[span.measureIndex][staff].push({
            eventIndex: event.index,
            order: partCounter,
            measureIndex: span.measureIndex,
            staff,
            voice,
            startTickWithinMeasure: localOffset,
            duration: part.duration,
            type: part.type,
            chordSymbol: event.chordSymbol,
            noteNumbers: notes,
            isRest,
            emitHarmony: staff === TREBLE_STAFF && !isEventRest && partIndex === 0,
            tieStart,
            tieStop
          });
        });

        localOffset += part.duration;
        partCounter += 1;
      });
    });
  });

  const measuresXml: string[] = [];

  for (let measureIndex = 0; measureIndex < totalMeasures; measureIndex += 1) {
    const sortTokens = (tokens: NotationToken[]): NotationToken[] =>
      [...tokens].sort((a, b) => {
        if (a.startTickWithinMeasure !== b.startTickWithinMeasure) {
          return a.startTickWithinMeasure - b.startTickWithinMeasure;
        }
        if (a.eventIndex !== b.eventIndex) {
          return a.eventIndex - b.eventIndex;
        }
        return a.order - b.order;
      });

    const renderStaffTokens = (tokens: NotationToken[], staff: StaffNumber): string[] => {
      const body: string[] = [];
      if (tokens.length === 0) {
        decomposeDuration(measureDivisions, divisions).forEach((part) => {
          body.push(buildRestXml(part, staff, staff === TREBLE_STAFF ? 1 : 2));
        });
        return body;
      }

      tokens.forEach((token) => {
        if (token.emitHarmony) {
          body.push(buildHarmonyXml(token.chordSymbol));
        }

        if (token.isRest) {
          body.push(buildRestXml({ duration: token.duration, type: token.type }, token.staff, token.voice));
          return;
        }

        const sortedPitches = [...token.noteNumbers].sort((a, b) => a - b);
        sortedPitches.forEach((noteNumber, pitchIndex) => {
          body.push(buildNoteXml(token, noteNumber, pitchIndex > 0));
        });
      });

      return body;
    };

    const trebleTokens = sortTokens(measureTokens[measureIndex][TREBLE_STAFF]);
    const bassTokens = sortTokens(measureTokens[measureIndex][BASS_STAFF]);

    const body: string[] = [];

    if (measureIndex === 0) {
      body.push(
        "<attributes>",
        `<divisions>${divisions}</divisions>`,
        "<key><fifths>0</fifths></key>",
        `<time><beats>${settings.timeSignature.numerator}</beats><beat-type>${settings.timeSignature.denominator}</beat-type></time>`,
        "<staves>2</staves>",
        '<part-symbol type="brace"><top-staff>1</top-staff><bottom-staff>2</bottom-staff></part-symbol>',
        '<clef number="1"><sign>G</sign><line>2</line></clef>',
        '<clef number="2"><sign>F</sign><line>4</line></clef>',
        "</attributes>",
        [
          "<direction placement=\"above\">",
          "<direction-type>",
          "<metronome>",
          "<beat-unit>quarter</beat-unit>",
          `<per-minute>${settings.tempoBpm}</per-minute>`,
          "</metronome>",
          "</direction-type>",
          `<sound tempo=\"${settings.tempoBpm}\"/>`,
          "</direction>"
        ].join("")
      );
    }

    body.push(...renderStaffTokens(trebleTokens, TREBLE_STAFF));
    body.push(`<backup><duration>${measureDivisions}</duration></backup>`);
    body.push(...renderStaffTokens(bassTokens, BASS_STAFF));

    measuresXml.push(`<measure number=\"${measureIndex + 1}\">${body.join("")}</measure>`);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    "<part-list>",
    '<score-part id="P1"><part-name>Piano</part-name></score-part>',
    "</part-list>",
    '<part id="P1">',
    measuresXml.join(""),
    "</part>",
    "</score-partwise>"
  ].join("");

  return {
    xml,
    eventMap
  };
}
