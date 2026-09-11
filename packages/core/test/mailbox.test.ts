import { describe, expect, it } from 'vitest';
import { ProjectMailbox, type MailboxDiagnostic } from '../src/index.js';

/**
 * Mailbox semantics: AC-056 (a command is admitted and answered while a long
 * operation is in flight) and AC-059 admission (queue items/bytes produce BUSY).
 */
function makeMailbox(
  options: { queueItems?: number; queueBytes?: number; slowCommandMs?: number } = {},
) {
  const diagnostics: MailboxDiagnostic[] = [];
  const mailbox = new ProjectMailbox({
    limits: { slowCommandMs: 100, ...options },
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { mailbox, diagnostics };
}

describe('ProjectMailbox', () => {
  it('runs commands one at a time in submission order', async () => {
    const { mailbox } = makeMailbox();
    const events: string[] = [];
    let concurrent = 0;
    let peak = 0;

    const admissions = ['a', 'b', 'c'].map((label) =>
      mailbox.submitCommand({
        subject: 'user:1',
        operation: 'work.pause',
        run: () => {
          concurrent += 1;
          peak = Math.max(peak, concurrent);
          events.push(`start:${label}`);
          events.push(`end:${label}`);
          concurrent -= 1;
          return label;
        },
      }),
    );

    for (const admission of admissions) expect(admission.accepted).toBe(true);
    const completions = admissions.map((admission) => {
      if (!admission.accepted) throw new Error('expected every command to be admitted');
      return admission.completion;
    });
    const results = await Promise.all(completions);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(peak).toBe(1);
    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
    expect(mailbox.stats().processed).toBe(3);
    expect(mailbox.stats().queueItems).toBe(0);
  });

  it('answers a new command while a long effect is still running (AC-056)', async () => {
    const { mailbox } = makeMailbox();
    let releaseEffect: (() => void) | undefined;
    const effect = mailbox.runEffect({
      label: 'model.call',
      run: () =>
        new Promise<void>((resolve) => {
          releaseEffect = resolve;
        }),
    });
    await Promise.resolve();
    expect(mailbox.activeEffects()).toEqual(['model.call']);

    const started = Date.now();
    const admission = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'work.cancel',
      run: () => 'cancelled',
    });
    expect(admission.accepted).toBe(true);
    const result = admission.accepted ? await admission.completion : undefined;
    const elapsed = Date.now() - started;

    expect(result).toBe('cancelled');
    expect(elapsed).toBeLessThan(1000);
    // The long call is still in flight, so the command did not queue behind it.
    expect(mailbox.activeEffects()).toEqual(['model.call']);

    // A second command also passes straight through.
    const second = mailbox.submitCommand({
      subject: 'user:2',
      operation: 'message.received',
      run: () => 2,
    });
    expect(second.accepted && (await second.completion)).toBe(2);

    releaseEffect?.();
    await effect;
    expect(mailbox.activeEffects()).toEqual([]);
  });

  it('rejects with BUSY when the queue is full, before the command runs', async () => {
    const { mailbox, diagnostics } = makeMailbox({ queueItems: 2 });
    const admissions = [1, 2, 3].map((n) =>
      mailbox.submitCommand({ subject: 'user:1', operation: `op.${n}`, run: () => n }),
    );
    expect(admissions[0]?.accepted).toBe(true);
    expect(admissions[1]?.accepted).toBe(true);
    expect(admissions[2]).toMatchObject({
      accepted: false,
      code: 'BUSY',
      reason: 'QUEUE_ITEMS',
      queueItems: 2,
    });
    expect(mailbox.stats().rejected).toBe(1);
    expect(diagnostics.map((entry) => entry.code)).toContain('COMMAND_REJECTED');

    await mailbox.drain();
    expect(mailbox.stats().processed).toBe(2);
  });

  it('rejects with BUSY when the queued payloads exceed the byte limit', async () => {
    const { mailbox } = makeMailbox({ queueBytes: 100 });
    const first = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'blob.upload',
      bytes: 80,
      run: () => 'ok',
    });
    const second = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'blob.upload',
      bytes: 40,
      run: () => 'ok',
    });
    expect(first.accepted).toBe(true);
    expect(second).toMatchObject({ accepted: false, code: 'BUSY', reason: 'QUEUE_BYTES' });
    await mailbox.drain();
  });

  it('accepts again once the queue drained, and refuses after close', async () => {
    const { mailbox } = makeMailbox({ queueItems: 1 });
    const first = mailbox.submitCommand({ subject: 'user:1', operation: 'op', run: () => 1 });
    expect(first.accepted).toBe(true);
    expect(
      mailbox.submitCommand({ subject: 'user:1', operation: 'op', run: () => 2 }).accepted,
    ).toBe(false);
    await mailbox.drain();
    const second = mailbox.submitCommand({ subject: 'user:1', operation: 'op', run: () => 2 });
    expect(second.accepted).toBe(true);
    if (!second.accepted) throw new Error('expected the command to be admitted');
    expect(await second.completion).toBe(2);

    await mailbox.close();
    expect(
      mailbox.submitCommand({ subject: 'user:1', operation: 'op', run: () => 3 }),
    ).toMatchObject({ accepted: false, code: 'BUSY', reason: 'CLOSED' });
  });

  it('records a diagnostic for a transaction slower than 100ms', async () => {
    let clock = 0;
    const diagnostics: MailboxDiagnostic[] = [];
    const mailbox = new ProjectMailbox({
      now: () => {
        clock += 150;
        return clock;
      },
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const admission = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'work.pause',
      run: () => 1,
    });
    expect(admission.accepted).toBe(true);
    await mailbox.drain();

    const slow = diagnostics.filter((entry) => entry.code === 'SLOW_COMMAND');
    expect(slow).toHaveLength(1);
    expect(slow[0]?.operation).toBe('work.pause');
    expect(slow[0]?.durationMs).toBeGreaterThan(100);
  });

  it('rejects a failed command without stopping the queue', async () => {
    const { mailbox } = makeMailbox();
    const failing = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'work.start',
      run: () => {
        throw new Error('handler failed');
      },
    });
    const following = mailbox.submitCommand({
      subject: 'user:1',
      operation: 'work.get',
      run: () => 'ok',
    });

    await expect(failing.accepted ? failing.completion : undefined).rejects.toThrow(
      'handler failed',
    );
    expect(following.accepted && (await following.completion)).toBe('ok');
    expect(mailbox.stats().processed).toBe(2);
  });

  it('reports effect failures as diagnostics and keeps the queue usable', async () => {
    const { mailbox, diagnostics } = makeMailbox();
    await expect(
      mailbox.runEffect({
        label: 'shell.exec',
        run: () => Promise.reject(new Error('boom')),
      }),
    ).rejects.toThrow('boom');
    expect(diagnostics.map((entry) => entry.code)).toEqual(['EFFECT_STARTED', 'EFFECT_FAILED']);
    expect(mailbox.activeEffects()).toEqual([]);
    expect(mailbox.stats().activeEffects).toBe(0);
  });
});
