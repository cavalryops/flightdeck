/**
 * Task sizing — enforce that delegated work is decomposed before it is handed
 * to an agent.
 *
 * Prompt instructions alone do not hold: an agent follows them most of the
 * time, and the failure mode is silent. An oversized task does not error, it
 * just produces a worse result, or exhausts a small context window part-way
 * through and leaves half-finished work behind. This makes the rule a
 * precondition of the delegation commands instead of a suggestion.
 *
 * The scale is ordered, so a deployment can permit S while still rejecting L.
 */

export const TASK_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type TaskSize = (typeof TASK_SIZES)[number];

/** Position on the scale; higher is bigger. */
export function sizeRank(size: TaskSize): number {
  return TASK_SIZES.indexOf(size);
}

export interface TaskSizePolicy {
  /** Reject delegation of a task that carries no size. */
  requireTaskSize?: boolean;
  /** Largest size that may be delegated as-is. Defaults to XS. */
  maxDelegatedSize?: TaskSize;
  /**
   * Roles the gate applies to. Defaults to implementation roles only.
   *
   * The gate exists to stop an agent being handed more building work than it
   * can hold in context. Reviews, research and status reporting are bounded by
   * the artefact they examine rather than by how the request was phrased, and
   * forcing an XS label onto "review this diff" adds ceremony without
   * protecting anything.
   */
  roles?: string[];
}

/** Roles whose work is bounded by the task description rather than by an existing artefact. */
export const DEFAULT_SIZED_ROLES = ['developer', 'generalist'];

/** Whether the size gate governs this role at all. */
export function gateAppliesToRole(roleId: string, policy: TaskSizePolicy | undefined): boolean {
  if (!policy?.requireTaskSize) return false;
  return (policy.roles ?? DEFAULT_SIZED_ROLES).includes(roleId);
}

export interface SizeCheckResult {
  ok: boolean;
  /** Operator-facing reason, safe to send to the agent verbatim. */
  message?: string;
}

/**
 * Decide whether a task may be delegated at the size the caller declared.
 *
 * The rejection text deliberately spells out the remedy. A lead told only
 * "rejected: too large" can reasonably conclude the work is its own to do —
 * which is the one thing its charter forbids — so every failure path names
 * decomposition and re-delegation as the next step.
 */
export function checkTaskSize(
  declared: string | undefined,
  policy: TaskSizePolicy | undefined,
  command: string,
  roleId: string,
): SizeCheckResult {
  if (!gateAppliesToRole(roleId, policy)) return { ok: true };

  const max = policy!.maxDelegatedSize ?? 'XS';

  if (!declared) {
    return {
      ok: false,
      message:
        `[System] ${command} rejected: missing "size". Every delegated task must declare one of ${TASK_SIZES.join(', ')}. `
        + `Only ${max} or smaller may be delegated. Break the work into ${max} tasks — each fully specified, with its files named and an explicit acceptance check — then delegate those. `
        + `Do not implement it yourself; decompose and delegate.`,
    };
  }

  const size = declared.toUpperCase() as TaskSize;
  if (!TASK_SIZES.includes(size)) {
    return {
      ok: false,
      message: `[System] ${command} rejected: invalid size "${declared}". Use one of ${TASK_SIZES.join(', ')}.`,
    };
  }

  if (sizeRank(size) > sizeRank(max)) {
    return {
      ok: false,
      message:
        `[System] ${command} rejected: task is ${size}, but only ${max} or smaller may be delegated. `
        + `Split it into ${max} tasks — each fully specified, with its files named and an explicit acceptance check, needing no further discovery — and delegate those instead. `
        + `Do not implement it yourself; decompose and delegate.`,
    };
  }

  return { ok: true };
}
