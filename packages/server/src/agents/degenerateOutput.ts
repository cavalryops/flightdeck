/**
 * Degenerate output detection.
 *
 * A model can fall into a repetition loop and stream indefinitely without
 * producing anything: observed in practice as ~900 KB of empty code fences
 * (95% newlines, 5% backticks, zero alphanumeric characters) emitted over an
 * hour. Nothing stopped it — the turn never completed, so queued messages were
 * never delivered, and the junk fed back into the agent's own context.
 *
 * The check is deliberately narrow. Cancelling a healthy agent is worse than
 * missing a sick one, so it fires only on output that is simultaneously very
 * large AND almost entirely free of alphanumeric characters. Real output —
 * prose, code, JSON, logs, base64, stack traces — is heavily alphanumeric and
 * cannot approach the threshold. Formatting-heavy output (tables, ASCII art,
 * diffs) still carries far more than 0.5% letters and digits.
 *
 * Detection is per-turn: counters reset when a response starts or completes.
 */

export interface DegenerateOutputPolicy {
  /** Bytes of a single turn's output below which the check never fires. */
  minChars?: number;
  /** Fire only when the alphanumeric fraction is at or below this. */
  maxAlnumRatio?: number;
}

export const DEFAULT_DEGENERATE_POLICY: Required<DegenerateOutputPolicy> = {
  // ~50K tokens of nothing. Large enough that no real turn reaches it without
  // real content, small enough to cut the loop off early.
  minChars: 200_000,
  maxAlnumRatio: 0.005,
};

export class DegenerateOutputDetector {
  private total = 0;
  private alnum = 0;
  private fired = false;
  private readonly minChars: number;
  private readonly maxAlnumRatio: number;

  constructor(policy?: DegenerateOutputPolicy) {
    this.minChars = policy?.minChars ?? DEFAULT_DEGENERATE_POLICY.minChars;
    this.maxAlnumRatio = policy?.maxAlnumRatio ?? DEFAULT_DEGENERATE_POLICY.maxAlnumRatio;
  }

  /** Clear counters for a new turn. */
  reset(): void {
    this.total = 0;
    this.alnum = 0;
    this.fired = false;
  }

  /**
   * Feed a streamed chunk.
   * Returns true exactly once, on the chunk that crosses the threshold.
   */
  push(text: string): boolean {
    if (!text) return false;
    this.total += text.length;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) this.alnum++;
    }
    if (this.fired) return false;
    if (this.total < this.minChars) return false;
    if (this.alnum / this.total > this.maxAlnumRatio) return false;
    this.fired = true;
    return true;
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
    const { chars, alnum, ratio } = this.stats;
    return `${chars.toLocaleString()} characters with ${alnum} alphanumeric (${(ratio * 100).toFixed(3)}%)`;
  }
}
