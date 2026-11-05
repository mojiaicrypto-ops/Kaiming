/**
 * One bounded read of an HTTP body (S7/S6): tools that fetch must not trust `content-length` (a
 * chunked response simply omits it) and must not grow the heap to whatever the far side sends.
 *
 * The reader is cancelled as soon as the cap is crossed, so the connection stops instead of being
 * drained into memory.
 */
export async function readCapped(response: Response, maxBytes: number): Promise<Buffer | undefined> {
  const body = response.body;
  if (body === null) {
    return Buffer.alloc(0);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
