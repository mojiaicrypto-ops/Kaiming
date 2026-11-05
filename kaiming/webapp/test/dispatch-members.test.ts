import { describe, expect, it } from 'vitest';
import { membersForDispatch } from '../src/chat/transcript-model';

const members = [
  { sessionId: 's-a', label: 'a' },
  { sessionId: 's-b', label: 'b' },
  { sessionId: 's-c', label: 'c' },
];

describe('which members a dispatch card shows', () => {
  it('lists only the members that call named', () => {
    const parsed = { op: 'dispatch', sessions: [{ sessionId: 's-a' }, { sessionId: 's-c' }, { roleId: 'designer' }] };
    expect(membersForDispatch(members, parsed, true)?.map((m) => m.sessionId)).toEqual(['s-a', 's-c']);
  });

  it('keeps a member that has since left the Task instead of dropping the row', () => {
    // The call named s-gone, which is no longer in the Task's live membership: the card still owes
    // that row (it was part of this dispatch), and an empty row list would rewrite history.
    const parsed = { op: 'dispatch', sessions: [{ sessionId: 's-gone' }] };
    expect(membersForDispatch(members, parsed, true)).toEqual([]);
  });

  it('gives the live membership to the newest dispatch only', () => {
    const resume = { op: 'dispatch', waitTimeoutMs: 1000 };
    expect(membersForDispatch(members, resume, true)).toBe(members);
    expect(membersForDispatch(members, resume, false)).toBeUndefined();
  });

  it('inherits the running step, not every member the Task ever had', () => {
    const resume = { op: 'dispatch', waitTimeoutMs: 1000 };
    const live = new Set(['s-b']);
    expect(membersForDispatch(members, resume, true, live)?.map((m) => m.sessionId)).toEqual(['s-b']);
    // A named call is unaffected: it shows who it dispatched, live or not.
    const named = { op: 'dispatch', sessions: [{ sessionId: 's-a' }, { sessionId: 's-c' }] };
    expect(membersForDispatch(members, named, true, live)?.map((m) => m.sessionId)).toEqual(['s-a', 's-c']);
  });

  it('has nothing to show when there is no membership and no call', () => {
    expect(membersForDispatch(undefined, null, true)).toBeUndefined();
    expect(membersForDispatch([], { op: 'dispatch' }, true)).toEqual([]);
  });
});
