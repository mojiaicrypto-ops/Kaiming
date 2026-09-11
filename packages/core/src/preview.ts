/**
 * HTML preview isolation and one-shot downloads (`execution.md` §6, AC-052).
 *
 * A preview is an untrusted document: it runs inside a sandboxed iframe with scripts
 * only, under `default-src 'none'`, without the workbench cookie and without a
 * network. The policy is expressed as response headers here so the HTTP layer cannot
 * accidentally serve a preview with a weaker one.
 */
import { randomBytes } from 'node:crypto';
import { ARTIFACT_LIMITS, type Artifact, type ArtifactKind } from '@agentdev/contracts';
import { ProtocolError } from './errors.js';

/** `execution.md` §6: scripts only — no same-origin, forms, navigation or popups. */
export const PREVIEW_SANDBOX = 'allow-scripts';

/**
 * `execution.md` §6: static HTML, inline script/style, data images, no network.
 *
 * The `sandbox allow-scripts` directive repeats the iframe attribute in the response
 * itself, so a preview opened as a top-level document is still isolated and a client
 * that omits the custom header cannot weaken the policy (W3 review, adversarial 4).
 */
export const PREVIEW_CSP =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; " +
  "frame-ancestors 'self'";

/** Mimes that may be rendered as HTML in a preview. */
export const HTML_PREVIEW_MIMES = ['text/html', 'application/xhtml+xml'] as const;

export interface PreviewHeaders {
  readonly 'content-security-policy': string;
  readonly 'content-type': string;
  /** The client puts the body into an iframe with exactly this sandbox attribute. */
  readonly 'x-agentdev-preview-sandbox': string;
  /** A preview never reads or sets the workbench session cookie. */
  readonly 'x-agentdev-preview-credentials': 'omit';
  readonly 'cache-control': 'no-store';
  readonly 'x-content-type-options': 'nosniff';
  /** `inline` or `truncated`; a truncated body must offer the download entry. */
  readonly 'x-agentdev-preview-mode'?: 'inline' | 'truncated';
  readonly 'x-agentdev-preview-download-required'?: 'true' | 'false';
  readonly 'x-agentdev-preview-truncated-at-line'?: string;
}

/** The isolation headers for one artifact mime. */
export function previewHeaders(mime: string): PreviewHeaders {
  return {
    'content-security-policy': PREVIEW_CSP,
    'content-type': mime.trim().toLowerCase(),
    'x-agentdev-preview-sandbox': PREVIEW_SANDBOX,
    'x-agentdev-preview-credentials': 'omit',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

export interface PreviewBody {
  readonly mode: 'inline' | 'truncated';
  readonly text: string;
  readonly lines: number;
  readonly truncatedAtLine: number | null;
  readonly downloadRequired: boolean;
}

/**
 * Renders one text-ish artifact for inline preview.
 *
 * `experience.md` §3: a single inline preview is at most 1 MiB or 2000 lines; past
 * that the client shows the truncation and offers the full download.
 */
export function renderPreview(
  artifact: Pick<Artifact, 'kind' | 'mime' | 'bytes'>,
  content: Uint8Array,
): PreviewBody {
  const overBytes = content.byteLength > ARTIFACT_LIMITS.inlinePreviewMaxBytes;
  if (!overBytes) {
    const text = Buffer.from(content).toString('utf8');
    const allLines = text.split('\n');
    if (allLines.length <= ARTIFACT_LIMITS.inlinePreviewMaxLines) {
      return {
        mode: 'inline',
        text,
        lines: allLines.length,
        truncatedAtLine: null,
        downloadRequired: false,
      };
    }
    const kept = allLines.slice(0, ARTIFACT_LIMITS.inlinePreviewMaxLines).join('\n');
    return {
      mode: 'truncated',
      text: clipToBytes(kept, ARTIFACT_LIMITS.inlinePreviewMaxBytes),
      lines: ARTIFACT_LIMITS.inlinePreviewMaxLines,
      truncatedAtLine: ARTIFACT_LIMITS.inlinePreviewMaxLines,
      downloadRequired: true,
    };
  }
  // An oversized artifact is clipped *before* decoding every byte: a 20 MiB upload
  // must not be materialised as a 180 MB string just to return 2 KB of preview
  // (W3R2 review).
  const window = clipBytes(content, ARTIFACT_LIMITS.inlinePreviewMaxBytes);
  const text = Buffer.from(window).toString('utf8');
  const allLines = text.split('\n');
  const kept =
    allLines.length <= ARTIFACT_LIMITS.inlinePreviewMaxLines
      ? text
      : allLines.slice(0, ARTIFACT_LIMITS.inlinePreviewMaxLines).join('\n');
  const clipped = clipToBytes(kept, ARTIFACT_LIMITS.inlinePreviewMaxBytes);
  return {
    mode: 'truncated',
    text: clipped,
    lines: clipped.split('\n').length,
    truncatedAtLine:
      allLines.length > ARTIFACT_LIMITS.inlinePreviewMaxLines
        ? ARTIFACT_LIMITS.inlinePreviewMaxLines
        : null,
    downloadRequired: true,
  };
}

/** UTF-8 safe byte truncation of raw bytes. */
function clipBytes(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && (bytes[end] ?? 0) >= 0x80 && (bytes[end] ?? 0) < 0xc0) end -= 1;
  return bytes.subarray(0, end);
}

/** UTF-8 safe truncation to a byte ceiling. */
function clipToBytes(text: string, maxBytes: number): string {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;
  let end = maxBytes;
  // Never split a multi-byte character: back up over continuation bytes.
  while (end > 0 && (buffer[end] ?? 0) >= 0x80 && (buffer[end] ?? 0) < 0xc0) end -= 1;
  return buffer.subarray(0, end).toString('utf8');
}

/** True when a preview must refuse to inline the artifact body. */
export function requiresDownload(artifact: Pick<Artifact, 'kind' | 'bytes' | 'mime'>): boolean {
  return artifact.bytes > ARTIFACT_LIMITS.inlinePreviewMaxBytes;
}

export interface DownloadGrant {
  readonly token: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly expiresAt: string;
}

/**
 * 60-second, single-use download tokens (`execution.md` §6, `protocol.md` §5).
 *
 * The token is the only way to fetch bytes without a workbench session, so it is
 * consumed exactly once and expires quickly; a second use is a 403 at the HTTP layer.
 */
export class DownloadTokenStore {
  private readonly grants = new Map<string, DownloadGrant>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly newToken: () => string;

  constructor(
    options: {
      readonly now?: () => number;
      readonly ttlMs?: number;
      readonly newToken?: () => string;
    } = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? ARTIFACT_LIMITS.downloadTokenTtlSec * 1000;
    // A 256-bit random token: guessing one must be infeasible, not merely unlikely
    // (W3-01: the previous counter shape was predictable).
    this.newToken = options.newToken ?? (() => randomBytes(32).toString('base64url'));
  }

  issue(artifact: Pick<Artifact, 'id' | 'artifactVersion'>): DownloadGrant {
    const before = this.now();
    const token = this.newToken();
    const grant: DownloadGrant = {
      token,
      artifactId: artifact.id,
      artifactVersion: artifact.artifactVersion,
      expiresAt: new Date(before + this.ttlMs).toISOString(),
    };
    this.grants.set(token, grant);
    return grant;
  }

  /** Consumes a token exactly once; `undefined` means unknown, used or expired. */
  consume(token: string): DownloadGrant | undefined {
    const grant = this.grants.get(token);
    if (grant === undefined) return undefined;
    this.grants.delete(token);
    if (Date.parse(grant.expiresAt) <= this.now()) return undefined;
    return grant;
  }

  /** Drops expired grants that were never consumed. */
  prune(): number {
    const before = this.now();
    let removed = 0;
    for (const [token, grant] of this.grants) {
      if (Date.parse(grant.expiresAt) > before) continue;
      this.grants.delete(token);
      removed += 1;
    }
    return removed;
  }
}

/** Artifact kinds that may be previewed as HTML at all. */
export function isHtmlPreview(mime: string): boolean {
  return (HTML_PREVIEW_MIMES as readonly string[]).includes(mime.trim().toLowerCase());
}

/** Refuses a preview request whose artifact kind has no renderer. */
export function assertPreviewable(kind: ArtifactKind, mime: string): void {
  if (!isHtmlPreview(mime) && !mime.startsWith('text/') && mime !== 'application/json') {
    throw new ProtocolError('VALIDATION_ERROR', `artifact kind ${kind} has no inline preview`, {
      details: { kind, mime },
    });
  }
}
