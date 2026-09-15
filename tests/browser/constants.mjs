/**
 * Shared constants for the real-browser drill (WP-12 T7a).
 *
 * Kept in its own module so a spec can import the preview marker without loading the
 * stack bootstrap (`stack-runtime.mjs`) into the worker process.
 */

/** The marker the seeded HTML preview renders, so the frame's real body is checkable. */
export const PREVIEW_MARKER = 'AGENTDEV-PREVIEW-MARKER';

/**
 * A secret-looking marker written into the seeded project's refused `.env` (WP-12 W2).
 *
 * The sensitive-file todo must never carry or render the refused file's content, so the
 * Inbox spec asserts this string appears nowhere on the page.
 */
export const SENSITIVE_FILE_MARKER = 'AGENTDEV-BROWSER-SECRET-MARKER';
