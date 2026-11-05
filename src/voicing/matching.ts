/**
 * Voice matching shared by candidate ranking (engine) and transition explanations
 * (voiceLeading). Pure functions over ascending MIDI lists.
 *
 * - Equal counts: voices are paired by index. Notes are always stored lowest-to-highest with
 *   voiceIds "v1".."vN", so index pairing IS voiceId pairing.
 * - Unequal counts: every voice of the smaller side is assigned to a distinct voice of the
 *   larger side minimising total |semitone| movement ("nearest-pitch assignment"); ties prefer
 *   more common tones, then the lexicographically first assignment. Voices of the larger side
 *   left over are unmatched ("drops" when they belonged to the source, "enters" when they
 *   belong to the target).
 */

export interface VoiceMatch {
  /** [fromIndex, toIndex] pairs in ascending fromIndex order. */
  pairs: Array<[number, number]>;
  unmatchedFrom: number[];
  unmatchedTo: number[];
  /** Sum of |to - from| over matched pairs. */
  cost: number;
}

interface Assignment {
  /** assignment[i] = index in the larger list assigned to element i of the smaller list. */
  indices: number[];
  cost: number;
  commons: number;
}

function better(a: Assignment, b: Assignment): boolean {
  if (a.cost !== b.cost) {
    return a.cost < b.cost;
  }
  if (a.commons !== b.commons) {
    return a.commons > b.commons;
  }
  for (let i = 0; i < a.indices.length; i += 1) {
    if (a.indices[i] !== b.indices[i]) {
      return a.indices[i] < b.indices[i];
    }
  }
  return false;
}

function bestAssignment(small: number[], large: number[]): Assignment {
  const holder: { best: Assignment | null } = { best: null };
  const used: boolean[] = large.map(() => false);
  const current: number[] = [];
  const visit = (i: number, cost: number, commons: number): void => {
    if (i === small.length) {
      const candidate: Assignment = { indices: [...current], cost, commons };
      const previous = holder.best;
      if (previous === null || better(candidate, previous)) {
        holder.best = candidate;
      }
      return;
    }
    for (let j = 0; j < large.length; j += 1) {
      if (used[j]) {
        continue;
      }
      const distance = Math.abs(large[j] - small[i]);
      used[j] = true;
      current.push(j);
      visit(i + 1, cost + distance, commons + (distance === 0 ? 1 : 0));
      current.pop();
      used[j] = false;
    }
  };
  visit(0, 0, 0);
  return holder.best ?? { indices: [], cost: 0, commons: 0 };
}

export function matchVoices(from: number[], to: number[]): VoiceMatch {
  if (from.length === to.length) {
    const pairs: Array<[number, number]> = from.map((_, index) => [index, index] as [number, number]);
    const cost = from.reduce((sum, midi, index) => sum + Math.abs(to[index] - midi), 0);
    return { pairs, unmatchedFrom: [], unmatchedTo: [], cost };
  }
  if (from.length < to.length) {
    const assignment = bestAssignment(from, to);
    const pairs: Array<[number, number]> = assignment.indices.map((toIndex, fromIndex) => [fromIndex, toIndex] as [number, number]);
    const unmatchedTo = to.map((_, index) => index).filter((index) => !assignment.indices.includes(index));
    return { pairs, unmatchedFrom: [], unmatchedTo, cost: assignment.cost };
  }
  const assignment = bestAssignment(to, from);
  const pairs: Array<[number, number]> = assignment.indices
    .map((fromIndex, toIndex) => [fromIndex, toIndex] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const unmatchedFrom = from.map((_, index) => index).filter((index) => !assignment.indices.includes(index));
  return { pairs, unmatchedFrom, unmatchedTo: [], cost: assignment.cost };
}

/** Total voice movement between two ascending MIDI lists (see matchVoices). */
export function motionCost(from: number[], to: number[]): number {
  return matchVoices(from, to).cost;
}
