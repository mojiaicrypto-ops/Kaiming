/**
 * One reading of a stored input payload, used by the runner (what it sends to Pi), by the read
 * surface (a session's title) and by the input validator. Two copies would let a title and a prompt
 * disagree about what the user actually wrote.
 *
 * The payload is small on purpose: an image or document part carries the id of bytes already on
 * disk, never the bytes themselves. Pi receives base64 or extracted text at prompt time; the
 * database never stores either.
 */
export interface DocumentPart {
  readonly id: string;
  readonly name: string;
}

export interface PayloadParts {
  /** Everything the user typed, in order. Empty when the message was attachments only. */
  readonly text: string;
  /** Image attachment ids, in the order they were attached. */
  readonly images: readonly string[];
  /** Document attachment ids and display names, in the order they were attached. */
  readonly documents: readonly DocumentPart[];
}

/** The attachment id of one `{type:'image'|'document'}` block, or undefined when malformed. */
function attachmentIdOf(part: Record<string, unknown>): string | undefined {
  const id = part['attachmentId'];
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * Parse `{content: [{type:'text'|'image'|'document'}...]}`. Anything else (an unknown block, a
 * missing id) makes the whole payload unreadable, so the caller refuses it instead of silently
 * dropping part of it.
 */
export function partsOfPayload(payload: string): PayloadParts | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('content' in parsed)) {
    return undefined;
  }
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const texts: string[] = [];
  const images: string[] = [];
  const documents: DocumentPart[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      return undefined;
    }
    const record = part as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      texts.push(record['text']);
      continue;
    }
    if (record['type'] === 'image') {
      const id = attachmentIdOf(record);
      if (id === undefined) return undefined;
      images.push(id);
      continue;
    }
    if (record['type'] === 'document') {
      const id = attachmentIdOf(record);
      if (id === undefined) return undefined;
      const name = typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : 'document';
      documents.push({ id, name });
      continue;
    }
    return undefined;
  }
  return { text: texts.join('\n'), images, documents };
}

/** Text alone: the title of a session, and the prompt text the runner sends. */
export function textOfPayload(payload: string): string | undefined {
  return partsOfPayload(payload)?.text;
}
