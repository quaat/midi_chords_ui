import type { ChordDescription } from "@/types";
import { parseNoteName } from "@/theory/notes";

type BaseQualityKind =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "dom7"
  | "maj7"
  | "min7"
  | "dim7"
  | "halfdim"
  | "maj6"
  | "min6"
  | "dom9"
  | "dom11"
  | "dom13"
  | "maj9"
  | "maj11"
  | "maj13"
  | "min9"
  | "min11"
  | "min13";

const TRIAD_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7]
};

const BASE_QUALITIES: Array<{ pattern: RegExp; consume: (v: string) => number; kind: BaseQualityKind; label: string }> = [
  {
    pattern: /^(maj13)/,
    consume: (v) => v.match(/^maj13/)![0].length,
    kind: "maj13",
    label: "Major 13"
  },
  { pattern: /^(maj11)/, consume: (v) => v.match(/^maj11/)![0].length, kind: "maj11", label: "Major 11" },
  { pattern: /^(maj9)/, consume: (v) => v.match(/^maj9/)![0].length, kind: "maj9", label: "Major 9" },
  { pattern: /^(maj7)/, consume: (v) => v.match(/^maj7/)![0].length, kind: "maj7", label: "Major 7" },
  { pattern: /^(maj6)/, consume: (v) => v.match(/^maj6/)![0].length, kind: "maj6", label: "Major 6" },
  { pattern: /^(m13)/, consume: (v) => v.match(/^m13/)![0].length, kind: "min13", label: "Minor 13" },
  { pattern: /^(m11)/, consume: (v) => v.match(/^m11/)![0].length, kind: "min11", label: "Minor 11" },
  { pattern: /^(m9)/, consume: (v) => v.match(/^m9/)![0].length, kind: "min9", label: "Minor 9" },
  { pattern: /^(m7b5|ø)/, consume: (v) => v.match(/^(m7b5|ø)/)![0].length, kind: "halfdim", label: "Half-diminished" },
  { pattern: /^(dim7|o7)/, consume: (v) => v.match(/^(dim7|o7)/)![0].length, kind: "dim7", label: "Diminished 7" },
  { pattern: /^(dim|o)/, consume: (v) => v.match(/^(dim|o)/)![0].length, kind: "dim", label: "Diminished" },
  { pattern: /^(aug|\+(?!5))/, consume: (v) => v.match(/^(aug|\+(?!5))/)![0].length, kind: "aug", label: "Augmented" },
  { pattern: /^(sus2)/, consume: (v) => v.match(/^sus2/)![0].length, kind: "sus2", label: "Suspended 2" },
  { pattern: /^(sus4|sus)/, consume: (v) => v.match(/^(sus4|sus)/)![0].length, kind: "sus4", label: "Suspended 4" },
  { pattern: /^(m6)/, consume: (v) => v.match(/^m6/)![0].length, kind: "min6", label: "Minor 6" },
  { pattern: /^(m7)/, consume: (v) => v.match(/^m7/)![0].length, kind: "min7", label: "Minor 7" },
  { pattern: /^(m)/, consume: (v) => v.match(/^m/)![0].length, kind: "min", label: "Minor" },
  { pattern: /^(13)/, consume: (v) => v.match(/^13/)![0].length, kind: "dom13", label: "Dominant 13" },
  { pattern: /^(11)/, consume: (v) => v.match(/^11/)![0].length, kind: "dom11", label: "Dominant 11" },
  { pattern: /^(9)/, consume: (v) => v.match(/^9/)![0].length, kind: "dom9", label: "Dominant 9" },
  { pattern: /^(7)/, consume: (v) => v.match(/^7/)![0].length, kind: "dom7", label: "Dominant 7" },
  { pattern: /^(6)/, consume: (v) => v.match(/^6/)![0].length, kind: "maj6", label: "Major 6" }
];

const ALTERATION_TOKENS = ["#11", "#9", "#5", "+5", "+", "b13", "b9", "b5"] as const;
const ADD_TOKENS = ["add13", "add11", "add9", "add6", "add4", "add2"] as const;
const SUSPENSION_TOKENS = ["sus4", "sus", "sus2"] as const;

function normalizeSuffix(value: string): string {
  return value
    .replace(/min13/i, "m13")
    .replace(/min11/i, "m11")
    .replace(/min9/i, "m9")
    .replace(/min7/i, "m7")
    .replace(/min6/i, "m6")
    .replace(/min/i, "m");
}

function addInterval(set: Set<number>, interval: number): void {
  set.add(interval);
}

function replaceIntervalClass(set: Set<number>, targetClass: number, replacement: number): void {
  const next = [...set].filter((interval) => ((interval % 12) + 12) % 12 !== ((targetClass % 12) + 12) % 12);
  next.push(replacement);
  set.clear();
  next.forEach((v) => set.add(v));
}

function buildBaseIntervals(kind: BaseQualityKind): { intervals: Set<number>; label: string } {
  const intervals = new Set<number>();

  const addTriad = (triadKey: keyof typeof TRIAD_INTERVALS): void => {
    TRIAD_INTERVALS[triadKey].forEach((v) => addInterval(intervals, v));
  };

  switch (kind) {
    case "maj":
      addTriad("maj");
      return { intervals, label: "Major" };
    case "min":
      addTriad("min");
      return { intervals, label: "Minor" };
    case "dim":
      addTriad("dim");
      return { intervals, label: "Diminished" };
    case "aug":
      addTriad("aug");
      return { intervals, label: "Augmented" };
    case "sus2":
      addTriad("sus2");
      return { intervals, label: "Suspended 2" };
    case "sus4":
      addTriad("sus4");
      return { intervals, label: "Suspended 4" };
    case "dom7":
      addTriad("maj");
      addInterval(intervals, 10);
      return { intervals, label: "Dominant 7" };
    case "maj7":
      addTriad("maj");
      addInterval(intervals, 11);
      return { intervals, label: "Major 7" };
    case "min7":
      addTriad("min");
      addInterval(intervals, 10);
      return { intervals, label: "Minor 7" };
    case "dim7":
      addTriad("dim");
      addInterval(intervals, 9);
      return { intervals, label: "Diminished 7" };
    case "halfdim":
      addTriad("dim");
      addInterval(intervals, 10);
      return { intervals, label: "Half-diminished" };
    case "maj6":
      addTriad("maj");
      addInterval(intervals, 9);
      return { intervals, label: "Major 6" };
    case "min6":
      addTriad("min");
      addInterval(intervals, 9);
      return { intervals, label: "Minor 6" };
    case "dom9":
      addTriad("maj");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      return { intervals, label: "Dominant 9" };
    case "dom11":
      addTriad("maj");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      return { intervals, label: "Dominant 11" };
    case "dom13":
      addTriad("maj");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      addInterval(intervals, 21);
      return { intervals, label: "Dominant 13" };
    case "maj9":
      addTriad("maj");
      addInterval(intervals, 11);
      addInterval(intervals, 14);
      return { intervals, label: "Major 9" };
    case "maj11":
      addTriad("maj");
      addInterval(intervals, 11);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      return { intervals, label: "Major 11" };
    case "maj13":
      addTriad("maj");
      addInterval(intervals, 11);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      addInterval(intervals, 21);
      return { intervals, label: "Major 13" };
    case "min9":
      addTriad("min");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      return { intervals, label: "Minor 9" };
    case "min11":
      addTriad("min");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      return { intervals, label: "Minor 11" };
    case "min13":
      addTriad("min");
      addInterval(intervals, 10);
      addInterval(intervals, 14);
      addInterval(intervals, 17);
      addInterval(intervals, 21);
      return { intervals, label: "Minor 13" };
    default:
      addTriad("maj");
      return { intervals, label: "Major" };
  }
}

function applyAlteration(intervals: Set<number>, token: (typeof ALTERATION_TOKENS)[number]): void {
  switch (token) {
    case "b5":
      replaceIntervalClass(intervals, 7, 6);
      break;
    case "#5":
    case "+5":
    case "+":
      replaceIntervalClass(intervals, 7, 8);
      break;
    case "b9":
      if ([...intervals].some((v) => v === 14)) {
        replaceIntervalClass(intervals, 2, 13);
      } else {
        addInterval(intervals, 13);
      }
      break;
    case "#9":
      if ([...intervals].some((v) => v === 14)) {
        replaceIntervalClass(intervals, 2, 15);
      } else {
        addInterval(intervals, 15);
      }
      break;
    case "#11":
      if ([...intervals].some((v) => v === 17)) {
        replaceIntervalClass(intervals, 5, 18);
      } else {
        addInterval(intervals, 18);
      }
      break;
    case "b13":
      if ([...intervals].some((v) => v === 21)) {
        replaceIntervalClass(intervals, 9, 20);
      } else {
        addInterval(intervals, 20);
      }
      break;
    default:
      break;
  }
}

function applyAddToken(intervals: Set<number>, token: (typeof ADD_TOKENS)[number]): void {
  switch (token) {
    case "add2":
      addInterval(intervals, 2);
      break;
    case "add4":
      addInterval(intervals, 5);
      break;
    case "add6":
      addInterval(intervals, 9);
      break;
    case "add9":
      addInterval(intervals, 14);
      break;
    case "add11":
      addInterval(intervals, 17);
      break;
    case "add13":
      addInterval(intervals, 21);
      break;
    default:
      break;
  }
}

function applySuspension(intervals: Set<number>, token: (typeof SUSPENSION_TOKENS)[number]): void {
  const suspendedInterval = token === "sus2" ? 2 : 5;

  replaceIntervalClass(intervals, 3, suspendedInterval);
  replaceIntervalClass(intervals, 4, suspendedInterval);
  addInterval(intervals, suspendedInterval);
}

export function parseChordSymbol(symbol: string): ChordDescription {
  const trimmed = symbol.trim();
  if (!trimmed) {
    throw new Error("Empty chord symbol.");
  }

  const chordMatch = trimmed.match(/^([A-Ga-g])([#b]?)([^/]*)?(?:\/([A-Ga-g])([#b]?))?$/);
  if (!chordMatch) {
    throw new Error(`Invalid chord symbol \"${symbol}\".`);
  }

  const rootData = parseNoteName(`${chordMatch[1]}${chordMatch[2] ?? ""}`);
  if (!rootData) {
    throw new Error(`Invalid root note in \"${symbol}\".`);
  }

  const rawSuffix = normalizeSuffix((chordMatch[3] ?? "").trim());
  let suffix = rawSuffix;

  let baseKind: BaseQualityKind = "maj";
  let qualityLabel = "Major";

  for (const entry of BASE_QUALITIES) {
    if (entry.pattern.test(suffix)) {
      const consumed = entry.consume(suffix);
      baseKind = entry.kind;
      qualityLabel = entry.label;
      suffix = suffix.slice(consumed);
      break;
    }
  }

  const { intervals, label } = buildBaseIntervals(baseKind);
  qualityLabel = qualityLabel || label;

  while (suffix.length > 0) {
    let consumed = false;

    for (const token of ADD_TOKENS) {
      if (suffix.startsWith(token)) {
        applyAddToken(intervals, token);
        suffix = suffix.slice(token.length);
        consumed = true;
        break;
      }
    }
    if (consumed) {
      continue;
    }

    for (const token of SUSPENSION_TOKENS) {
      if (suffix.startsWith(token)) {
        applySuspension(intervals, token);
        suffix = suffix.slice(token.length);
        consumed = true;
        break;
      }
    }
    if (consumed) {
      continue;
    }

    for (const token of ALTERATION_TOKENS) {
      if (suffix.startsWith(token)) {
        applyAlteration(intervals, token);
        suffix = suffix.slice(token.length);
        consumed = true;
        break;
      }
    }

    if (!consumed) {
      throw new Error(`Unsupported quality token near \"${suffix}\" in \"${symbol}\".`);
    }
  }

  const sortedIntervals = [...intervals].sort((a, b) => a - b);

  let bassPc: number | undefined;
  let bassName: string | undefined;
  if (chordMatch[4]) {
    const bassData = parseNoteName(`${chordMatch[4]}${chordMatch[5] ?? ""}`);
    if (!bassData) {
      throw new Error(`Invalid slash bass note in \"${symbol}\".`);
    }
    bassPc = bassData.pc;
    bassName = bassData.name;
  }

  return {
    symbol: trimmed,
    rootPc: rootData.pc,
    rootName: rootData.name,
    bassPc,
    bassName,
    intervals: sortedIntervals,
    qualityLabel
  };
}
