import { describe, it, expect } from 'vitest';
import { checkTaskSize, gateAppliesToRole, sizeRank, TASK_SIZES, DEFAULT_SIZED_ROLES } from '../agents/commands/taskSizing.js';

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
      expect(checkTaskSize(undefined, undefined, 'DELEGATE', 'developer').ok).toBe(true);
    });

    it('allows an XL task when requireTaskSize is false', () => {
      expect(checkTaskSize('XL', { requireTaskSize: false }, 'DELEGATE', 'developer').ok).toBe(true);
    });
  });

  describe('gate enabled', () => {
    it('rejects a task with no declared size', () => {
      const result = checkTaskSize(undefined, ON, 'DELEGATE', 'developer');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('missing "size"');
    });

    it('accepts XS', () => {
      expect(checkTaskSize('XS', ON, 'DELEGATE', 'developer').ok).toBe(true);
    });

    it('rejects every size above the maximum', () => {
      for (const size of ['S', 'M', 'L', 'XL']) {
        const result = checkTaskSize(size, ON, 'DELEGATE', 'developer');
        expect(result.ok, `${size} should be rejected when max is XS`).toBe(false);
        expect(result.message).toContain(`task is ${size}`);
      }
    });

    it('honours a raised ceiling', () => {
      const policy = { requireTaskSize: true, maxDelegatedSize: 'M' as const };
      expect(checkTaskSize('S', policy, 'DELEGATE', 'developer').ok).toBe(true);
      expect(checkTaskSize('M', policy, 'DELEGATE', 'developer').ok).toBe(true);
      expect(checkTaskSize('L', policy, 'DELEGATE', 'developer').ok).toBe(false);
    });

    it('defaults the ceiling to XS when unspecified', () => {
      const result = checkTaskSize('S', { requireTaskSize: true }, 'DELEGATE', 'developer');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('only XS or smaller');
    });

    it('is case-insensitive on the declared size', () => {
      expect(checkTaskSize('xs', ON, 'DELEGATE', 'developer').ok).toBe(true);
    });

    it('rejects a size outside the scale', () => {
      const result = checkTaskSize('TINY', ON, 'DELEGATE', 'developer');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('invalid size');
    });

    it('names the command that was rejected', () => {
      expect(checkTaskSize('XL', ON, 'CREATE_AGENT', 'developer').message).toContain('CREATE_AGENT');
    });
  });

  describe('rejection wording', () => {
    // A lead told only "too large" can conclude the work is its own to do —
    // the one thing its charter forbids. Every rejection must say otherwise.
    it('tells the lead to decompose and delegate, not to implement', () => {
      for (const declared of [undefined, 'L']) {
        const message = checkTaskSize(declared, ON, 'DELEGATE', 'developer').message!;
        expect(message).toContain('Do not implement it yourself');
        expect(message.toLowerCase()).toContain('delegate');
      }
    });

    it('states what a compliant task looks like', () => {
      const message = checkTaskSize('M', ON, 'DELEGATE', 'developer').message!;
      expect(message).toContain('files named');
      expect(message).toContain('acceptance check');
    });
  });

  describe('role scoping', () => {
    // The gate protects agents whose workload is defined by the request text.
    // A reviewer's scope is set by the diff it reads, so forcing an XS label
    // there is ceremony that blocks useful work.
    it('applies to implementation roles by default', () => {
      for (const role of DEFAULT_SIZED_ROLES) {
        expect(gateAppliesToRole(role, ON), role).toBe(true);
      }
    });

    it('does not apply to review, planning or reporting roles', () => {
      for (const role of ['code-reviewer', 'critical-reviewer', 'readability-reviewer',
        'qa-tester', 'architect', 'secretary', 'lead', 'designer', 'product-manager']) {
        expect(gateAppliesToRole(role, ON), role).toBe(false);
      }
    });

    it('lets an unsized reviewer delegation through untouched', () => {
      expect(checkTaskSize(undefined, ON, 'DELEGATE', 'code-reviewer').ok).toBe(true);
      expect(checkTaskSize('XL', ON, 'DELEGATE', 'code-reviewer').ok).toBe(true);
    });

    it('still gates the developer in the same config', () => {
      expect(checkTaskSize(undefined, ON, 'DELEGATE', 'developer').ok).toBe(false);
    });

    it('honours an explicit role allowlist', () => {
      const policy = { requireTaskSize: true, maxDelegatedSize: 'XS' as const, roles: ['architect'] };
      expect(gateAppliesToRole('architect', policy)).toBe(true);
      expect(gateAppliesToRole('developer', policy)).toBe(false);
    });

    it('never applies while the gate is off', () => {
      expect(gateAppliesToRole('developer', { requireTaskSize: false })).toBe(false);
      expect(gateAppliesToRole('developer', undefined)).toBe(false);
    });
  });
});