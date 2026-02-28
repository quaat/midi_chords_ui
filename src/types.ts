export type TimeSignature = {
  numerator: number;
  denominator: number;
};

export type VoicingMode = "close" | "open" | "spread" | "root5_3up";
export type ArpeggiateOctaves = 0 | 1 | 2 | 3;

export interface SynthSettings {
  tempoBpm: number;
  timeSignature: TimeSignature;
  defaultChordMeasures: number;
  ticksPerBeat: number;
  midiChannel: number;
  velocity: number;
  program: number;
  baseOctave: number;
  bassOctave: number;
  voicingMode: VoicingMode;
  arpeggiateOctaves: ArpeggiateOctaves;
  voiceLeading: boolean;
  maxSpread: number;
  minNote: number;
  maxNote: number;
}

export interface ParseError {
  line: number;
  column: number;
  message: string;
  rawLine: string;
}

export interface ParsedLineEvent {
  line: number;
  raw: string;
  chordSymbol: string;
  durationMeasures: number;
  isRest: boolean;
}

export interface ParsedSequence {
  events: ParsedLineEvent[];
  errors: ParseError[];
}

export interface ChordDescription {
  symbol: string;
  rootPc: number;
  rootName: string;
  bassPc?: number;
  bassName?: string;
  intervals: number[];
  qualityLabel: string;
}

export interface ResolvedEvent {
  index: number;
  line: number;
  chordSymbol: string;
  isRest: boolean;
  noteNumbers: number[];
  noteNames: string[];
  startTick: number;
  durationTicks: number;
  startSeconds: number;
  durationSeconds: number;
  durationMeasures: number;
}

export interface RenderSequenceResult {
  events: ResolvedEvent[];
  totalTicks: number;
  totalSeconds: number;
}
