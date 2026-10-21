import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { responseFor, rowsFor, type AnswerRow } from './interaction-model';
import type { PendingInteraction } from '../api/stream';

export type AnswerState = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'done'; readonly echo: string } | { readonly kind: 'stale' } | { readonly kind: 'failed'; readonly message: string };

export interface InteractionPanelProps {
  readonly interactions: readonly PendingInteraction[];
  readonly answerState: Readonly<Record<string, AnswerState>>;
  readonly onAnswer: (interaction: PendingInteraction, response: unknown) => Promise<void>;
  readonly sourceLabel: (interaction: PendingInteraction) => string;
  readonly collapsed: boolean;
  readonly onCollapse: () => void;
  readonly onExpand: () => void;
  /** Drops the local refusal so the card can be answered again. */
  readonly onRetry: () => void;
}

/**
 * The question panel, docked above the composer: the answer *is* the next input, so it must not
 * cover the transcript. One question at a time, keyboard-first (digits pick, arrows move, Enter
 * confirms, Esc defers), with the previous answer echoed above the new question so a burst of
 * questions never feels like it swallowed one (C-panel, 8 behaviours).
 */
export function InteractionPanel({ interactions, answerState, onAnswer, sourceLabel, collapsed, onCollapse, onExpand, onRetry }: InteractionPanelProps) {
  const { t } = useI18n();
  // A stale card is not hidden: the user asked something and the server refused it, so the panel
  // says so and offers to reopen the answer form (R7's last leg).
  const visible = interactions;
  const sealed = visible.every((entry) => answerState[entry.interactionId]?.kind === 'done');
  const open = visible.filter((entry) => {
    const state = answerState[entry.interactionId];
    return state?.kind !== 'done' && state?.kind !== 'stale';
  });
  const [pendingIndex, setPendingIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [other, setOther] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasTypingComposer = useRef(false);

  // When nothing is open, the panel shows the last answer's echo rather than disappearing: an
  // answer that vanishes on submit looks like it was never recorded.
  const active =
    open[Math.min(pendingIndex, Math.max(open.length - 1, 0))] ??
    visible.find((entry) => answerState[entry.interactionId]?.kind === 'stale') ??
    visible.find((entry) => answerState[entry.interactionId]?.kind === 'done') ??
    visible[visible.length - 1];
  const activeId = active?.interactionId ?? null;
  const state = activeId === null ? undefined : answerState[activeId];

  // A new question resets the cursor and the escape hatch; typing in the composer is not interrupted.
  useEffect(() => {
    setSelected(0);
    setOther(active?.method === 'input');
    // The draft belongs to the question it was typed for: carrying it into the next one would
    // send text the user can no longer see (the field renders empty for a different question).
    setDraft((current) => (draftFor === activeId ? current : ''));
    setDraftFor((current) => (current === activeId ? current : null));
    // `draftFor` is read, not followed: including it would re-run on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.method]);

  useEffect(() => {
    if (activeId === null || sealed) return;
    const element = document.activeElement as HTMLElement | null;
    wasTypingComposer.current = element?.tagName === 'TEXTAREA';
    if (wasTypingComposer.current) return;
    if (draftFor === null && !open.every((entry) => answerState[entry.interactionId]?.kind === 'done')) {
      inputRef.current?.focus();
    }
  }, [answerState, activeId, draftFor, open, sealed]);

  const rows: AnswerRow[] =
    active === undefined
      ? []
      : rowsFor(active).map((row) => (row.label === 'confirm' ? { ...row, label: t('ask.confirm') } : row.label === 'reject' ? { ...row, label: t('ask.reject') } : row.label === 'other' ? { ...row, label: t('ask.other') } : row));

  const submit = async (value: unknown): Promise<void> => {
    if (active === undefined || state?.kind === 'busy') return;
    await onAnswer(active, responseFor(active.method, value));
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (active === undefined || state?.kind === 'done' || sealed) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (other && active.method === 'select' && draft !== '') {
        setDraft('');
        setDraftFor(null);
        return;
      }
      onCollapse();
      return;
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (state?.kind === 'failed') {
        void submit(other && draft !== '' ? draft : active.method === 'confirm' ? rows[selected]?.value : draft);
        return;
      }
      if (other) {
        void submit(draft);
        return;
      }
      if (active.method === 'input') {
        void submit(draft);
        return;
      }
      const row = rows[selected];
      if (row === undefined) return;
      if (row.input === true) {
        setOther(true);
        setDraftFor(active.interactionId);
        return;
      }
      void submit(row.value);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (active.method === 'input' || other) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelected((current) => {
        const next = current + delta;
        if (next < 0) return rows.length - 1;
        if (next >= rows.length) return 0;
        return next;
      });
      return;
    }
    if (/^[1-9]$/.test(event.key) && active.method !== 'input' && !other) {
      const index = Number(event.key) - 1;
      const row = rows[index];
      if (row === undefined) return;
      event.preventDefault();
      setSelected(index);
      if (row.input === true) {
        setOther(true);
        setDraftFor(active.interactionId);
        return;
      }
      void submit(row.value);
    }
  };

  if (visible.length === 0) return null;

  if (collapsed) {
    return (
      <div id="c-pop">
        <button type="button" className="qpill" onClick={onExpand} data-testid="question-pill">
          <State kind="decide">{t('ask.collapsed', { count: open.length })}</State>
          <span className="f3">{t('ask.open')}</span>
        </button>
      </div>
    );
  }

  const previousSealed = visible.filter((entry) => answerState[entry.interactionId]?.kind === 'done');
  const previous = previousSealed[previousSealed.length - 1];
  const previousEcho = previous === undefined ? undefined : answerState[previous.interactionId];

  return (
    <div id="c-pop">
      <div
        className={`ask${state?.kind === 'done' ? ' done' : state?.kind === 'failed' ? ' err' : ''}`}
        data-iid={activeId ?? ''}
        tabIndex={-1}
        role="group"
        aria-label={t('aria.question', { title: active?.title ?? '' })}
        onKeyDown={onKeyDown}
        data-testid="question-panel"
      >
        {previous !== undefined && previousEcho?.kind === 'done' && (
          <div className="ask-prev">
            <State kind="done" />
            <span className="f3 ell">{previous.title}</span>
            <b>{previousEcho.echo}</b>
            <span className="f3">{t('ask.answered')}</span>
          </div>
        )}
        {active !== undefined && (
          <>
            <div className="ask-h">
              <State kind={state?.kind === 'done' ? 'done' : 'decide'} />
              <span className="ask-t">{active.title}</span>
              <span className="sp" />
              <span className="f3">{sourceLabel(active)}</span>
              {open.length > 1 && (
                <span className="ask-n">
                  {Math.min(pendingIndex, open.length - 1) + 1}/{open.length}
                </span>
              )}
              {state?.kind !== 'done' && (
                <button type="button" className="ask-x" onClick={onCollapse} title={t('ask.laterTitle')}>
                  {t('ask.later')}
                </button>
              )}
            </div>

            {state?.kind === 'stale' ? (
              <div className="ask-echo">
                <span className="f3">{t('ask.stale')}</span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setPendingIndex(0);
                    onRetry();
                  }}
                >
                  {t('ask.retry')}
                </button>
              </div>
            ) : state?.kind === 'done' ? (
              <div className="ask-echo">
                {t('ask.answerReceived', { echo: state.echo })}
                <span className="f3">{t('ask.answerHanded', { from: sourceLabel(active) })}</span>
              </div>
            ) : (
              <>
                {active.message !== null && active.message !== '' && <div className="ask-m">{active.message}</div>}
                <div className="ask-o">
                  {active.method === 'input' ? (
                    <div className="ao on other">
                      <span className="k">›</span>
                      <input
                        ref={inputRef}
                        className="ao-in"
                        placeholder={t('ask.inputPlaceholder')}
                        aria-label={active.title}
                        value={draftFor === active.interactionId ? draft : ''}
                        onChange={(event) => {
                          setDraft(event.target.value);
                          setDraftFor(active.interactionId);
                        }}
                      />
                    </div>
                  ) : (
                    rows.map((row, index) =>
                      row.input === true && other ? (
                        <div className="ao on other" key="other">
                          <span className="k">{index + 1}</span>
                          <input
                            ref={inputRef}
                            className="ao-in"
                            placeholder={t('ask.otherPlaceholder')}
                            aria-label={t('ask.other')}
                            value={draftFor === active.interactionId ? draft : ''}
                            onChange={(event) => {
                              setDraft(event.target.value);
                              setDraftFor(active.interactionId);
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          key={`${row.label}-${index}`}
                          type="button"
                          className={`ao${index === selected ? ' on' : ''}${row.input === true ? ' other' : ''}`}
                          onMouseEnter={() => setSelected(index)}
                          onClick={() => {
                            if (row.input === true) {
                              setOther(true);
                              setDraftFor(active.interactionId);
                              return;
                            }
                            void submit(row.value);
                          }}
                        >
                          <span className="k">{index + 1}</span>
                          <span className="ao-t">{row.label}</span>
                        </button>
                      ),
                    )
                  )}
                </div>
                <div className="ask-f">
                  {active.method === 'input'
                    ? t('ask.keys.input')
                    : t('ask.keys.select', { n: rows.length })}
                  <span className="sp" />
                  {state?.kind === 'busy'
                    ? t('ask.submitting')
                    : state?.kind === 'failed'
                      ? t('ask.failed', { reason: state.message })
                      : t('ask.rule')}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
