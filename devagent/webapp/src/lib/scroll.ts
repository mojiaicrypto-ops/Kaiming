/**
 * Auto-scroll follow with lock semantics. Ported behavior from versot/pi-web
 * `packages/ui-hooks/src/use-autoscroll.ts` (MIT, © 2026 versot) and agegr/pi-web
 * `lib/chat-scroll-position.ts` (MIT) — reimplemented framework-free; see ported/PORTED.md.
 *
 * One upward user scroll locks ALL auto-scrolling off; it unlocks only when the user returns
 * to the bottom. Programmatic scrolling is flagged so it never resets the lock.
 */
export interface AutoscrollHandle {
  readonly locked: boolean;
  readonly showJumpButton: boolean;
  onUserScroll(): void;
  /** Called after the DOM grew because of streaming. */
  followIfUnlocked(): void;
  /** Explicit jump-to-bottom (user action): always scrolls and unlocks. */
  jumpToBottom(): void;
  /** Mark that the next scroll event is ours. */
  beginProgrammatic(): void;
}

export function createAutoscroll(container: HTMLElement, onChange: (state: { locked: boolean; showJumpButton: boolean }) => void): AutoscrollHandle {
  let locked = false;
  let showJumpButton = false;
  let programmatic = false;
  let lastScrollTop = container.scrollTop;

  const emit = (): void => {
    onChange({ locked, showJumpButton });
  };

  const nearBottom = (): boolean =>
    container.scrollHeight - container.scrollTop - container.clientHeight < 60;

  container.addEventListener('scroll', () => {
    const atTail = nearBottom();
    showJumpButton = !atTail && container.scrollHeight > container.clientHeight;
    if (!programmatic) {
      const goingUp = container.scrollTop < lastScrollTop;
      if (goingUp) locked = true;
      else if (atTail) locked = false;
    }
    lastScrollTop = container.scrollTop;
    emit();
  }, { passive: true });

  // Streaming growth and image loads change scrollHeight without a user scroll.
  const observer = new ResizeObserver(() => {
    const atTail = nearBottom();
    showJumpButton = !atTail && container.scrollHeight > container.clientHeight;
    emit();
  });
  for (const child of container.children) observer.observe(child);
  observer.observe(container);

  return {
    get locked() { return locked; },
    get showJumpButton() { return showJumpButton; },
    onUserScroll() { /* reserved: explicit user intent from buttons */ },
    followIfUnlocked() {
      if (locked) return;
      programmatic = true;
      container.scrollTop = container.scrollHeight;
      lastScrollTop = container.scrollTop;
      programmatic = false;
      showJumpButton = false;
      emit();
    },
    jumpToBottom() {
      locked = false;
      programmatic = true;
      container.scrollTop = container.scrollHeight;
      lastScrollTop = container.scrollTop;
      programmatic = false;
      showJumpButton = false;
      emit();
    },
    beginProgrammatic() {
      programmatic = true;
    },
  };
}
