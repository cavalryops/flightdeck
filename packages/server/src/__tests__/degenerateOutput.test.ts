import { describe, it, expect } from 'vitest';
import { DegenerateOutputDetector, DEFAULT_DEGENERATE_POLICY } from '../agents/degenerateOutput.js';

// Reproduces the observed failure: empty code fences, ~95% newlines / 5% backticks.
const junk = (bytes: number) => {
  let s = '';
  while (s.length < bytes) s += '```\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n';
  return s.slice(0, bytes);
};

describe('DegenerateOutputDetector', () => {
  it('fires on bulk output with no alphanumeric content', () => {
    const d = new DegenerateOutputDetector();
    expect(d.push(junk(DEFAULT_DEGENERATE_POLICY.minChars + 1))).toBe(true);
  });

  it('fires only once per turn', () => {
    const d = new DegenerateOutputDetector();
    expect(d.push(junk(300_000))).toBe(true);
    expect(d.push(junk(300_000))).toBe(false);
  });

  it('re-arms after reset', () => {
    const d = new DegenerateOutputDetector();
    d.push(junk(300_000));
    d.reset();
    expect(d.stats.chars).toBe(0);
    expect(d.push(junk(300_000))).toBe(true);
  });

  it('accumulates across chunks rather than judging each alone', () => {
    const d = new DegenerateOutputDetector();
    let fired = false;
    for (let i = 0; i < 40; i++) fired = d.push(junk(10_000)) || fired;
    expect(fired).toBe(true);
  });

  describe('false-positive resistance', () => {
    it('ignores junk below the size floor', () => {
      const d = new DegenerateOutputDetector();
      expect(d.push(junk(DEFAULT_DEGENERATE_POLICY.minChars - 1))).toBe(false);
    });

    it('never fires on prose, however long', () => {
      const d = new DegenerateOutputDetector();
      const prose = 'The quick brown fox jumps over the lazy dog. '.repeat(20_000);
      expect(prose.length).toBeGreaterThan(DEFAULT_DEGENERATE_POLICY.minChars);
      expect(d.push(prose)).toBe(false);
    });

    it('never fires on source code', () => {
      const d = new DegenerateOutputDetector();
      const code = 'function handle(req, res) {\n  return res.json({ ok: true });\n}\n\n'.repeat(6_000);
      expect(code.length).toBeGreaterThan(DEFAULT_DEGENERATE_POLICY.minChars);
      expect(d.push(code)).toBe(false);
    });

    it('never fires on base64 payloads', () => {
      const d = new DegenerateOutputDetector();
      expect(d.push('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo='.repeat(10_000))).toBe(false);
    });

    it('never fires on a whitespace-heavy diff that still carries code', () => {
      const d = new DegenerateOutputDetector();
      const diff = '+          const x = 1;\n' + ' '.repeat(400) + '\n';
      expect(d.push(diff.repeat(9_000))).toBe(false);
    });

    it('tolerates a trace amount of text inside the junk', () => {
      // 0.5% ceiling: a stray word in 300KB of fences must still be caught.
      const d = new DegenerateOutputDetector();
      expect(d.push(junk(300_000) + 'status ok')).toBe(true);
    });

    it('does not fire when real content exceeds the ratio', () => {
      const d = new DegenerateOutputDetector();
      const mostlyJunk = junk(300_000) + 'x'.repeat(3_000); // ~1% alnum
      expect(d.push(mostlyJunk)).toBe(false);
    });
  });

  it('reports stats for the operator message', () => {
    const d = new DegenerateOutputDetector();
    d.push(junk(250_000));
    expect(d.stats.chars).toBe(250_000);
    expect(d.stats.alnum).toBe(0);
    expect(d.describe()).toContain('alphanumeric');
  });

  it('honours a custom policy', () => {
    const d = new DegenerateOutputDetector({ minChars: 100, maxAlnumRatio: 0.01 });
    expect(d.push(junk(150))).toBe(true);
  });

  it('ignores empty chunks', () => {
    const d = new DegenerateOutputDetector();
    expect(d.push('')).toBe(false);
    expect(d.stats.chars).toBe(0);
  });
});
