/**
 * Degenerate output detection.
 *
 * Two distinct failure modes have been observed in production, both from the
 * project lead, both unstoppable without intervention:
 *
 *  1. Structural noise — ~900 KB of empty code fences (95% newlines, 5%
 *     backticks, zero alphanumeric characters).
 *  2. Termination failure — the model tries to stop and cannot, emitting
 *     "I will cease. No further. Stop. END. Done. No more." for hundreds of
 *     kilobytes. This text has entirely normal letter density, so mode 1's
 *     check never fires on it.
 *
 * Neither is a context-size problem: the first failure occurred with roughly
 * 11K tokens accumulated. They are generation failures, so detection looks at
 * the shape of the output rather than its volume alone.
 *
 * Two orthogonal signals, both gated behind a large minimum size:
 *
 *  - alphanumeric ratio, which catches structural noise.
 *  - vocabulary collapse: the share of 5-word phrases that are unique. A model
 *    in a loop recycles a handful of phrases, so this falls to a few percent,
 *    while genuine output — even highly repetitive machine-generated JSON —
 *    stays high.
 *
 * Thresholds were fitted to real transcripts. Across 11 degenerate messages
 * (153 KB - 625 KB) every one is caught: unique-phrase ratios of 0.2%-42.9%,
 * or near-zero alphanumeric content for the noise mode. Against real files the
 * lowest observed ratio is 60% (a 477 KB package-lock.json, deliberately the
 * worst realistic case for repetition), leaving a wide margin below the 50%
 * threshold. The size gate matters as much as the ratios: cancelling a healthy
 * agent is worse than catching a sick one late.
 */

export interface DegenerateOutputPolicy {
  /** Bytes in one turn below which the check never fires. */
  minChars?: number;
  /** Fire when the alphanumeric fraction is at or below this. */
  maxAlnumRatio?: number;
  /** Fire when the share of unique 5-word phrases falls to or below this. */
  minUniquePhraseRatio?: number;
}

export const DEFAULT_DEGENERATE_POLICY: Required<DegenerateOutputPolicy> = {
  minChars: 150_000,
  maxAlnumRatio: 0.02,
  minUniquePhraseRatio: 0.50,
};

/** Cap on retained text. Only the recent window is needed to judge repetition. */
const BUFFER_LIMIT = 262_144;

/** Re-evaluate at most every this many characters — n-gram counting is not free. */
const EVAL_STRIDE = 32_768;

const PHRASE_WORDS = 5;

/**
 * Share of 5-word phrases in the text that occur exactly once.
 *
 * Returns 1 for text too short to judge, so short output is never treated as
 * degenerate on this signal.
 */
export function uniquePhraseRatio(text: string): number {
  const words = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!words || words.length < 50) return 1;
  const counts = new Set<string>();
  let total = 0;
  for (let i = 0; i + PHRASE_WORDS <= words.length; i++) {
    counts.add(words.slice(i, i + PHRASE_WORDS).join(' '));
    total++;
  }
  return total > 0 ? counts.size / total : 1;
}

export class DegenerateOutputDetector {
  private total = 0;
  private alnum = 0;
  private buffer = '';
  private lastEvalAt = 0;
  private fired = false;
  private reason = '';
  private readonly minChars: number;
  private readonly maxAlnumRatio: number;
  private readonly minUniquePhraseRatio: number;

  constructor(policy?: DegenerateOutputPolicy) {
    this.minChars = policy?.minChars ?? DEFAULT_DEGENERATE_POLICY.minChars;
    this.maxAlnumRatio = policy?.maxAlnumRatio ?? DEFAULT_DEGENERATE_POLICY.maxAlnumRatio;
    this.minUniquePhraseRatio = policy?.minUniquePhraseRatio ?? DEFAULT_DEGENERATE_POLICY.minUniquePhraseRatio;
  }

  /** Clear counters for a new turn. */
  reset(): void {
    this.total = 0;
    this.alnum = 0;
    this.buffer = '';
    this.lastEvalAt = 0;
    this.fired = false;
    this.reason = '';
  }

  /**
   * Feed a streamed chunk.
   * Returns true exactly once, on the chunk that crosses a threshold.
   */
  push(text: string): boolean {
    if (!text) return false;
    this.total += text.length;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) this.alnum++;
    }
    this.buffer += text;
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer = this.buffer.slice(this.buffer.length - BUFFER_LIMIT);
    }

    if (this.fired) return false;
    if (this.total < this.minChars) return false;
    if (this.lastEvalAt > 0 && this.total - this.lastEvalAt < EVAL_STRIDE) return false;
    this.lastEvalAt = this.total;

    const ratio = this.alnum / this.total;
    if (ratio <= this.maxAlnumRatio) {
      this.fired = true;
      this.reason = `${(ratio * 100).toFixed(3)}% alphanumeric content`;
      return true;
    }

    const unique = uniquePhraseRatio(this.buffer);
    if (unique <= this.minUniquePhraseRatio) {
      this.fired = true;
      this.reason = `only ${(unique * 100).toFixed(1)}% of its phrases distinct — a repetition loop`;
      return true;
    }

    return false;
  }

  get stats(): { chars: number; alnum: number; ratio: number } {
    return {
      chars: this.total,
      alnum: this.alnum,
      ratio: this.total ? this.alnum / this.total : 0,
    };
  }

  /** Operator-facing description of why the turn was cut off. */
  describe(): string {
    return `${this.total.toLocaleString()} characters with ${this.reason || 'no usable content'}`;
  }
}
