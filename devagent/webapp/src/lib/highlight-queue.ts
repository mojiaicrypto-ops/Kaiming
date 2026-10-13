/**
 * Highlight budget queue. Ported from agegr/pi-web `lib/highlight-queue.ts` (MIT) —
 * see ported/PORTED.md. Tokenizing every fence in one render task freezes the frame that
 * shows a finished reply; within a task the first budget of characters highlights at once,
 * the rest render uncolored first and get colors one fence per idle slice, newest first.
 */
const HIGHLIGHT_TASK_BUDGET = 2_000;
const FALLBACK_IDLE_DELAY_MS = 50;

let taskBudget = HIGHLIGHT_TASK_BUDGET;
let budgetResetQueued = false;
const waiting: Array<() => void> = [];
let releaseQueued = false;

/** True when a fence of `chars` characters may be highlighted in this task. */
export function takeHighlightBudget(chars: number): boolean {
  if (!budgetResetQueued) {
    budgetResetQueued = true;
    setTimeout(() => {
      taskBudget = HIGHLIGHT_TASK_BUDGET;
      budgetResetQueued = false;
    }, 0);
  }
  if (chars > taskBudget) return false;
  taskBudget -= chars;
  return true;
}

function whenIdle(run: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 500 });
  } else {
    setTimeout(run, FALLBACK_IDLE_DELAY_MS);
  }
}

function releaseNewest(): void {
  releaseQueued = false;
  waiting.pop()?.();
  if (waiting.length > 0) queueRelease();
}

function queueRelease(): void {
  if (releaseQueued) return;
  releaseQueued = true;
  whenIdle(releaseNewest);
}

/**
 * Calls `show` in a later idle slice, one waiting fence per slice. Returns a cancel.
 * Falls back to a timeout when requestIdleCallback is missing (and when it never fires,
 * e.g. automation browsers without a compositor): the fallback also acts as the render
 * path so content is never stuck unhighlighted *and unrendered*.
 */
export function waitForHighlight(show: () => void): () => void {
  waiting.push(show);
  queueRelease();
  return () => {
    const index = waiting.indexOf(show);
    if (index !== -1) waiting.splice(index, 1);
  };
}
