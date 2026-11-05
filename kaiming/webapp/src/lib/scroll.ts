/**
 * Auto-scroll follow with lock semantics. Ported behavior from versot/pi-web
 * `packages/ui-hooks/src/use-autoscroll.ts` (MIT, © 2026 versot) and agegr/pi-web
 * `lib/chat-scroll-position.ts` (MIT) — reimplemented framework-free; see ported/PORTED.md.
 *
 * One upward user scroll locks ALL auto-scrolling off; it unlocks only when the user returns
 * to the bottom. Programmatic scrolling is flagged so it never resets the lock.
 *
 * Follow must be judged by INTENT, never by distance: `scrollTop = scrollHeight` clamps to the
 * last scrollable pixel, and a frame of fast streaming can add more than the near-bottom slack,
 * so a distance test reads "the user scrolled up" after our own follow. While `following` is
 * true the view is pinned; only a scroll event we did not cause can unpin it.
 */
export interface AutoscrollHandle {
  readonly locked: boolean;
  readonly showJumpButton: boolean;
  onUserScroll(): void;
  /** Growth since the reader left the tail (0 while following). */
  readonly unseen: number;
  /** Called after the DOM grew because of streaming. */
  followIfUnlocked(): void;
  /** Explicit jump-to-bottom (user action): always scrolls and unlocks. */
  jumpToBottom(): void;
  /**
   * The user asked to follow the live output (sent a message, pressed Esc in the composer):
   * pin the view to the tail even if they had scrolled up. Their next upward scroll releases it.
   */
  pinToTail(): void;
  /** Mark that the next scroll event is ours. */
  beginProgrammatic(): void;
}

export function createAutoscroll(container: HTMLElement, onChange: (state: { locked: boolean; showJumpButton: boolean }) => void): AutoscrollHandle {
  let locked = false;
  let showJumpButton = false;
  let programmatic = false;
  let lastScrollTop = container.scrollTop;
  /** The user is at the tail and has not scrolled away: every follow re-pins the view. */
  let following = true;
  /** Content height at the moment the user left (or last looked at) the tail. */
  let seenHeight = container.scrollHeight;
  /** A follow is requested for after the DOM commit: React may batch many renders into one. */

  let syncQueued = false;
  /** After an explicit jump, pin until the user leaves the tail. */
  let pin = false;

  const emit = (): void => {
    onChange({ locked, showJumpButton });
  };

  const nearBottom = (): boolean =>
    container.scrollHeight - container.scrollTop - container.clientHeight < 60;

  container.addEventListener('scroll', () => {
    const atTail = nearBottom();
    showJumpButton = !atTail && container.scrollHeight > container.clientHeight;
    if (!programmatic) {
      // Ours-to-ours never lands here, so this is the user's own hand.
      const goingUp = container.scrollTop < lastScrollTop;
      if (goingUp) {
        // Leaving the tail always wins, even against an explicit pin.
        pin = false;
        locked = true;
        following = false;
      } else if (atTail) {
        // Coming back to the tail resumes the follow but does not force it: a user who jumps
        // back with the scrollbar expects the view to stay where they put it.
        locked = false;
        following = true;
      }
    } else if (atTail) {
      following = true;
    }
    lastScrollTop = container.scrollTop;
    emit();
  }, { passive: true });

  // Streaming growth and image loads change scrollHeight without a user scroll.
  const observer = new ResizeObserver(() => {
    // Growth is authoritative: it fires after layout for every commit, including the ones a
    // batched stream update produced.
    if (following || pin) toTail();
    sync();
    const atTail = nearBottom();
    showJumpButton = !atTail && container.scrollHeight > container.clientHeight;
    // Still at the tail: nothing is waiting below the reader, so the counter resets.
    if (atTail) seenHeight = container.scrollHeight;
    emit();
  });
  for (const child of container.children) observer.observe(child);
  observer.observe(container);

  /**
   * Follow what the DOM built. Two moments matter: the layout effect at commit (React has just
   * written the new content, so this is the earliest possible fix) and the callback queued for
   * right after it (the browser has laid out, so this is the exact fix). Both run in the same
   * frame, before paint, so the reader never sees the intermediate position.
   */
  function sync(): void {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      if (!following && !pin) return;
      toTail();
    });
  }

  /** Get to the tail and stay there until the reader scrolls away themselves. */
  function pinToTail(): void {
    locked = false;
    following = true;
    pin = true;
    toTail();
  }

  function toTail(): void {
    programmatic = true;
    container.scrollTop = container.scrollHeight;
    lastScrollTop = container.scrollTop;
    programmatic = false;
    showJumpButton = false;
    emit();
  }

  return {
    get locked() { return locked; },
    get showJumpButton() { return showJumpButton; },
    /** How far the conversation has grown since the reader left the tail, in pixels. */
    get unseen() { return following ? 0 : Math.max(0, container.scrollHeight - seenHeight); },
    onUserScroll() { /* reserved: explicit user intent from buttons */ },
    followIfUnlocked() {
      if (!following && !pin) return;
      toTail();
      sync();
    },
    jumpToBottom: pinToTail,
    pinToTail,
    beginProgrammatic() {
      programmatic = true;
    },
  };
}
