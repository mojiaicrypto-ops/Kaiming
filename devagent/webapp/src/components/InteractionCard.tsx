import { useEffect, useRef, useState } from 'react';
import type { PendingInteraction } from '../api/stream';

export type AnswerState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; echo: string } | { kind: 'stale' } | { kind: 'failed'; message: string };

interface Props {
  interaction: PendingInteraction;
  index: number;
  total: number;
  sourceRole?: string;
  onAnswer: (response: unknown) => Promise<void>;
}

function echoOf(response: unknown): string {
  if (typeof response === 'object' && response !== null) {
    const record = response as Record<string, unknown>;
    if (typeof record['value'] === 'string') return record['value'];
    if (typeof record['confirmed'] === 'boolean') return record['confirmed'] ? '已确认' : '已取消';
    if (record['cancelled'] === true) return '不选择';
  }
  return '已答复';
}

/**
 * The interaction bridge (M5): confirm/select/input, answered through interaction.respond.
 * Full lifecycle: busy → local "done" echo (the authoritative pending refresh corrects the
 * region afterwards), STALE → "already handled", network failure → inline retry.
 */
export function InteractionCard({ interaction, index, total, sourceRole, onAnswer }: Props) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<AnswerState>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const done = state.kind === 'done' || state.kind === 'stale' || interaction.resolved === true;

  useEffect(() => {
    if (interaction.method === 'input' && state.kind === 'idle') inputRef.current?.focus();
    // Focus once on appear; later re-renders (e.g. pending refresh) must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = async (response: unknown): Promise<void> => {
    if (state.kind === 'busy' || done) return;
    setState({ kind: 'busy' });
    try {
      await onAnswer(response);
      setState({ kind: 'done', echo: echoOf(response) });
    } catch (error: unknown) {
      const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : '';
      if (code === 'INTERACTION_STALE' || code === 'NOT_FOUND') {
        setState({ kind: 'stale' });
      } else {
        setState({ kind: 'failed', message: code !== '' ? `${code}: 提交失败，请重试` : '网络错误，请重试' });
      }
    }
  };

  return (
    <div
      className={`interaction-card interaction-${interaction.method}${done ? ' interaction-done' : ''}`}
      data-interaction-id={interaction.interactionId}
    >
      <div className="interaction-head">
        <strong>{interaction.title}</strong>
        {total > 1 && <span className="interaction-index">第 {index + 1}/{total} 问</span>}
        {sourceRole !== undefined && <span className="interaction-source">{sourceRole}</span>}
        {state.kind === 'busy' && <span className="interaction-busy">提交中…</span>}
      </div>
      {interaction.message !== null && interaction.message !== '' && (
        <p className="interaction-message">{interaction.message}</p>
      )}
      {state.kind === 'done' && <p className="interaction-echo">✓ {state.echo}</p>}
      {state.kind === 'stale' && <p className="interaction-echo interaction-echo-stale">该问题已被处理（状态已变化），无需再次回答。</p>}
      {state.kind === 'failed' && (
        <p className="interaction-error">
          {state.message}
          <button type="button" onClick={() => setState({ kind: 'idle' })}>重置重答</button>
        </p>
      )}
      {state.kind !== 'failed' && (
        <>
          {interaction.method === 'confirm' && (
            <div className="interaction-actions">
              <button type="button" disabled={state.kind === 'busy' || done} onClick={() => void answer({ confirmed: true })}>确认</button>
              <button type="button" disabled={state.kind === 'busy' || done} onClick={() => void answer({ confirmed: false })}>取消</button>
            </div>
          )}
          {interaction.method === 'select' && interaction.options !== null && (
            <div className="interaction-options">
              {interaction.options.map((option) => (
                <button key={option} type="button" disabled={state.kind === 'busy' || done} onClick={() => void answer({ value: option })}>
                  {option}
                </button>
              ))}
              <button type="button" className="interaction-skip" disabled={state.kind === 'busy' || done} onClick={() => void answer({ cancelled: true })}>不选择</button>
            </div>
          )}
          {interaction.method === 'input' && (
            <form
              className="interaction-input"
              onSubmit={(event) => {
                event.preventDefault();
                if (value.trim() === '') return;
                void answer({ value });
              }}
            >
              <input
                ref={inputRef}
                value={value}
                placeholder={interaction.placeholder ?? '输入内容…'}
                onChange={(event) => setValue(event.target.value)}
              />
              <button type="submit" disabled={state.kind === 'busy' || done || value.trim() === ''}>发送</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
