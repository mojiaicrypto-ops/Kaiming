import { describe, expect, it } from 'vitest';
import { RunWatchdogError, runWithWatchdog } from '../src/runtime/run-watchdog.ts';

/** A controllable clock so the windows are exercised without real waiting. */
function fakeClock(): { now: () => number; advance(ms: number): void } {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('run watchdog', () => {
  it('aborts a run that stops producing activity and reports RUN_STALLED', async () => {
    const clock = fakeClock();
    let aborted = 0;
    let activity = clock.now();
    // The run never settles on its own; the watchdog must abort it and stop waiting.
    let settle: (() => void) | null = null;
    const prompt = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running = runWithWatchdog({
      prompt: () => prompt,
      abort: async () => {
        aborted += 1;
        settle?.();
      },
      activityAt: () => activity,
      stallMs: 1_000,
      totalMs: 60_000,
      now: clock.now,
      tickMs: 20,
    });
    // Attach the handler now: the rejection lands before the test reads the result.
    const settled = running.then(() => null).catch((thrown: unknown) => thrown);
    // Real timers drive the checks; advance the fake clock so the window trips.
    await new Promise((resolve) => setTimeout(resolve, 60));
    clock.advance(1_500);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const error = await settled;
    expect(error).toBeInstanceOf(RunWatchdogError);
    expect((error as RunWatchdogError).code).toBe('RUN_STALLED');
    expect(aborted).toBe(1);
    void activity;
  });

  it('aborts a run that exceeds the total window and reports RUN_TIMEOUT', async () => {
    const clock = fakeClock();
    let settle: (() => void) | null = null;
    const prompt = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running = runWithWatchdog({
      prompt: () => prompt,
      abort: async () => settle?.(),
      activityAt: () => clock.now(), // active all the time: only the total window can trip
      stallMs: 60_000,
      totalMs: 1_000,
      now: clock.now,
      tickMs: 20,
    });
    const settled = running.then(() => null).catch((thrown: unknown) => thrown);
    await new Promise((resolve) => setTimeout(resolve, 60));
    clock.advance(1_500);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const error = await settled;
    expect(error).toBeInstanceOf(RunWatchdogError);
    expect((error as RunWatchdogError).code).toBe('RUN_TIMEOUT');
  });

  it('does not abort a run that waits for the user, and does not count the wait as run time', async () => {
    const clock = fakeClock();
    let aborted = 0;
    let waiting = true;
    let resolvePrompt: () => void = () => undefined;
    const prompt = new Promise<void>((resolve) => {
      resolvePrompt = resolve;
    });
    const activity = clock.now();
    const running = runWithWatchdog({
      prompt: () => prompt,
      abort: async () => {
        aborted += 1;
        resolvePrompt();
      },
      activityAt: () => activity, // no Pi activity at all: only the user is being waited on
      waiting: () => waiting,
      stallMs: 1_000,
      totalMs: 2_000,
      now: clock.now,
      tickMs: 20,
    });
    // Far beyond both windows while the question is on screen.
    await new Promise((resolve) => setTimeout(resolve, 120));
    clock.advance(10_000);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(aborted).toBe(0);
    // The user answers: the run settles normally instead of tripping a window.
    waiting = false;
    resolvePrompt();
    await expect(running).resolves.toBeUndefined();
    expect(aborted).toBe(0);
  });

  it('leaves an active run alone and returns normally', async () => {
    const clock = fakeClock();
    let aborted = 0;
    const running = runWithWatchdog({
      prompt: async () => {
        // A healthy run keeps producing activity and settles.
        clock.advance(200);
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
      abort: async () => {
        aborted += 1;
      },
      activityAt: () => clock.now(),
      stallMs: 5_000,
      totalMs: 60_000,
      now: clock.now,
      tickMs: 20,
    });
    await expect(running).resolves.toBeUndefined();
    expect(aborted).toBe(0);
  });
});
