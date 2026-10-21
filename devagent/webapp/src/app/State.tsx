import type { ReactNode } from 'react';

/**
 * The state token: a glyph plus a word, never color alone. The glyph comes from CSS
 * (`.st::before`) so the same word can never be rendered with two different symbols.
 */
export type StateKind = 'run' | 'decide' | 'done' | 'block' | 'idle' | 'paused' | 'wait';

export function State({ kind, children }: { kind: StateKind; children?: ReactNode }) {
  return <span className={`st ${kind}`}>{children}</span>;
}
