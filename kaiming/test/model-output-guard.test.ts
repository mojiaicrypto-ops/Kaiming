import { describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  ModelOutputGuard,
  degenerationReason,
  isHiddenModelOutputCorrectionEvent,
  MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE,
  toolArgumentLimit,
} from '../src/runtime/model-output-guard.ts';

describe('model output degeneration guard', () => {
  it('detects the incident shape: a normal report followed by repeated closing tags', () => {
    const report = `${'normal report line\n'.repeat(400)}${'</invoke>\n</function>\n'.repeat(80)}`;
    expect(degenerationReason(report, 'tool')).toContain('repeated closing tags');
  });

  it('detects a repeated suffix', () => {
    expect(degenerationReason('abcd'.repeat(100), 'text')).toContain('repeated suffix');
  });


  it('blocks an oversized agent_report call without repair', async () => {
    type Handler = (event: unknown, ctx: unknown) => unknown;
    const handlers = new Map<string, Handler>();
    const guard = new ModelOutputGuard();
    const pi = {
      on(event: string, handler: Handler) {
        handlers.set(event, handler);
        return () => undefined;
      },
    } as unknown as ExtensionAPI;
    guard.extension(pi);

    const block = await handlers.get('tool_call')?.(
      {
        type: 'tool_call',
        toolCallId: 'call-1',
        toolName: 'agent_report',
        input: { summary: 's', body: 'x'.repeat(20_000) },
      },
      {},
    );
    expect(block).toMatchObject({ block: true });
    expect((block as { reason?: string }).reason).toContain('limit');
    expect(guard.fault).toBeUndefined();
  });
  it('leaves ordinary text and occasional code tags alone', () => {
    expect(degenerationReason('ordinary assistant text', 'text')).toBeUndefined();
    expect(degenerationReason('```xml\n</function>\n```', 'text')).toBeUndefined();
  });

  it('does not treat an ordinary file containing markup as degeneration', () => {
    expect(degenerationReason('{"path":"x","content":"<parameter name=\\"body\\">"}', 'tool')).toBeUndefined();
  });

  it('applies a smaller report body limit', () => {
    expect(toolArgumentLimit('agent_report')).toBe(16_384);
    expect(toolArgumentLimit('write')).toBe(1_048_576);
  });

  it('recognizes only the private corrective message frames', () => {
    expect(
      isHiddenModelOutputCorrectionEvent({
        type: 'message_end',
        message: { role: 'custom', customType: MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE },
      }),
    ).toBe(true);
    expect(
      isHiddenModelOutputCorrectionEvent({
        type: 'message_end',
        message: { role: 'assistant' },
      }),
    ).toBe(false);
  });
});
