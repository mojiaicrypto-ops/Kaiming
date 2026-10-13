# Ported code

All code in `src/ported/` and the modules below are adapted from MIT-licensed projects.
Each entry records the source, artifact, and license.

| Our file | Source | License | Artifact verified 2026-10-14 |
|---|---|---|---|
| `src/lib/highlight-queue.ts` | https://github.com/agegr/pi-web `lib/highlight-queue.ts` | MIT (© agegr) | repo main, fetched 2026-10-14 |
| `src/lib/scroll.ts` (semantics) | `@versot/pi-web` npm package (0.1.11), GUI bundle `gui/assets/*.js` (autoscroll lock semantics + scroll-anchor logic; source repo not public — npm tarball is the citable artifact) + https://github.com/agegr/pi-web `lib/chat-scroll-position.ts` | MIT (© 2026 versot, © agegr) | registry tarball sha256-verified download; LICENSE © versot |
| `src/state/slot.ts` (model) | `@versot/pi-web` npm package (0.1.11), GUI bundle (per-session slot reducer pattern: items/busy/pending/history pagination) | MIT (© 2026 versot) | registry tarball download |

Note: the `versot/pi-web` GitHub repository is not publicly accessible (API/raw 404 on
2026-10-14). The published npm tarball (`@versot/pi-web@0.1.11`, MIT, © 2026 versot,
https://registry.npmjs.org/@versot/pi-web/-/pi-web-0.1.11.tgz) is the provenance artifact;
our port is a semantic re-implementation from the behavioral patterns (slot reducer,
scroll locking), not a line-for-line copy, except where noted.

What was intentionally NOT copied: their React component trees (`ChatWindow.tsx`,
`MessageView.tsx`), their daemon/transport (`lib/agent-event-stream.ts` — our server already
owns snapshot/boundary/resync per `docs/technicalnew/messaging-and-collaboration.md` M4), and
their markdown parser (we keep the vendored `markdown-it` already used and tested by the old
shell, plus the highlight budget queue).
