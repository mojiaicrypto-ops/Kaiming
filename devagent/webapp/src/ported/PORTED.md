# Ported code

All code in `src/ported/` and the modules below are adapted from MIT-licensed projects.
Each entry records the source repository, files, and commit at the time of copying.

| Our file | Source | License | Commit (fetched 2026-10-14) |
|---|---|---|---|
| `src/lib/highlight-queue.ts` | https://github.com/agegr/pi-web `lib/highlight-queue.ts` | MIT (© agegr) | main |
| `src/lib/scroll.ts` (semantics) | https://github.com/versot/pi-web `packages/ui-hooks/src/use-autoscroll.ts` + https://github.com/agegr/pi-web `lib/chat-scroll-position.ts` | MIT (© versot / © agegr) | main |
| `src/state/slot.ts` (model) | https://github.com/versot/pi-web `packages/ui-hooks/src/session-store.ts` reducer pattern | MIT (© versot) | main |

What was intentionally NOT copied: their React component trees (`ChatWindow.tsx`,
`MessageView.tsx`), their daemon/transport (`lib/agent-event-stream.ts` — our server already
owns snapshot/boundary/resync per `docs/technicalnew/messaging-and-collaboration.md` M4), and
their markdown parser (we keep the vendored `markdown-it` already used and tested by the old
shell, plus the highlight budget queue).
