/**
 * `apps/daemon` — the project's HTTP surface (`protocol.md` §5).
 *
 * The daemon only assembles Core: it owns the listener, authentication and the HTTP
 * shapes, and never business state. WP-03 wires the artifact/attachment endpoints and
 * `conversation.message.send`; the BFF/WS pages and the Runner transport arrive with
 * later work packages.
 */
export * from './server.js';
