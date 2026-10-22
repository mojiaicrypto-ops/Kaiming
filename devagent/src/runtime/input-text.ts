/**
 * Text of a stored input payload. One definition, used by the runner (what it sends to Pi) and by
 * the read surface (a session's title): two copies would let a title and a prompt disagree about
 * what the user actually wrote.
 */
export function textOfPayload(payload: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('content' in parsed)) {
    return undefined;
  }
  const content = parsed.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null || !('type' in part)) {
      return undefined;
    }
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string') {
      parts.push(part.text);
      continue;
    }
    return undefined;
  }
  return parts.join('\n');
}
