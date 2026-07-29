import { Router } from 'express';
import type { ServerConfig } from '../config.js';
import { updateConfig, getConfig } from '../config.js';
import { validateBody, configPatchSchema } from '../validation/schemas.js';
import type { AppContext } from './context.js';
import { logger } from '../utils/logger.js';

/**
 * Strip secrets from a ServerConfig before returning it over the API.
 *
 * `roleOverrides[*].envOverride` carries the environment handed to a spawned
 * provider CLI, which for a BYOK/local endpoint includes credentials such as
 * COPILOT_PROVIDER_API_KEY. Clients only need to know which model and provider
 * a role is pinned to, so the env is replaced with a boolean marker.
 */
export function redactConfigSecrets(config: ServerConfig): Omit<ServerConfig, 'roleOverrides'> & {
  roleOverrides?: Record<string, { model?: string; provider?: string; extraArgs?: string[]; hasEnvOverride?: true }>;
} {
  const { roleOverrides, ...rest } = config;
  if (!roleOverrides) return rest;
  const safe = Object.fromEntries(
    Object.entries(roleOverrides).map(([roleId, o]) => {
      const { envOverride, ...keep } = o;
      return [roleId, envOverride ? { ...keep, hasEnvOverride: true as const } : keep];
    }),
  );
  return { ...rest, roleOverrides: safe };
}

export function configRoutes(ctx: AppContext): Router {
  const { agentManager } = ctx;
  const router = Router();

  // --- Config ---
  router.get('/config', (_req, res) => {
    res.json(redactConfigSecrets(getConfig()));
  });

  // GET /config/yaml — returns only the oversight section (never expose secrets like API keys)
  router.get('/config/yaml', (_req, res) => {
    if (!ctx.configStore) {
      return res.status(503).json({ error: 'Config store not available' });
    }
    res.json({ oversight: ctx.configStore.current.oversight });
  });

  router.patch('/config', validateBody(configPatchSchema), (req, res) => {
    const sanitized: Partial<ServerConfig> = {};
    if (req.body.maxConcurrentAgents !== undefined) {
      sanitized.maxConcurrentAgents = req.body.maxConcurrentAgents;
    }
    if (req.body.host !== undefined) {
      sanitized.host = req.body.host;
    }
    const updated = updateConfig(sanitized);
    agentManager.setMaxConcurrent(updated.maxConcurrentAgents);
    // Persist to YAML config (single source of truth)
    if (ctx.configStore) {
      const yamlPatch: Record<string, unknown> = {};
      if (sanitized.maxConcurrentAgents !== undefined) {
        yamlPatch.server = { maxConcurrentAgents: updated.maxConcurrentAgents };
      }
      if (req.body.oversightLevel !== undefined) {
        yamlPatch.oversight = { ...yamlPatch.oversight as Record<string, unknown> ?? {}, level: req.body.oversightLevel };
      }
      if (req.body.customInstructions !== undefined) {
        yamlPatch.oversight = { ...yamlPatch.oversight as Record<string, unknown> ?? {}, customInstructions: req.body.customInstructions };
      }
      if (Object.keys(yamlPatch).length > 0) {
        ctx.configStore.writePartial(yamlPatch).catch(err => {
          logger.warn({ module: 'config', msg: 'Failed to persist config to YAML', error: (err as Error).message });
        });
      }
    }
    res.json(updated);
  });

  // --- System pause/resume ---
  router.post('/system/pause', (_req, res) => {
    agentManager.pauseSystem();
    res.json({ paused: true });
  });

  router.post('/system/resume', (_req, res) => {
    agentManager.resumeSystem();
    res.json({ paused: false });
  });

  router.get('/system/status', (_req, res) => {
    res.json({ paused: agentManager.isSystemPaused });
  });

  return router;
}
