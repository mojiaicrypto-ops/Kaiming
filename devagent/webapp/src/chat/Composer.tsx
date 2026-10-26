import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { useTier } from '../layout/useTier';
import type { SessionActivity } from '../api/stream';

/** How many images one message may carry (the server refuses more). */
const MAX_IMAGES = 6;

/** An image already uploaded and stored by the server: only its id travels with the message. */
export interface PendingImage {
  readonly id: string;
  readonly url: string;
  readonly name: string;
}

export interface ComposerProps {
  readonly busy: SessionActivity;
  readonly canStop: boolean;
  readonly disabled: boolean;
  readonly onSubmit: (text: string, images: readonly string[]) => Promise<void>;
  /**
   * Uploads one image and returns its stored id. Separate from submit because the bytes are sent
   * once, immediately, and the message only carries the reference.
   */
  readonly onUpload: (file: File) => Promise<{ id: string; url: string }>;
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
 * Images are attached the same way they are delivered: the file goes to the server first, the
 * preview shows the stored copy, and the message carries the attachment ids.
 */
export function Composer({ busy, canStop, disabled, onSubmit, onUpload, onStop, seed, onSeed, onReleaseSight }: ComposerProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<readonly PendingImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A ref, not just the state: two Enter presses can arrive in the same task, before React has
  // re-rendered with `sending: true`, and both would then pass the guard.
  const inFlight = useRef(false);
  const [stopFailed, setStopFailed] = useState(false);
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

  const addFiles = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (images.length >= MAX_IMAGES) {
          setUploadError(t('chat.attach.limit', { count: MAX_IMAGES }));
          break;
        }
        try {
          const stored = await onUpload(file);
          setImages((current) =>
            current.length >= MAX_IMAGES
              ? current
              : [...current, { id: stored.id, url: stored.url, name: file.name }],
          );
        } catch (error) {
          // The reason the server gave (wrong type, too large) is the useful part.
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
    if ((text === '' && images.length === 0) || inFlight.current || disabled) return;
    inFlight.current = true;
    setSending(true);
    try {
      await onSubmit(text, images.map((image) => image.id));
      setDraft('');
      setImages([]);
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
        {images.length > 0 && (
          <div className="composer-attachments" data-testid="attachments">
            {images.map((image) => (
              <span key={image.id} className="composer-thumb">
                <img src={image.url} alt={image.name} />
                <button
                  type="button"
                  title={t('chat.attach.remove')}
                  onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
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
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => void addFiles(event.target.files)}
        data-testid="attach-input"
      />
      <button
        type="button"
        className="send"
        title={t('chat.attach')}
        disabled={disabled || sending || uploading || images.length >= MAX_IMAGES}
        onClick={() => fileRef.current?.click()}
        data-testid="attach"
      >
        {uploading ? '…' : '＋'}
      </button>
      <button
        type="submit"
        className="send"
        disabled={disabled || sending || uploading || (draft.trim() === '' && images.length === 0)}
        title={t('chat.send')}
      >
        ↑
      </button>
      {busy !== 'idle' && (
        <button
          type="button"
          className={`send${stopFailed ? ' danger' : ''}`}
          title={canStop ? t('chat.stopTitle') : t('chat.hint.stop')}
          onClick={() => {
            clearStopFailure();
            void onStop().catch(() => setStopFailed(true));
          }}
          data-testid="stop"
        >
          {t('chat.stop')}
        </button>
      )}
    </form>
  );
}

export function DockHint({ busy }: { busy: SessionActivity }) {
  const { t } = useI18n();
  return (
    <div className="hint">
      <span>{t('chat.hint.send')}</span>
      {busy !== 'idle' && <State kind="wait">{t('chat.hint.stop')}</State>}
    </div>
  );
}
