import { z } from 'zod';

// ── Role ──────────────────────────────────────────────────────────

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  color: z.string(),
  icon: z.string(),
  builtIn: z.boolean(),
  model: z.string().optional(),
  receivesStatusUpdates: z.boolean().optional(),
  /**
   * CLI provider used to spawn agents in this role (e.g. 'copilot', 'claude').
   * Falls back to the global `provider.id` when unset.
   */
  provider: z.string().optional(),
  /**
   * Extra environment variables for this role's spawned CLI process, merged
   * over the global `provider.envOverride`.
   *
   * This is what enables heterogeneous backends within one crew. Example: give
   * the `developer` role Copilot CLI's BYOK vars so it runs against a local
   * OpenAI-compatible server, while `architect` keeps using the GitHub Copilot
   * subscription:
   *
   *   roles:
   *     developer:
   *       provider: copilot
   *       envOverride:
   *         COPILOT_PROVIDER_BASE_URL: http://127.0.0.1:8090/v1
   *         COPILOT_PROVIDER_API_KEY: not-needed
   *         COPILOT_MODEL: qwen3.6-35b-a3b
   */
  envOverride: z.record(z.string(), z.string()).optional(),
  /** Extra CLI args appended to the provider's base args for this role. */
  extraArgs: z.array(z.string()).optional(),
});
export type Role = z.infer<typeof RoleSchema>;
