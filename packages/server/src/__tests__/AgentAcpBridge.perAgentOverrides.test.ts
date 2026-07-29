import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger ───────────────────────────────────────────────────
const warn = vi.fn();
vi.mock('../utils/logger.js', () => {
  const { AsyncLocalStorage } = require('node:async_hooks');
  return {
    logger: { info: vi.fn(), warn: (...a: any[]) => warn(...a), error: vi.fn(), debug: vi.fn() },
    logContext: new AsyncLocalStorage(),
  };
});

vi.mock('../agents/agentFiles.js', () => ({
  agentFlagForRole: (roleId: string) => roleId,
}));

vi.mock('../adapters/RoleFileWriter.js', () => ({
  createRoleFileWriter: vi.fn(() => ({ writeRoleFiles: vi.fn().mockResolvedValue([]) })),
  listRoleFileWriterProviders: vi.fn(() => ['copilot']),
}));

const mockAdapter: Record<string, any> = {
  start: vi.fn().mockResolvedValue('session-1'),
  on: vi.fn(),
  terminate: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
  cancel: vi.fn().mockResolvedValue(undefined),
  type: 'acp',
  isPrompting: false,
  flushSystemNotes: vi.fn(() => ''),
};

const createAdapterForProvider = vi.fn(() => ({
  adapter: mockAdapter,
  backend: 'acp',
  fallback: false,
}));

vi.mock('../adapters/AdapterFactory.js', () => ({
  createAdapterForProvider: (...args: any[]) => (createAdapterForProvider as any)(...args),
  buildStartOptions: vi.fn(() => ({ options: { cwd: '/test' }, modelResolution: undefined })),
}));

import { startAcp } from '../agents/AgentAcpBridge.js';
import type { ServerConfig } from '../config.js';

function createFakeAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-1',
    role: { id: 'developer', name: 'Developer', description: '', systemPrompt: '', model: undefined },
    model: undefined,
    cwd: '/test/project',
    isResuming: false,
    _isTerminated: false,
    phase: 'idle',
    status: 'idle',
    messages: [],
    toolCalls: [],
    _maxMessages: 10,
    _maxToolCalls: 10,
    transitionTo: vi.fn(),
    _setAcpConnection: vi.fn(),
    _notifyStatusChange: vi.fn(),
    _notifySessionReady: vi.fn(),
    _notifyExit: vi.fn(),
    _notifyModelFallback: vi.fn(),
    _finishResuming: vi.fn(),
    queueMessage: vi.fn(),
    recordTokenSample: vi.fn(),
    ...overrides,
  } as any;
}

const baseConfig: ServerConfig = {
  port: 3001,
  host: '127.0.0.1',
  cliCommand: 'copilot',
  cliArgs: [],
  provider: 'copilot',
  maxConcurrentAgents: 50,
  dbPath: './test.db',
};

/** Grab the AdapterConfig that startAcp handed to the factory. */
function adapterConfigArg() {
  return (createAdapterForProvider as any).mock.calls[0][0];
}

describe('AgentAcpBridge — per-agent backend overrides', () => {
  beforeEach(() => { vi.clearAllMocks(); warn.mockClear(); });
  afterEach(() => vi.restoreAllMocks());

  it('falls back to the global provider env when the agent has none', async () => {
    const agent = createFakeAgent();
    const config = { ...baseConfig, providerEnvOverride: { GLOBAL_VAR: 'g' } };

    await startAcp(agent, config);

    expect(adapterConfigArg().envOverride).toEqual({ GLOBAL_VAR: 'g' });
  });

  it('merges per-agent env over global env, agent winning on conflict', async () => {
    const agent = createFakeAgent({
      provider: 'copilot',
      envOverride: {
        COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1',
        GLOBAL_VAR: 'agent-wins',
      },
    });
    const config = { ...baseConfig, providerEnvOverride: { GLOBAL_VAR: 'g', KEEP: 'k' } };

    await startAcp(agent, config);

    expect(adapterConfigArg().envOverride).toEqual({
      KEEP: 'k',
      GLOBAL_VAR: 'agent-wins',
      COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1',
    });
  });

  it('isolates backends between two agents on the SAME provider', async () => {
    // The core requirement: one crew, one provider, two model backends.
    const localAgent = createFakeAgent({
      provider: 'copilot',
      envOverride: {
        COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1',
        COPILOT_MODEL: 'qwen3.6-35b-a3b',
      },
    });
    await startAcp(localAgent, baseConfig);
    const localCfg = adapterConfigArg();

    (createAdapterForProvider as any).mockClear();

    const copilotAgent = createFakeAgent({ id: 'agent-2', provider: 'copilot' });
    await startAcp(copilotAgent, baseConfig);
    const copilotCfg = adapterConfigArg();

    expect(localCfg.provider).toBe('copilot');
    expect(copilotCfg.provider).toBe('copilot');
    expect(localCfg.envOverride?.COPILOT_PROVIDER_BASE_URL).toBe('http://127.0.0.1:8090/v1');
    expect(copilotCfg.envOverride).toBeUndefined();
  });

  it('passes per-agent extraArgs separately so preset args are not clobbered', async () => {
    // argsOverride REPLACES the provider preset; extraArgs must be additive,
    // otherwise adding a flag would drop required ones like `--acp --stdio`.
    const agent = createFakeAgent({
      provider: 'copilot',
      extraArgs: ['--additional-mcp-config', '@/repo/.mcp.json'],
    });
    const config = { ...baseConfig, providerArgsOverride: ['--acp', '--stdio'] };

    await startAcp(agent, config);

    const cfg = adapterConfigArg();
    expect(cfg.argsOverride).toEqual(['--acp', '--stdio']);
    expect(cfg.extraArgs).toEqual(['--additional-mcp-config', '@/repo/.mcp.json']);
  });

  it('prefers a per-agent binaryOverride over the global one', async () => {
    const agent = createFakeAgent({ provider: 'copilot', binaryOverride: '/custom/copilot-wrapper' });
    const config = { ...baseConfig, providerBinaryOverride: '/global/copilot' };

    await startAcp(agent, config);

    expect(adapterConfigArg().binaryOverride).toBe('/custom/copilot-wrapper');
  });

  // ── Provider-scoping invariant ────────────────────────────────────
  // Upstream clears global overrides when falling back to a different provider
  // (commit "clear provider overrides when falling back to a different
  // provider"), because an env tuple written for provider A is meaningless or
  // harmful for provider B. Per-agent overrides honour the same rule.

  it('IGNORES per-agent overrides when the role did not pin a provider', async () => {
    // Without a pinned provider we cannot know which provider these vars target
    // — the global provider may have fallen back to a different CLI.
    const agent = createFakeAgent({
      envOverride: { COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1' },
      extraArgs: ['--danger'],
      binaryOverride: '/custom/bin',
    });
    const config = { ...baseConfig, provider: 'claude', providerBinaryOverride: '/global/claude' };

    await startAcp(agent, config);

    const cfg = adapterConfigArg();
    expect(cfg.provider).toBe('claude');
    // Copilot BYOK vars must NOT leak into a Claude process.
    expect(cfg.envOverride).toBeUndefined();
    expect(cfg.argsOverride).toBeUndefined();
    expect(cfg.binaryOverride).toBe('/global/claude');
  });

  it('warns when per-agent overrides are dropped so the misconfig is visible', async () => {
    const agent = createFakeAgent({
      envOverride: { COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1' },
    });

    await startAcp(agent, { ...baseConfig, provider: 'claude' });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        module: 'agent-bridge',
        declaredProvider: '(none)',
        effectiveProvider: 'claude',
      }),
    );
  });

  it('still applies GLOBAL overrides when per-agent ones are dropped', async () => {
    const agent = createFakeAgent({ envOverride: { X: '1' } });
    const config = { ...baseConfig, provider: 'claude', providerEnvOverride: { ANTHROPIC_API_KEY: 'sk' } };

    await startAcp(agent, config);

    expect(adapterConfigArg().envOverride).toEqual({ ANTHROPIC_API_KEY: 'sk' });
  });
});

