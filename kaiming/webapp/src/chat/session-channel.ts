/**
 * An externally-owned session is one an MCP client uses (`channel: 'mcp'`), not a conversation the
 * user started. The rail marks it instead of presenting it as a stranger's chat.
 */
export function isExternalSession(channel: string | null | undefined): boolean {
  return channel !== null && channel !== undefined && channel !== '' && channel !== 'web';
}

/** The i18n key naming that channel; unknown channels keep a generic label. */
export function externalChannelKey(channel: string): 'session.external.mcp' | 'session.external' {
  return channel === 'mcp' ? 'session.external.mcp' : 'session.external';
}
