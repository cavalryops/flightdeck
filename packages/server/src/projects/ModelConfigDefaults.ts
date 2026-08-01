/**
 * Default model configuration for project roles and validation utilities.
 *
 * Each project can override which models are allowed per role.
 * When no custom config exists, these defaults are used.
 */

/** Maps role names to arrays of allowed model IDs (ordered by preference). */
export type ProjectModelConfig = Record<string, string[]>;

/**
 * All model IDs known to the system.
 * Sourced from AVAILABLE_MODELS (ModelSelector) + RoleRegistry documented list.
 */
export const KNOWN_MODEL_IDS: readonly string[] = [
  // Anthropic
  'claude-opus-4.8',
  'claude-opus-4.7',
  'claude-opus-4.6',
  'claude-opus-4.5',
  'claude-sonnet-5',
  'claude-sonnet-4.6',
  'claude-sonnet-4.5',
  'claude-sonnet-4',
  'claude-haiku-4.5',
  // Google (Gemini) — superset across providers; per-provider availability is
  // gated by ProviderRegistry.restrictedModels (e.g. Copilot exposes the
  // *-preview ids verified against the live CLI bundle).
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash',
  'gemini-3.1-pro',
  'gemini-3.1-flash',
  'gemini-3.1-flash-lite',
  'gemini-3-pro-preview',
  'gemini-3-flash-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  // OpenAI
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.2',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.1',
  'gpt-5.1-codex-mini',
  'gpt-5-mini',
  'gpt-4.1',
  // Moonshot (Kimi)
  'moonshot-v1-8k',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
  'kimi-latest',
  // Qwen
  'qwen-turbo',
  'qwen-plus',
  'qwen-max',
  'qwen-coder-plus-latest',
] as const;

const knownSet = new Set<string>(KNOWN_MODEL_IDS);

/** Fallback model when no project config or role default is available. */
export const DEFAULT_MODEL = 'claude-sonnet-5';

/** Default model config used when a project has no custom config. */
export const DEFAULT_MODEL_CONFIG: ProjectModelConfig = {
  developer: ['claude-opus-4.8'],
  architect: ['claude-opus-4.8'],
  'code-reviewer': ['gpt-5.6-sol', 'claude-opus-4.8'],
  'critical-reviewer': ['gemini-3.1-pro-preview', 'gpt-5.6-sol'],
  'readability-reviewer': ['claude-sonnet-5'],
  'tech-writer': ['gpt-5.6-terra', 'claude-sonnet-5'],
  secretary: ['claude-sonnet-5'],
  'qa-tester': ['claude-sonnet-5'],
  designer: ['claude-opus-4.8'],
  'product-manager': ['gpt-5.6-terra'],
  generalist: ['claude-opus-4.8'],
  'radical-thinker': ['gpt-5.6-sol'],
  agent: ['claude-sonnet-5'],
  lead: ['claude-opus-4.8'],
};

/**
 * Overlay per-role config-file pins onto the built-in defaults.
 *
 * DEFAULT_MODEL_CONFIG is compiled in and cannot know about `roles.<id>.model`
 * from the YAML, nor about models served by a custom/local endpoint. Surfaces
 * that display "the default for this role" must use this, or the UI reports a
 * model the agent will never actually run.
 */
export function effectiveRoleDefaults(
  roleOverrides?: Record<string, { model?: string } | undefined>,
): ProjectModelConfig {
  const out: ProjectModelConfig = { ...DEFAULT_MODEL_CONFIG };
  for (const [roleId, override] of Object.entries(roleOverrides ?? {})) {
    if (override?.model) out[roleId] = [override.model];
  }
  return out;
}

/** Model IDs pinned by the config file that the built-in catalog doesn't know. */
export function configuredModelIds(
  roleOverrides?: Record<string, { model?: string } | undefined>,
): string[] {
  const ids = new Set<string>();
  for (const override of Object.values(roleOverrides ?? {})) {
    if (override?.model && !knownSet.has(override.model)) ids.add(override.model);
  }
  return [...ids];
}

/**
 * Validate that all model IDs in a config are known. Returns unknown IDs.
 *
 * `extraKnown` admits models that only exist at runtime — e.g. a local
 * inference server's catalog pinned via roles.<id>.model. Without it, a config
 * the UI itself rendered as the default would be rejected on save.
 */
export function validateModelConfig(config: ProjectModelConfig, extraKnown: readonly string[] = []): string[] {
  const allowed = extraKnown.length ? new Set([...knownSet, ...extraKnown]) : knownSet;
  const unknown: string[] = [];
  for (const models of Object.values(config)) {
    for (const id of models) {
      if (!allowed.has(id)) {
        unknown.push(id);
      }
    }
  }
  return unknown;
}

/** Validate the shape of a model config object. Returns error message or null. */
export function validateModelConfigShape(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'config must be a JSON object mapping role names to arrays of model IDs';
  }

  const obj = value as Record<string, unknown>;
  for (const [role, models] of Object.entries(obj)) {
    if (!Array.isArray(models)) {
      return `config["${role}"] must be an array of model IDs`;
    }
    if (models.length === 0) {
      return 'Each role must have at least one model selected.';
    }
    for (const m of models) {
      if (typeof m !== 'string') {
        return `config["${role}"] contains a non-string value`;
      }
    }
  }

  return null;
}
