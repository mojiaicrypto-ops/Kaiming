import { describe, expect, it } from 'vitest';
import { externalChannelKey, isExternalSession } from '../src/chat/session-channel';

describe('session channel', () => {
  it('marks only sessions an external client owns', () => {
    expect(isExternalSession('mcp')).toBe(true);
    expect(isExternalSession('web')).toBe(false);
    expect(isExternalSession(null)).toBe(false);
    expect(isExternalSession(undefined)).toBe(false);
    expect(isExternalSession('')).toBe(false);
  });

  it('names MCP and keeps unknown channels generic', () => {
    expect(externalChannelKey('mcp')).toBe('session.external.mcp');
    expect(externalChannelKey('acp')).toBe('session.external');
  });
});
