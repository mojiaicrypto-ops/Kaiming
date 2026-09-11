/**
 * Complete event scans.
 *
 * `EventStore.readAfter` is deliberately paginated (a cursor stream for WS/UI
 * clients). Derived reads such as "how many schema rejections has this Attempt
 * had" or "has this failure already been paged to the Chief" must not silently
 * depend on the first page: a 10k window would eventually make the second
 * non-compliant submission pass as the first (AC-047) and duplicate Chief todos.
 * These helpers page until the log is exhausted.
 */
import type { Event } from '@agentdev/contracts';
import type { ProjectStore } from '@agentdev/storage';

const PAGE_SIZE = 1_000;

export interface ScanOptions {
  readonly names?: readonly string[];
  /** Stops early once the predicate is satisfied — used for existence checks. */
  readonly stopAt?: (event: Event) => boolean;
}

/**
 * Every matching event, oldest first.
 *
 * Pages until an empty page is returned, so the result does not depend on the
 * log length. `ResyncRequiredError` from an over-truncated window is propagated:
 * a caller must never mistake a partial window for "no events".
 */
export function scanEvents(store: ProjectStore, options: ScanOptions = {}): Event[] {
  const names = options.names === undefined ? undefined : [...options.names];
  const found: Event[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.events.readAfter(cursor, {
      limit: PAGE_SIZE,
      ...(names === undefined ? {} : { names }),
    });
    if (page.length === 0) return found;
    for (const event of page) {
      found.push(event);
      if (options.stopAt?.(event) === true) return found;
    }
    cursor = page[page.length - 1]?.cursor ?? cursor;
  }
}

/** The first matching event, or `undefined`. Stops scanning as soon as it is found. */
export function findEvent(store: ProjectStore, options: ScanOptions): Event | undefined {
  const names = options.names === undefined ? undefined : [...options.names];
  let cursor = 0;
  for (;;) {
    const page = store.events.readAfter(cursor, {
      limit: PAGE_SIZE,
      ...(names === undefined ? {} : { names }),
    });
    if (page.length === 0) return undefined;
    for (const event of page) {
      if (options.stopAt?.(event) === true) return event;
    }
    cursor = page[page.length - 1]?.cursor ?? cursor;
  }
}
