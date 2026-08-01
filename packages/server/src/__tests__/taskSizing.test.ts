import { describe, it, expect } from 'vitest';
import { checkTaskSize, sizeRank, TASK_SIZES } from '../agents/commands/taskSizing.js';

const ON = { requireTaskSize: true, maxDelegatedSize: 'XS' as const };

describe('taskSizing', () => {
  describe('sizeRank', () => {
    it('orders the scale from XS to XL', () => {
      const ranks = TASK_SIZES.map(sizeRank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(sizeRank('XS')).toBeLessThan(sizeRank('XL'));
    });
  });

  describe('gate disabled (default)', () => {
    it('allows a task with no size when policy is undefined', () => {
      expect(checkTaskSize(undefined, undefined, 'DELEGATE').ok).toBe(true);
    });

    it('allows an XL task when requireTaskSize is false', () => {
      expect(checkTaskSize('XL', { requireTaskSize: false }, 'DELEGATE').ok).toBe(true);
    });
  });

  describe('gate enabled', () => {
    it('rejects a task with no declared size', () => {
      const result = checkTaskSize(undefined, ON, 'DELEGATE');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('missing "size"');
    });

    it('accepts XS', () => {
      expect(checkTaskSize('XS', ON, 'DELEGATE').ok).toBe(true);
    });

    it('rejects every size above the maximum', () => {
      for (const size of ['S', 'M', 'L', 'XL']) {
        const result = checkTaskSize(size, ON, 'DELEGATE');
        expect(result.ok, `${size} should be rejected when max is XS`).toBe(false);
        expect(result.message).toContain(`task is ${size}`);
      }
    });

    it('honours a raised ceiling', () => {
      const policy = { requireTaskSize: true, maxDelegatedSize: 'M' as const };
      expect(checkTaskSize('S', policy, 'DELEGATE').ok).toBe(true);
      expect(checkTaskSize('M', policy, 'DELEGATE').ok).toBe(true);
      expect(checkTaskSize('L', policy, 'DELEGATE').ok).toBe(false);
    });

    it('defaults the ceiling to XS when unspecified', () => {
      const result = checkTaskSize('S', { requireTaskSize: true }, 'DELEGATE');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('only XS or smaller');
    });

    it('is case-insensitive on the declared size', () => {
      expect(checkTaskSize('xs', ON, 'DELEGATE').ok).toBe(true);
    });

    it('rejects a size outside the scale', () => {
      const result = checkTaskSize('TINY', ON, 'DELEGATE');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('invalid size');
    });

    it('names the command that was rejected', () => {
      expect(checkTaskSize('XL', ON, 'CREATE_AGENT').message).toContain('CREATE_AGENT');
    });
  });

  describe('rejection wording', () => {
    // A lead told only "too large" can conclude the work is its own to do —
    // the one thing its charter forbids. Every rejection must say otherwise.
    it('tells the lead to decompose and delegate, not to implement', () => {
      for (const declared of [undefined, 'L']) {
        const message = checkTaskSize(declared, ON, 'DELEGATE').message!;
        expect(message).toContain('Do not implement it yourself');
        expect(message.toLowerCase()).toContain('delegate');
      }
    });

    it('states what a compliant task looks like', () => {
      const message = checkTaskSize('M', ON, 'DELEGATE').message!;
      expect(message).toContain('files named');
      expect(message).toContain('acceptance check');
    });
  });
});
