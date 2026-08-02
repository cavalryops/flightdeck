/**
 * Which roles produce a verdict rather than a deliverable.
 *
 * For these, "the agent went idle" means "the verdict has been delivered", not
 * "the work succeeded". Auto-completing their DAG task conflates the two and
 * puts the lead into an unwinnable state: the report says FAIL with BLOCKING
 * findings while the DAG says done, and every attempt to act on the failure is
 * refused with "already done — no action needed".
 */
export const VERDICT_ROLES = new Set([
  'code-reviewer',
  'critical-reviewer',
  'readability-reviewer',
  'qa-tester',
]);

/** True when this role's completion is a verdict awaiting the lead's decision. */
export function producesVerdict(roleId: string): boolean {
  return VERDICT_ROLES.has(roleId);
}
