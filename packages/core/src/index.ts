/**
 * `@agentdev/core` — ProjectRuntime: mailbox, dispatch, event hub and auth.
 *
 * WP-01 builds the serial short-command mailbox and the command dispatcher here;
 * the event hub, connection authentication and Project identity follow in the same
 * work package. See `.agentdev/work/WP-01/`.
 */
export * from './errors.js';
export * from './mailbox.js';
export * from './dispatcher.js';
