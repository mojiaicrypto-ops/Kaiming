import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { useTier } from '../layout/useTier';
import type { SessionActivity } from '../api/stream';
import type { UploadedAttachment } from '../api/rpc';

/** How many attachments one message may carry (the server refuses more). */
const MAX_ATTACHMENTS = 6;

const ACCEPT = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/pdf', '.docx', '.pptx', '.xlsx', '.odt', '.ods', '.odp', '.rtf', '.epub',
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.xml',
  '.html', '.css', '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.java', '.go',
  '.rs', '.rb', '.php', '.sh', '.sql', '.toml', '.ini', '.log', '.tex',
].join(',');

/** Files pasted from the clipboard use the same upload path as the picker. */
function filesFromClipboard(data: DataTransfer | null): File[] {
  if (data === null) return [];
  const files: File[] = [];
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index];
    if (item === undefined || item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return files;
}

export interface ComposerProps {
  readonly busy: SessionActivity;
  readonly canStop: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (text: string, attachments: readonly UploadedAttachment[]) => Promise<void>;
  /**
   * Uploads one attachment and returns its stored id. Separate from submit because the bytes are
   * sent once, immediately, and the message only carries the reference.
   */
  readonly onUpload: (file: File) => Promise<UploadedAttachment>;
  /**
   * Text another screen wants said here (the requirement board's "implement"): it is filled in and
   * left for the user to send, and it never replaces text the user already typed.
   */
  readonly seed?: string | null;
  readonly onSeed?: (inserted: boolean) => void;
  readonly onStop: () => Promise<void>;
  /**
   * The user said "follow the output again" (Escape in an empty box). The transcript's own
   * follow is released by scrolling up, and this is the keyboard way back to the tail.
   */
  readonly onReleaseSight?: (() => void) | undefined;
}

/**
 * The input line. Three behaviours are load-bearing and easy to lose in a rewrite:
 *  - Enter sends, Shift+Enter breaks the line, and an IME composition never sends (R11);
 *  - a failed submit puts the text back instead of losing the user's message (R10);
 *  - while the chief runs, STOP targets the current input and says what it keeps (R13/C-stop).
 *
 * Attachments are attached the same way they are delivered: the file goes to the server first,
 * the preview shows the stored copy, and the message carries the attachment ids.
 */
export function Composer({ busy, canStop, disabled, onSubmit, onUpload, onStop, seed, onSeed, onReleaseSight }: ComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<readonly UploadedAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A ref, not just the state: two Enter presses can arrive in the same task, before React has
  // re-rendered with `sending: true`, and both would then pass the guard.
  const inFlight = useRef(false);
  const [stopFailed, setStopFailed] = useState(false);
  // The server only reports `stopping` after it sees the request; the click itself must give
  // immediate feedback while the run settles.
  const [stopping, setStopping] = useState(false);
  // A successful STOP clears the mark: the button should not stay red from an older attempt.
  const clearStopFailure = (): void => setStopFailed(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The composer keeps focus across turns: it is the only place the user types.
  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 560px)').matches) return;
    if (document.activeElement === null || document.activeElement === document.body) areaRef.current?.focus();
  }, [disabled]);

  // The seed is consumed once per value: keeping it in state would refill the box after every send.
  const lastSeed = useRef<string | null>(null);
  useEffect(() => {
    if (seed === null || seed === undefined || seed === lastSeed.current) return;
    // A non-empty box is the user's own words; replacing them would be a silent edit. A refused
    // seed is not remembered, so handing the same request over again (after clearing the box)
    // really inserts it instead of doing nothing.
    const inserted = draft.trim() === '';
    if (inserted) {
      lastSeed.current = seed;
      setDraft(seed);
      areaRef.current?.focus();
    }
    onSeed?.(inserted);
  }, [seed, draft, onSeed]);

  const addFiles = async (files: FileList | readonly File[] | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (attachments.length >= MAX_ATTACHMENTS) {
          setUploadError(t('chat.attach.limit', { count: MAX_ATTACHMENTS }));
          break;
        }
        try {
          const stored = await onUpload(file);
          setAttachments((current) =>
            current.length >= MAX_ATTACHMENTS
              ? current
              : [...current, stored],
          );
        } catch (error) {
          // The reason the server gave (wrong type, too large, unreadable document) is useful.
          setUploadError(t('chat.attach.failed', { reason: error instanceof Error ? error.message : String(error) }));
          break;
        }
      }
    } finally {
      setUploading(false);
      // The same file can be chosen again after a removal.
      if (fileRef.current !== null) fileRef.current.value = '';
    }
  };

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if ((text === '' && attachments.length === 0) || inFlight.current || disabled) return;
    inFlight.current = true;
    setSending(true);
    try {
      await onSubmit(text, attachments);
      setDraft('');
      setAttachments([]);
      setUploadError(null);
    } catch {
      // onSubmit already surfaced the reason; the draft stays so nothing is lost.
    } finally {
      inFlight.current = false;
      setSending(false);
      areaRef.current?.focus();
    }
  };

  // The long prompt explains two key combinations; a phone has neither a Shift key nor the room.
  const tier = useTier();
  const placeholder =
    busy === 'processing'
      ? t('chat.composer.busy')
      : busy === 'queued'
        ? t('chat.composer.queued')
        : tier === 'phone'
          ? t('chat.composer.short')
          : t('chat.composer.placeholder');

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <span className="pr">❯</span>
      <div className="composer-main">
        {attachments.length > 0 && (
          <div className="composer-attachments" data-testid="attachments">
            {attachments.map((attachment) => (
              <span key={attachment.id} className={attachment.kind === 'image' ? 'composer-thumb' : 'composer-file'}>
                {attachment.kind === 'image' ? (
                  <img src={attachment.url} alt={attachment.name} />
                ) : (
                  <>
                    <span className="composer-file-kind">{attachmentKind(attachment)}</span>
                    <span className="composer-file-name">{attachment.name}</span>
                  </>
                )}
                <button
                  type="button"
                  title={t('chat.attach.remove')}
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={2}
          aria-label={t('aria.composer')}
          placeholder={placeholder}
          value={draft}
          disabled={disabled || sending}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const pasted = filesFromClipboard(event.clipboardData);
            if (pasted.length === 0) return;
            // File bytes belong in the attachment tray, not as a broken text paste. A text-only
            // paste is left entirely to the browser.
            event.preventDefault();
            void addFiles(pasted);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
              return;
            }
            // Escape in an empty box is not "cancel the draft" (there is none): it is "put me
            // back at the live output", which is what a reader who scrolled up wants.
            if (event.key === 'Escape' && draft === '' && onReleaseSight !== undefined) {
              event.preventDefault();
              onReleaseSight();
            }
          }}
          data-testid="composer"
        />
        {uploadError !== null && <div className="composer-error">{uploadError}</div>}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => void addFiles(event.target.files)}
        data-testid="attach-input"
      />
      <button
        type="button"
        className="send"
        title={t('chat.attach')}
        disabled={disabled || sending || uploading || attachments.length >= MAX_ATTACHMENTS}
        onClick={() => fileRef.current?.click()}
        data-testid="attach"
      >
        {uploading ? '…' : '＋'}
      </button>
      <button
        type="submit"
        className="send"
        disabled={disabled || sending || uploading || (draft.trim() === '' && attachments.length === 0)}
        title={t('chat.send')}
      >
        ↑
      </button>
      {(busy === 'processing' || busy === 'stopping') && (
        <button
          type="button"
          className={`send${stopFailed ? ' danger' : ''}`}
          title={canStop ? t('chat.stopTitle') : t('chat.hint.stop')}
          disabled={!canStop || stopping || busy === 'stopping'}
          aria-busy={stopping || busy === 'stopping'}
          onClick={() => {
            if (stopping) return;
            clearStopFailure();
            setStopping(true);
            void onStop()
              .catch(() => setStopFailed(true))
              .finally(() => setStopping(false));
          }}
          data-testid="stop"
        >
          {stopping || busy === 'stopping' ? t('chat.stopping') : t('chat.stop')}
        </button>
      )}
    </form>
  );
}

function attachmentKind(attachment: UploadedAttachment): string {
  if (attachment.mimeType === 'application/pdf') return 'PDF';
  const fromName = /\.([A-Za-z0-9]+)$/.exec(attachment.name)?.[1];
  if (fromName !== undefined) return fromName.toUpperCase();
  return 'DOC';
}

export function DockHint({ busy }: { busy: SessionActivity }) {
  const { t } = useI18n();
  return (
    <div className="hint">
      <span>{t('chat.hint.send')}</span>
      {(busy === 'processing' || busy === 'stopping') && <State kind="wait">{t('chat.hint.stop')}</State>}
    </div>
  );
}
