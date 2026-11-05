# Long-idle reconnect transcript order — 2026-11-02

## Goal

After a long-idle page reconnects (stream resync), messages already on screen must keep their chronological order. A reconnect must not move older history behind the new snapshot tail, which makes the transcript look as if the newest messages disappeared.

## Cause

`session.stream.prepare` sends only the newest 100 messages. `mergeMessages` treated every current entry the new snapshot did not carry as a live tail and appended it after the snapshot. Once the history advanced beyond that tail, the page's older messages were appended last; the autoscroll following the bottom then showed old content while the newest messages were above it. The previous fixes (C17/C18) removed duplicate live frames but did not order non-snapshot history.

## Change

- `webapp/src/state/slot.ts`: merge classifies by the entry timestamp against the snapshot range, and falls back to the current array's position relative to shared entry ids. Earlier entries go before the snapshot; only entries after the snapshot go after it. With no shared ids, entries are treated as older.
- `webapp/src/state/normalize.ts`: carry timestamps through the normalization boundary.
- `src/server/stream-methods.ts`: include each history record's timestamp in the snapshot.
- `webapp/test/slot.test.ts`: regression for an advanced snapshot tail, and for a no-overlap reconnect where an old live completion must stay before newer history.

## Acceptance

- A resync whose 100-message tail no longer contains the page's first shown messages keeps the old messages before the new tail.
- A resync with no shared ids uses timestamps: an old live completion goes before newer history; a genuinely newer live completion stays after older history.
- Existing duplicate/live-twin tests stay green; webapp typecheck and build pass; server typecheck and stream tests pass.

## Out of scope

- Changing the 100-message snapshot size or adding client persistence across a real page reload.
- Changing connection retry behavior or the server's event hub.
