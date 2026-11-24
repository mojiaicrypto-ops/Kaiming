import { describe, expect, it } from 'vitest';
import { reminderEvents, type ReminderSnapshot } from '../src/state/reminders';

const snapshot = (
  busy: ReminderSnapshot['busy'],
  pending: readonly string[],
  sessionId = 's-1',
  inputErrorId: string | null = null,
  settling = false,
  terminalStatus: ReminderSnapshot['terminalStatus'] = 'completed',
): ReminderSnapshot => ({
  sessionId,
  busy,
  pending: new Set(pending),
  inputErrorId,
  settling,
  terminalStatus,
});

describe('session reminder transitions', () => {
  it('announces a completed processing turn', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', []))).toEqual([
      { kind: 'turn-complete' },
    ]);
  });

  it('does not announce a failed turn as a completion', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', [], 's-1', 'i-1'))).toEqual([]);
  });

  it('does not treat a stopped or failed terminal as a completion', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', [], 's-1', null, false, 'stopped'))).toEqual([]);
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', [], 's-1', null, false, 'failed'))).toEqual([]);
  });

  it('waits for the terminal input frame before announcing completion', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', [], 's-1', null, true))).toEqual([]);
    expect(
      reminderEvents(
        snapshot('idle', [], 's-1', null, true),
        snapshot('idle', [], 's-1', null, false),
      ),
    ).toEqual([{ kind: 'turn-complete' }]);
  });

  it('does not treat a new run, a canceled queue, or a user stop as completion', () => {
    expect(reminderEvents(snapshot('idle', []), snapshot('processing', []))).toEqual([]);
    expect(reminderEvents(snapshot('queued', []), snapshot('idle', []))).toEqual([]);
    expect(reminderEvents(snapshot('stopping', []), snapshot('idle', []))).toEqual([]);
  });

  it('announces only newly waiting questions and coalesces them', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('processing', ['q-1']))).toEqual([
      { kind: 'question', count: 1 },
    ]);
    expect(
      reminderEvents(snapshot('processing', ['q-1']), snapshot('processing', ['q-1', 'q-2', 'q-3'])),
    ).toEqual([{ kind: 'question', count: 2 }]);
    expect(reminderEvents(snapshot('idle', ['q-1']), snapshot('idle', ['q-1']))).toEqual([]);
  });

  it('prefers the question over a completion that ends on the question', () => {
    expect(reminderEvents(snapshot('processing', []), snapshot('idle', ['q-1']))).toEqual([
      { kind: 'question', count: 1 },
    ]);
  });

  it('does not call a turn complete while any question still waits', () => {
    expect(reminderEvents(snapshot('processing', ['q-1']), snapshot('idle', ['q-1']))).toEqual([]);
  });

  it('announces completion after the waiting question is answered', () => {
    expect(reminderEvents(snapshot('processing', ['q-1']), snapshot('idle', []))).toEqual([
      { kind: 'turn-complete' },
    ]);
  });

  it('starts over when the session changes', () => {
    expect(
      reminderEvents(snapshot('processing', [], 's-1'), snapshot('idle', ['q-1'], 's-2')),
    ).toEqual([]);
  });
});
