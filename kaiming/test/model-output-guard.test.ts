import { describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  MODEL_OUTPUT_CORRUPTED,
  MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE,
  ModelOutputGuard,
  REPORT_FAILURE_LIMIT,
  REPORT_RETRY_EXHAUSTED,
  createModelOutputGuardExtension,
  isHiddenModelOutputCorrectionEvent,
  toolArgumentLimit,
} from '../src/runtime/model-output-guard.ts';

/** A toolResult message_end event as the session stream emits it. */
const reportResult = (isError: boolean, text = 'Validation failed for tool "agent_report": body required') => ({
  type: 'message_end',
  message: {
    role: 'toolResult',
    toolCallId: 'c1',
    toolName: 'agent_report',
    isError,
    content: [{ type: 'text', text: isError ? text : 'ok' }],
  },
});
const otherResult = (toolName: string, isError: boolean) => ({
  type: 'message_end',
  message: { role: 'toolResult', toolCallId: 'c2', toolName, isError, content: [] },
});
const toolDelta = (chars: number, index = 0) => ({
  type: 'message_update',
  assistantMessageEvent: { type: 'toolcall_delta', delta: 'x'.repeat(chars), contentIndex: index },
});
const HEALTHY_TOOLS = ['read', 'bash', 'grep'] as const;

describe('report retry ledger', () => {
  it('trips at five consecutive failed report attempts and records the terminal fault', () => {
    const guard = new ModelOutputGuard();
    for (let attempt = 1; attempt < REPORT_FAILURE_LIMIT; attempt += 1) {
      expect(guard.observeEvent(reportResult(true))).toBe(false);
    }
    expect(guard.observeEvent(reportResult(true))).toBe(true);
    expect(guard.fault).toMatchObject({ code: REPORT_RETRY_EXHAUSTED });
    expect(guard.fault?.detail).toContain('5 consecutive times');
    expect(guard.fault?.detail).toContain('body required');
  });

  it('resets the streak only when agent_report itself succeeds', () => {
    const guard = new ModelOutputGuard();
    for (let attempt = 0; attempt < 4; attempt += 1) guard.observeEvent(reportResult(true));
    guard.observeEvent(reportResult(false));
    // The success restarts the budget: one failure after it is streak 1, the fifth trips.
    expect(guard.observeEvent(reportResult(true))).toBe(false);
    expect(guard.fault).toBeUndefined();
    for (let attempt = 0; attempt < 3; attempt += 1) guard.observeEvent(reportResult(true));
    expect(guard.observeEvent(reportResult(true))).toBe(true);
  });

  it('does not let other tools reset or fill the streak', () => {
    const guard = new ModelOutputGuard();
    for (let attempt = 0; attempt < 4; attempt += 1) guard.observeEvent(reportResult(true));
    // The 2026-11-13 incident: successful read/bash calls interleaved between report failures.
    guard.observeEvent(otherResult('read', false));
    guard.observeEvent(otherResult('bash', false));
    expect(guard.observeEvent(reportResult(true))).toBe(true);
    const fresh = new ModelOutputGuard();
    for (let attempt = 0; attempt < 10; attempt += 1) fresh.observeEvent(otherResult('bash', true));
    expect(fresh.fault).toBeUndefined();
  });

  it('starts a fresh budget with the corrective turn and terminates after five more', () => {
    const guard = new ModelOutputGuard();
    for (let attempt = 0; attempt < REPORT_FAILURE_LIMIT; attempt += 1) guard.observeEvent(reportResult(true));
    // Overshooting results (a parallel batch) keep the fault but do not trip again.
    expect(guard.observeEvent(reportResult(true))).toBe(false);
    // Mirror recoverModelOutput; Object.assign keeps the later fault reads un-narrowed.
    Object.assign(guard, { retryUsed: true, fault: undefined });
    guard.resetReportStreak();
    for (let attempt = 0; attempt < 4; attempt += 1) guard.observeEvent(reportResult(true));
    expect(guard.observeEvent(reportResult(true))).toBe(true);
    expect(guard.fault?.code).toBe(REPORT_RETRY_EXHAUSTED);
  });

  it('ignores messages that are not tool results', () => {
    const guard = new ModelOutputGuard();
    expect(guard.observeEvent({ type: 'message_end', message: { role: 'assistant' } })).toBe(false);
    expect(guard.observeEvent({ type: 'message_start', message: { role: 'assistant' } })).toBe(false);
    expect(guard.observeEvent({ type: 'message_end', message: { role: 'user' } })).toBe(false);
    expect(guard.fault).toBeUndefined();
  });
});

describe('streamed argument cap', () => {
  it('aborts when one streamed tool argument crosses the hard cap', () => {
    const guard = new ModelOutputGuard();
    expect(guard.observeEvent(toolDelta(600_000))).toBe(false);
    expect(guard.observeEvent(toolDelta(600_000))).toBe(true);
    expect(guard.fault).toMatchObject({
      code: MODEL_OUTPUT_CORRUPTED,
      detail: 'tool arguments exceeded the streaming size limit',
    });
  });

  it('counts tool-call arguments per content index and resets with each assistant message', () => {
    const guard = new ModelOutputGuard();
    expect(guard.observeEvent(toolDelta(700_000, 0))).toBe(false);
    expect(guard.observeEvent(toolDelta(700_000, 1))).toBe(false);
    expect(guard.observeEvent({ type: 'message_start', message: { role: 'assistant' } })).toBe(false);
    expect(guard.observeEvent(toolDelta(700_000, 0))).toBe(false);
  });

  it('never analyses plain text deltas', () => {
    const guard = new ModelOutputGuard();
    expect(
      guard.observeEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '</invoke>'.repeat(5000) },
      }),
    ).toBe(false);
    expect(guard.fault).toBeUndefined();
  });
});

describe('tool call policy', () => {
  it('blocks non-object arguments and records the fault', () => {
    const guard = new ModelOutputGuard();
    expect(guard.checkToolCall('agent_report', 'garbage')).toMatchObject({ block: true });
    expect(guard.fault).toMatchObject({ code: MODEL_OUTPUT_CORRUPTED, detail: 'tool arguments are not a JSON object' });
  });

  it('blocks an oversized report call without repair and without a fault', () => {
    const guard = new ModelOutputGuard();
    const block = guard.checkToolCall('agent_report', { summary: 's', body: 'x'.repeat(20_000) });
    expect(block.block).toBe(true);
    expect(block.reason).toContain('limit');
    expect(guard.fault).toBeUndefined();
  });

  it('leaves ordinary calls alone', () => {
    const guard = new ModelOutputGuard();
    expect(guard.checkToolCall('read', { path: 'a.md' })).toMatchObject({ block: false });
    expect(toolArgumentLimit('agent_report')).toBe(16_384);
    expect(toolArgumentLimit('write')).toBe(1_048_576);
  });
});

describe('checker self-test: the streak rule is load-bearing', () => {
  it('the any-success mutation fails to trip on the 2026-11-13 incident sequence', () => {
    // The real incident: successful read/bash calls interleaved between report failures.
    const sequence = [0, 1, 2, 3, 4].flatMap(() => [reportResult(true), otherResult('read', false)]);
    const shipped = new ModelOutputGuard();
    for (const event of sequence) shipped.observeEvent(event);
    expect(shipped.fault).toMatchObject({ code: REPORT_RETRY_EXHAUSTED });
    const mutated = new ModelOutputGuard({ resetOn: 'any-success' });
    for (const event of sequence) mutated.observeEvent(event);
    expect(mutated.fault).toBeUndefined();
  });
});

describe('adversarial degeneration generator', () => {
  // Deterministic PRNG so every seed is reproducible; each seed is a different degenerate shape.
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
  }
  const ALPHABETS = ['agent_report', 'body', 'summary', 'invoke', 'function', 'parameter', 'v8', '工具', '𝟋𝘂𝗻𝗰'];
  /** One degenerate attempt: malformed args in a random shape, or an oversized blob. */
  function degenerateAttempt(rng: () => number): { name: string; input: unknown } {
    const roll = rng();
    if (roll < 0.15) return { name: 'agent_report', input: {} };
    if (roll < 0.3) return { name: 'agent_report', input: { summary: 's' } };
    const alphabet = ALPHABETS[Math.floor(rng() * ALPHABETS.length)] ?? 'body';
    const unit = `</${alphabet}>${' '.repeat(1 + Math.floor(rng() * 3))}`;
    const size = rng() < 0.2 ? 40_000 + Math.floor(rng() * 100_000) : 200 + Math.floor(rng() * 2_000);
    return { name: 'agent_report', input: { summary: unit.repeat(Math.ceil(size / unit.length)).slice(0, size) } };
  }

  it('every seed reaches the terminal state within ten failed attempts and one corrective turn', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const rng = makeRandom(seed);
      const guard = new ModelOutputGuard();
      let failures = 0;
      let correctiveUsed = false;
      let terminal = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        const call = degenerateAttempt(rng);
        // The extension's pre-execution gate, then the result the model actually gets back.
        const decision = guard.checkToolCall(call.name, call.input);
        const reason = decision.block ? (decision.reason ?? 'blocked') : 'Validation failed: body required';
        const trip = guard.observeEvent(reportResult(true, reason));
        failures += 1;
        if (trip && !correctiveUsed) {
          correctiveUsed = true;
          guard.retryUsed = true;
          guard.fault = undefined;
          guard.resetReportStreak();
        } else if (trip) {
          terminal = true;
          break;
        }
      }
      expect(terminal, `seed ${String(seed)}: no terminal state`).toBe(true);
      expect(failures, `seed ${String(seed)}: too many attempts`).toBeLessThanOrEqual(REPORT_FAILURE_LIMIT * 2);
      expect(correctiveUsed, `seed ${String(seed)}: the corrective turn never ran`).toBe(true);
    }
  });

  it('healthy traffic never trips the ledger', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const rng = makeRandom(seed + 1000);
      const guard = new ModelOutputGuard();
      for (let round = 0; round < 200; round += 1) {
        if (rng() < 0.8) {
          const tool = HEALTHY_TOOLS[Math.floor(rng() * HEALTHY_TOOLS.length)] ?? 'read';
          guard.observeEvent(otherResult(tool, rng() < 0.2));
        } else {
          guard.observeEvent(reportResult(false));
        }
      }
      expect(guard.fault, `seed ${String(seed + 1000)}: healthy traffic tripped`).toBeUndefined();
    }
  });
});

describe('extension bridge', () => {
  type Handler = (event: unknown, ctx: unknown) => unknown;
  function bridge(active: () => ModelOutputGuard | undefined): Map<string, Handler> {
    const handlers = new Map<string, Handler>();
    // The tests stub only `on`; ExtensionAPI's full surface is irrelevant to the bridge handlers.
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
        return () => undefined;
      },
    } as unknown as ExtensionAPI;
    createModelOutputGuardExtension(active)(pi);
    return handlers;
  }

  it('routes tool_call blocks through the active guard', async () => {
    const guard = new ModelOutputGuard();
    const handlers = bridge(() => guard);
    const block = await handlers.get('tool_call')?.(
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'agent_report', input: { summary: 's', body: 'x'.repeat(20_000) } },
      {},
    );
    expect(block).toMatchObject({ block: true, reason: expect.stringContaining('limit') });
    expect(guard.fault).toBeUndefined();
  });

  it('replaces a discarded assistant message before it enters history', async () => {
    const guard = new ModelOutputGuard();
    guard.checkToolCall('agent_report', 'garbage');
    const handlers = bridge(() => guard);
    const replacement = await handlers.get('message_end')?.(
      { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'junk' }] } },
      {},
    );
    expect(replacement).toMatchObject({
      message: { content: [{ text: expect.stringContaining('discarded') }] },
    });
  });

  it('reaches the guard swapped in after instance creation (registry reuse)', async () => {
    // The registry reuses a Pi instance across inputs without reinstalling extensions: the bridge
    // must reach whichever guard the runner made active for the current input.
    let active: ModelOutputGuard | undefined = new ModelOutputGuard();
    const handlers = bridge(() => active);
    const second = new ModelOutputGuard();
    active = second;
    await handlers.get('tool_call')?.({ type: 'tool_call', toolCallId: 'c', toolName: 'agent_report', input: 'garbage' }, {});
    expect(second.fault).toMatchObject({ code: MODEL_OUTPUT_CORRUPTED });
  });

  it('recognizes only the private corrective message frames', () => {
    expect(
      isHiddenModelOutputCorrectionEvent({
        type: 'message_end',
        message: { role: 'custom', customType: MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE },
      }),
    ).toBe(true);
    expect(isHiddenModelOutputCorrectionEvent({ type: 'message_end', message: { role: 'assistant' } })).toBe(false);
  });
});
