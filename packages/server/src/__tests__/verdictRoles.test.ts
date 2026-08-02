import { describe, it, expect } from 'vitest';
import { producesVerdict, VERDICT_ROLES } from '../agents/commands/verdictRoles.js';

describe('verdict roles', () => {
  it('treats every review role as verdict-producing', () => {
    for (const role of ['code-reviewer', 'critical-reviewer', 'readability-reviewer']) {
      expect(producesVerdict(role), role).toBe(true);
    }
  });

  it('treats QA as verdict-producing', () => {
    // QA decides whether the software actually works; going idle is a verdict,
    // not a deliverable.
    expect(producesVerdict('qa-tester')).toBe(true);
  });

  it('leaves producing roles on auto-completion', () => {
    // These hand back an artefact. Finishing genuinely means the task is done,
    // so the existing auto-complete behaviour is correct for them.
    for (const role of ['developer', 'architect', 'tech-writer', 'designer',
      'generalist', 'secretary', 'product-manager', 'radical-thinker', 'agent', 'lead']) {
      expect(producesVerdict(role), role).toBe(false);
    }
  });

  it('is safe for unknown roles', () => {
    expect(producesVerdict('some-custom-role')).toBe(false);
  });

  it('exposes the set for callers that need to enumerate it', () => {
    expect(VERDICT_ROLES.size).toBe(4);
  });
});
