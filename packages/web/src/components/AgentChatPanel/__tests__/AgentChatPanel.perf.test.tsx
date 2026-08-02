// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

Element.prototype.scrollIntoView = vi.fn();

// Counts how often message content is rendered. Typing must not move this.
const counters = vi.hoisted(() => ({ markdown: 0 }));

vi.mock('../../ui/Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    counters.markdown++;
    return <div data-testid="ui-markdown">{text}</div>;
  },
  MAX_MARKDOWN_CHARS: 32_000,
}));

const mockApiFetch = vi.fn().mockResolvedValue({ messages: [] });
vi.mock('../../../hooks/useApi', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockAgents: any[] = [{
  id: 'agent-abc123',
  role: { id: 'lead', name: 'Project Lead' },
  status: 'running',
  messages: [],
}];
vi.mock('../../../stores/appStore', () => ({
  useAppStore: Object.assign(
    (selector: any) => selector({ agents: mockAgents, updateAgent: vi.fn() }),
    { getState: () => ({ agents: mockAgents, updateAgent: vi.fn() }) },
  ),
}));

vi.mock('../../../components/Toast', () => ({
  useToastStore: Object.assign(
    (selector: any) => selector({ add: vi.fn() }),
    { getState: () => ({ add: vi.fn() }) },
  ),
}));

vi.mock('../../../utils/markdown', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div>{text}</div>,
  AgentIdBadge: ({ id }: { id: string }) => <span>{id.slice(0, 8)}</span>,
}));

vi.mock('../../../utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '2m ago',
}));

import { AgentChatPanel } from '../AgentChatPanel';
import { useMessageStore } from '../../../stores/messageStore';

const MESSAGE_COUNT = 40;

function seedMessages() {
  const msgs = Array.from({ length: MESSAGE_COUNT }, (_, i) => ({
    type: 'text' as const,
    text: `Message number ${i} with some body text`,
    sender: 'agent' as const,
    timestamp: Date.now() - i * 1000,
  }));
  useMessageStore.getState().ensureChannel('agent-abc123');
  useMessageStore.getState().setMessages('agent-abc123', msgs);
}

describe('AgentChatPanel typing performance', () => {
  beforeEach(() => {
    counters.markdown = 0;
    mockApiFetch.mockReset().mockResolvedValue({ messages: [] });
    useMessageStore.getState().reset?.();
  });
  afterEach(() => cleanup());

  it('does not re-render message bodies while typing', async () => {
    seedMessages();
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });

    const afterMount = counters.markdown;
    expect(afterMount).toBeGreaterThan(0);

    const input = screen.getByTestId('agent-chat-input');
    // Each keystroke updates inputText state on the panel. Before memoisation
    // this re-rendered every bubble, re-parsing the whole transcript per key.
    for (const value of ['h', 'he', 'hel', 'hell', 'hello']) {
      await act(async () => { fireEvent.change(input, { target: { value } }); });
    }

    expect(counters.markdown).toBe(afterMount);
  });

  it('still renders new messages when the transcript changes', async () => {
    seedMessages();
    await act(async () => { render(<AgentChatPanel agentId="agent-abc123" />); });
    const afterMount = counters.markdown;

    await act(async () => {
      useMessageStore.getState().addMessage('agent-abc123', {
        type: 'text', text: 'a brand new message', sender: 'agent', timestamp: Date.now(),
      } as any);
    });

    expect(counters.markdown).toBeGreaterThan(afterMount);
  });
});
