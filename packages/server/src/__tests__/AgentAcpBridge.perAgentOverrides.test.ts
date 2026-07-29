import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger ───────────────────────────────────────────────────
vi.mock('../utils/logger.js', () => {
  const { AsyncLocalStorage } = require('node:async_hooks');
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('falls back to the global provider env when the agent has none', async () => {
    const agent = createFakeAgent();
    const config = { ...baseConfig, providerEnvOverride: { GLOBAL_VAR: 'g' } };

    await startAcp(agent, config);

    expect(adapterConfigArg().envOverride).toEqual({ GLOBAL_VAR: 'g' });
  });

  it('merges per-agent env over global env, agent winning on conflict', async () => {
    const agent = createFakeAgent({
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
    // This is the core requirement: one crew, one provider (copilot),
    // two different model backends.
    const localAgent = createFakeAgent({
      envOverride: {
        COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:8090/v1',
        COPILOT_MODEL: 'qwen3.6-35b-a3b',
      },
    });
    await startAcp(localAgent, baseConfig);
    const localCfg = adapterConfigArg();

    (createAdapterForProvider as any).mockClear();

    const copilotAgent = createFakeAgent({ id: 'agent-2' });
    await startAcp(copilotAgent, baseConfig);
    const copilotCfg = adapterConfigArg();

    // Same provider…
    expect(localCfg.provider).toBe('copilot');
    expect(copilotCfg.provider).toBe('copilot');
    // …different backends.
    expect(localCfg.envOverride?.COPILOT_PROVIDER_BASE_URL).toBe('http://127.0.0.1:8090/v1');
    expect(copilotCfg.envOverride).toBeUndefined();
  });

  it('appends per-agent extraArgs after the global args', async () => {
    const agent = createFakeAgent({ extraArgs: ['--additional-mcp-config', '@/repo/.mcp.json'] });
    const config = { ...baseConfig, providerArgsOverride: ['--acp', '--stdio'] };

    await startAcp(agent, config);

    expect(adapterConfigArg().argsOverride).toEqual([
      '--acp', '--stdio', '--additional-mcp-config', '@/repo/.mcp.json',
    ]);
  });

  it('prefers a per-agent binaryOverride over the global one', async () => {
    const agent = createFakeAgent({ binaryOverride: '/custom/copilot-wrapper' });
    const config = { ...baseConfig, providerBinaryOverride: '/global/copilot' };

    await startAcp(agent, config);

    expect(adapterConfigArg().binaryOverride).toBe('/custom/copilot-wrapper');
  });
});
