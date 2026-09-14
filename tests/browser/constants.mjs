/**
 * Shared constants for the real-browser drill (WP-12 T7a).
 *
 * Kept in its own module so a spec can import the preview marker without loading the
 * stack bootstrap (`stack-runtime.mjs`) into the worker process.
 */

/** The marker the seeded HTML preview renders, so the frame's real body is checkable. */
export const PREVIEW_MARKER = 'AGENTDEV-PREVIEW-MARKER';
