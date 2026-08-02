import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  DegenerateOutputDetector,
  DEFAULT_DEGENERATE_POLICY,
  uniquePhraseRatio,
} from '../agents/degenerateOutput.js';

const MIN = DEFAULT_DEGENERATE_POLICY.minChars;

/** Mode 1: empty code fences — 95% newlines, 5% backticks, no letters. */
const fences = (bytes: number) => {
  let s = '';
  while (s.length < bytes) s += '```\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n';
  return s.slice(0, bytes);
};

/** Mode 2: the observed termination-failure loop. Normal letter density. */
const stopLoop = (bytes: number) => {
  let s = '';
  while (s.length < bytes) s += 'No. Stop. END. Done. No more. I am done. I will cease. No further. This is the end. ';
  return s.slice(0, bytes);
};

/** Varied prose of arbitrary length. */
const prose = (bytes: number) => {
  const vocab = ['implementation', 'callback', 'lifecycle', 'constructor', 'regression', 'delegate',
    'reviewer', 'threshold', 'concurrent', 'instance', 'coverage', 'assertion', 'pipeline', 'artifact'];
  let s = '';
  let i = 0;
  while (s.length < bytes) {
    s += `The ${vocab[i % vocab.length]} for ${vocab[(i * 7 + 3) % vocab.length]} at step ${i} `
      + `verified ${vocab[(i * 13 + 5) % vocab.length]} against ${vocab[(i * 3 + 1) % vocab.length]}. `;
    i++;
  }
  return s.slice(0, bytes);
};

/** Lockfile-shaped JSON — the worst realistic case for legitimate repetition. */
const lockfileJson = (bytes: number) => {
  let s = '';
  let i = 0;
  while (s.length < bytes) {
    const hash = ((i * 2654435761) % 1e12).toString(36);
    s += `    "node_modules/pkg-${i}": {\n      "version": "${i}.${i % 7}.${i % 3}",\n`
      + `      "resolved": "https://registry.npmjs.org/pkg-${i}/-/pkg-${i}-${i}.0.0.tgz",\n`
      + `      "integrity": "sha512-${hash}"\n    },\n`;
    i++;
  }
  return s.slice(0, bytes);
};

/**
 * Real repository content, concatenated from distinct source files.
 * Synthetic fixtures are a poor proxy here: a templated generator repeats its
 * own scaffolding and looks degenerate (measured at 46% unique), whereas real
 * hand-written code reaches 92%.
 */
const realSource = (() => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const root = join(dir, '..');
  const files: string[] = [];
  const walk = (d: string) => {
    if (files.length > 60) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !e.name.includes('.test.')) files.push(p);
    }
  };
  walk(root);
  let out = '';
  for (const f of files) {
    out += readFileSync(f, 'utf8') + '\n';
    if (out.length > MIN + 50_000) break;
  }
  return out;
})();

describe('uniquePhraseRatio', () => {
  it('is high for real written content', () => {
    expect(uniquePhraseRatio(realSource)).toBeGreaterThan(0.8);
  });

  it('collapses for a repeated phrase', () => {
    expect(uniquePhraseRatio(stopLoop(60_000))).toBeLessThan(0.5);
  });

  it('returns 1 for text too short to judge', () => {
    expect(uniquePhraseRatio('too short to mean anything')).toBe(1);
  });

  it('returns 1 for text with no words', () => {
    expect(uniquePhraseRatio(fences(5_000))).toBe(1);
  });
});

describe('DegenerateOutputDetector', () => {
  describe('mode 1 — structural noise', () => {
    it('fires on bulk output with no alphanumeric content', () => {
      expect(new DegenerateOutputDetector().push(fences(MIN + 1))).toBe(true);
    });

    it('fires at the alphanumeric level seen in production (0.96%)', () => {
      // A 625 KB message measured 0.96% alphanumeric and escaped the original
      // 0.5% threshold. The ceiling is now 2%.
      const d = new DegenerateOutputDetector();
      const letters = 'x'.repeat(Math.floor(MIN * 0.0096));
      expect(d.push(fences(MIN) + letters)).toBe(true);
    });
  });

  describe('mode 2 — termination failure loop', () => {
    it('fires on a repeated stop-phrase loop despite normal letter density', () => {
      const d = new DegenerateOutputDetector();
      expect(d.push(stopLoop(MIN + 50_000))).toBe(true);
      // Proves the alphanumeric check alone would never have caught it.
      expect(d.stats.ratio).toBeGreaterThan(0.2);
    });

    it('reports repetition as the reason', () => {
      const d = new DegenerateOutputDetector();
      d.push(stopLoop(MIN + 50_000));
      expect(d.describe()).toContain('repetition loop');
    });

    it('catches a loop that begins after legitimate content', () => {
      const d = new DegenerateOutputDetector();
      let fired = false;
      fired = d.push(prose(40_000)) || fired;
      for (let i = 0; i < 12; i++) fired = d.push(stopLoop(20_000)) || fired;
      expect(fired).toBe(true);
    });
  });

  describe('false-positive resistance', () => {
    it('ignores anything below the size gate', () => {
      expect(new DegenerateOutputDetector().push(stopLoop(MIN - 1))).toBe(false);
      expect(new DegenerateOutputDetector().push(fences(MIN - 1))).toBe(false);
    });

    it('never fires on real repository source', () => {
      // 60+ distinct hand-written modules, measured at 92% unique phrases.
      expect(new DegenerateOutputDetector().push(realSource)).toBe(false);
    });

    it('never fires on machine-generated JSON, the worst realistic case', () => {
      // Measured on a real 477 KB package-lock.json: 60% unique phrases
      // against a 50% threshold — the narrowest genuine margin found.
      expect(new DegenerateOutputDetector().push(lockfileJson(MIN + 20_000))).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('fires only once per turn', () => {
      const d = new DegenerateOutputDetector();
      expect(d.push(fences(MIN + 1))).toBe(true);
      expect(d.push(fences(MIN + 1))).toBe(false);
    });

    it('re-arms after reset', () => {
      const d = new DegenerateOutputDetector();
      d.push(fences(MIN + 1));
      d.reset();
      expect(d.stats.chars).toBe(0);
      expect(d.push(fences(MIN + 1))).toBe(true);
    });

    it('accumulates across many small chunks', () => {
      const d = new DegenerateOutputDetector();
      let fired = false;
      for (let i = 0; i < 40; i++) fired = d.push(fences(5_000)) || fired;
      expect(fired).toBe(true);
    });

    it('ignores empty chunks', () => {
      const d = new DegenerateOutputDetector();
      expect(d.push('')).toBe(false);
      expect(d.stats.chars).toBe(0);
    });

    it('honours a custom policy', () => {
      const d = new DegenerateOutputDetector({ minChars: 100, maxAlnumRatio: 0.01 });
      expect(d.push(fences(150))).toBe(true);
    });
  });
});
