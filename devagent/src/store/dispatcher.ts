/**
 * Round-robin dispatcher (P1): picks the next session that can actually run, one input at a time.
 *
 * It only reads state through the store: a session with a run in flight is skipped, a session with
 * an unverified interrupted input is reported so the host can start recovery, and rotation keeps
 * several ready sessions from starving each other.
 */
import { Store, type InputRow } from './store.ts';

export type DispatchOutcome =
  | { readonly kind: 'claimed'; readonly sessionId: string; readonly input: InputRow }
  | { readonly kind: 'blocked'; readonly sessionId: string; readonly inputId: string; readonly code: 'RECOVERY_REQUIRED' }
  | { readonly kind: 'idle' };

export class Dispatcher {
  private readonly store: Store;
  private cursor = 0;

  constructor(store: Store) {
    this.store = store;
  }

  nextClaim(): DispatchOutcome {
    const sessionIds = this.store.listSessions().map((session) => session.id);
    if (sessionIds.length === 0) {
      return { kind: 'idle' };
    }
    let blocked: Extract<DispatchOutcome, { kind: 'blocked' }> | undefined;
    for (let step = 0; step < sessionIds.length; step += 1) {
      const index = (this.cursor + step) % sessionIds.length;
      const sessionId = sessionIds[index];
      if (sessionId === undefined) {
        continue;
      }
      const claim = this.store.claimNextInput(sessionId);
      if (claim.kind === 'claimed') {
        this.cursor = (index + 1) % sessionIds.length;
        return { kind: 'claimed', sessionId, input: claim.input };
      }
      // A session awaiting recovery must not stop other ready sessions from running; it is
      // reported only when nothing else could be claimed in this pass.
      if (claim.kind === 'blocked' && blocked === undefined) {
        blocked = { kind: 'blocked', sessionId, inputId: claim.inputId, code: claim.code };
      }
    }
    if (blocked !== undefined) {
      // Advance so the next pass surfaces the next session awaiting recovery instead of
      // reporting the same one forever.
      const blockedIndex = sessionIds.indexOf(blocked.sessionId);
      this.cursor = (blockedIndex + 1) % sessionIds.length;
    }
    return blocked ?? { kind: 'idle' };
  }

  /**
   * Drain everything currently claimable, in rotation order. A session awaiting recovery is
   * reported once alongside whatever else could be claimed, and does not end the pass.
   */
  drain(limit = 100): DispatchOutcome[] {
    const outcomes: DispatchOutcome[] = [];
    const blockedReported = new Set<string>();
    for (let step = 0; step < limit; step += 1) {
      const outcome = this.nextClaim();
      if (outcome.kind === 'idle') {
        break;
      }
      if (outcome.kind === 'blocked') {
        if (blockedReported.has(outcome.sessionId)) {
          break; // nothing progressed since this session was reported
        }
        blockedReported.add(outcome.sessionId);
        outcomes.push(outcome);
        continue;
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }
}