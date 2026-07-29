import { describe, it, expect } from 'vitest';
import { redactConfigSecrets } from './config.js';
import type { ServerConfig } from '../config.js';

const base: ServerConfig = {
  port: 3001,
  host: '127.0.0.1',
  provider: 'copilot',
  cliCommand: 'copilot',
  cliArgs: [],
  maxConcurrentAgents: 6,
  dbPath: './test.db',
};

describe('redactConfigSecrets', () => {
  it('removes envOverride, which can hold provider credentials', () => {
    const out = redactConfigSecrets({
      ...base,
      roleOverrides: {
        developer: {
          model: 'qwen3.6-35b-a3b',
          provider: 'copilot',
          envOverride: {
            COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1',
            COPILOT_PROVIDER_API_KEY: 'super-secret-key',
          },
        },
      },
    });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain('COPILOT_PROVIDER_API_KEY');
    expect(out.roleOverrides!.developer).not.toHaveProperty('envOverride');
  });

  it('keeps non-secret role fields and flags that env exists', () => {
    const out = redactConfigSecrets({
      ...base,
      roleOverrides: {
        developer: {
          model: 'qwen3.6-35b-a3b',
          provider: 'copilot',
          extraArgs: ['--foo'],
          envOverride: { SECRET: 'x' },
        },
        architect: { model: 'claude-opus-4.8', provider: 'copilot' },
      },
    });

    expect(out.roleOverrides!.developer.model).toBe('qwen3.6-35b-a3b');
    expect(out.roleOverrides!.developer.provider).toBe('copilot');
    expect(out.roleOverrides!.developer.extraArgs).toEqual(['--foo']);
    expect(out.roleOverrides!.developer.hasEnvOverride).toBe(true);
    // a role with no env is untouched and not flagged
    expect(out.roleOverrides!.architect.hasEnvOverride).toBeUndefined();
  });

  it('passes through a config with no roleOverrides', () => {
    const out = redactConfigSecrets(base);
    expect(out).toEqual(base);
    expect(out.roleOverrides).toBeUndefined();
  });

  it('preserves the rest of the config', () => {
    const out = redactConfigSecrets({ ...base, roleOverrides: { dev: { envOverride: { A: 'b' } } } });
    expect(out.provider).toBe('copilot');
    expect(out.maxConcurrentAgents).toBe(6);
    expect(out.dbPath).toBe('./test.db');
  });
});
