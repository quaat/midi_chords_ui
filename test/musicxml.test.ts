import { describe, expect, it } from "vitest";
import { generateMusicXml } from "@/notation/generateMusicXml";
import type { ResolvedEvent, SynthSettings } from "@/types";

const settings: SynthSettings = {
  tempoBpm: 110,
  timeSignature: { numerator: 4, denominator: 4 },
  defaultChordMeasures: 1,
  ticksPerBeat: 480,
  midiChannel: 1,
  velocity: 96,
  program: 1,
  baseOctave: 4,
  bassOctave: 2,
  voicingMode: "close",
  voiceLeading: true,
  maxSpread: 30,
  minNote: 24,
  maxNote: 96
};

function makeEvent(
  index: number,
  chordSymbol: string,
  isRest: boolean,
  startTick: number,
  durationTicks: number,
  noteNumbers: number[]
): ResolvedEvent {
  return {
    index,
    line: index + 1,
    chordSymbol,
    isRest,
    noteNumbers,
    noteNames: [],
    startTick,
    durationTicks,
    startSeconds: 0,
    durationSeconds: 0,
    durationMeasures: 1
  };
}

function getMeasureBody(xml: string, measureNumber: number): string {
  const regex = new RegExp(`<measure number=\"${measureNumber}\">([\\s\\S]*?)<\\/measure>`);
  const match = xml.match(regex);
  return match?.[1] ?? "";
}

function sumPrimaryDurationsForStaff(measureBody: string, staffNumber: number): number {
  const noteRegex = /<note>([\s\S]*?)<\/note>/g;
  let sum = 0;

  let match: RegExpExecArray | null = noteRegex.exec(measureBody);
  while (match) {
    const noteXml = match[1];
    const staffMatch = noteXml.match(/<staff>(\d+)<\/staff>/);
    if (Number(staffMatch?.[1] ?? 0) !== staffNumber) {
      match = noteRegex.exec(measureBody);
      continue;
    }
    if (!noteXml.includes("<chord/>")) {
      const durationMatch = noteXml.match(/<duration>(\d+)<\/duration>/);
      sum += Number(durationMatch?.[1] ?? 0);
    }
    match = noteRegex.exec(measureBody);
  }

  return sum;
}

describe("generateMusicXml", () => {
  it("keeps measure duration totals aligned to time signature", () => {
    const events: ResolvedEvent[] = [
      makeEvent(0, "Cmaj7", false, 0, 960, [60, 64, 67]),
      makeEvent(1, "Fmaj7", false, 960, 960, [65, 69, 72]),
      makeEvent(2, "NC", true, 1920, 960, []),
      makeEvent(3, "G7", false, 2880, 960, [67, 71, 74])
    ];

    const { xml } = generateMusicXml(events, settings);

    expect(sumPrimaryDurationsForStaff(getMeasureBody(xml, 1), 1)).toBe(1920);
    expect(sumPrimaryDurationsForStaff(getMeasureBody(xml, 1), 2)).toBe(1920);
    expect(sumPrimaryDurationsForStaff(getMeasureBody(xml, 2), 1)).toBe(1920);
    expect(sumPrimaryDurationsForStaff(getMeasureBody(xml, 2), 2)).toBe(1920);
  });

  it("splits across measure boundaries and emits ties", () => {
    const events: ResolvedEvent[] = [makeEvent(0, "Cmaj9", false, 0, 2880, [60, 64, 67, 71])];

    const { xml, eventMap } = generateMusicXml(events, settings);

    expect(eventMap[0].segments).toHaveLength(2);
    expect(eventMap[0].segments[0].measureNumber).toBe(1);
    expect(eventMap[0].segments[0].durationDivisions).toBe(1920);
    expect(eventMap[0].segments[1].measureNumber).toBe(2);
    expect(eventMap[0].segments[1].durationDivisions).toBe(960);

    expect(xml).toContain('<tie type="start"/>');
    expect(xml).toContain('<tie type="stop"/>');
    expect(getMeasureBody(xml, 2)).toContain('<tie type="stop"/>');
  });

  it("renders NC as rests without harmony tags", () => {
    const events: ResolvedEvent[] = [makeEvent(0, "NC", true, 0, 1920, [])];

    const { xml } = generateMusicXml(events, settings);

    expect(xml).toContain("<rest/>");
    expect(xml).not.toContain('<kind text="NC">');
  });

  it("emits grand staff with treble and bass staves plus brace", () => {
    const events: ResolvedEvent[] = [makeEvent(0, "Cmaj7", false, 0, 1920, [48, 55, 64, 67])];

    const { xml } = generateMusicXml(events, settings);
    const measure1 = getMeasureBody(xml, 1);

    expect(xml).toContain("<staves>2</staves>");
    expect(xml).toContain('<part-symbol type="brace"><top-staff>1</top-staff><bottom-staff>2</bottom-staff></part-symbol>');
    expect(xml).toContain('<clef number="1"><sign>G</sign><line>2</line></clef>');
    expect(xml).toContain('<clef number="2"><sign>F</sign><line>4</line></clef>');
    expect(measure1).toContain("<backup><duration>1920</duration></backup>");
    expect(measure1).toContain("<staff>1</staff>");
    expect(measure1).toContain("<staff>2</staff>");
  });
});
