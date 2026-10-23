import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RpcError } from '../api/rpc';
import { useI18n } from '../i18n/I18nProvider';
import { SessionsList } from './SessionsList';
import { useTier } from '../layout/useTier';
import { Transcript } from './Transcript';
import { Banner } from './Banner';
import { TaskStrip } from './TaskStrip';
import { InteractionPanel, type AnswerState } from './InteractionPanel';
import { Composer, DockHint } from './Composer';
import { QueuedInputs } from './QueuedInputs';
import { EmptyState } from './EmptyState';
import { MemberDrawer } from './MemberDrawer';
import { TaskDrawer } from './TaskDrawer';
import { echoOf } from './interaction-model';
import { createAutoscroll } from '../lib/scroll';
import type { ChiefSessionApi } from '../state/useSession';
import type { SessionRow } from '../state/useWorkspace';
import type { TaskMemberRow } from './ToolTask';
import type { TaskDetail } from '../state/slot';
import type { PendingInteraction } from '../api/stream';
import { errorText } from '../lib/errors';

function useCompact(): boolean {
  const tier = useTier();
  return tier === 'compact' || tier === 'phone';
}

export interface ChatPageProps {
  readonly session: ChiefSessionApi;
  readonly sessions: readonly SessionRow[];
  readonly currentSessionId: string;
  readonly projectId: string;
  readonly hasProject: boolean;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onCreateSession: () => void;
  readonly hasMoreSessions: boolean;
  /** Removes a settled session; resolves to whether it was removed. */
  readonly onCleanupSession: (sessionId: string, revision: number) => Promise<boolean>;
  /** Fills the composer with a request about the interrupted run; the chief decides what follows. */
  readonly onAskChief: (text: string) => void;
  /** No session is open: the banner offers the one action that can start a connection. */
  readonly onNewSession: () => void;
  /** Text handed over from another screen: filled in, not sent. */
  readonly draft: string | null;
  readonly onDraftConsumed: (inserted: boolean) => void;
  readonly onLoadMoreSessions: () => void;
  readonly onOpenRail: () => void;
  readonly railOpen: boolean;
}

/**
 * The chat screen. Region order is the prototype's: banners, task strip, transcript, dock. The
 * transcript owns its own scroll-follow handle so that a streaming answer never yanks the view
 * away from a user who scrolled up (R5); the "back to latest" pill is the only way it moves you.
 */
export function ChatPage({ session, sessions, currentSessionId, projectId, hasProject, onSelectSession, onCreateSession, hasMoreSessions, onLoadMoreSessions, onCleanupSession, onAskChief, onNewSession, draft, onDraftConsumed, railOpen, onOpenRail }: ChatPageProps) {
  // Below 861px the session rail is a sheet, not a column: CSS hides the column, so the sheet is
  // the only way to switch sessions there.
  const compact = useCompact();
  const { t } = useI18n();
  const { slot } = session;
  const txRef = useRef<HTMLDivElement | null>(null);
  const [scrollUi, setScrollUi] = useState<{ locked: boolean; showJumpButton: boolean }>({ locked: false, showJumpButton: false });
  const handleRef = useRef<ReturnType<typeof createAutoscroll> | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  /** Inputs the host could not close (a crash, an unknown save): the user must be told they exist. */
  const [interrupted, setInterrupted] = useState<readonly { inputId: string; errorCode: string | null }[]>([]);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  /** Backwards paging: the snapshot holds the tail, and this asks for the page before it. */
  const [earlier, setEarlier] = useState<{ readonly loading: boolean; readonly hasMore: boolean }>({
    loading: false,
    hasMore: true,
  });
  const [follow, setFollow] = useState<string | null>(null);
  const [questionsCollapsed, setQuestionsCollapsed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  // When each answer really landed, so "answer received" can be shown once and then go away.
  const [answeredAt, setAnsweredAt] = useState<Record<string, number>>({});
  // The echo is proof, not a dialog: a short beat to read it, then the composer has the room back.
  const ECHO_MS = 4_000;
  const [, setEchoTick] = useState(0);
  useEffect(() => {
    const waiting = Object.values(answers).some((state) => state.kind === 'done');
    if (!waiting) return;
    const timer = window.setInterval(() => setEchoTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [answers]);
  const echoExpired = useCallback(
    (interactionId: string): boolean => {
      const at = answeredAt[interactionId];
      return at !== undefined && Date.now() - at > ECHO_MS;
    },
    [answeredAt],
  );

  useEffect(() => {
    const element = txRef.current;
    if (element === null) return;
    const handle = createAutoscroll(element, setScrollUi);
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
    };
  }, []);

  // The rail sheet closes on Escape, like every other overlay.
  useEffect(() => {
    if (!compact || !railOpen) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onOpenRail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, railOpen, onOpenRail]);

  // Streaming growth and image loads change scrollHeight without a user scroll: follow again.
  useEffect(() => {
    handleRef.current?.followIfUnlocked();
  }, [slot.items, slot.busy]);

  const taskDetail: TaskDetail | null = slot.taskDetail;
  const members: readonly TaskMemberRow[] = useMemo(() => {
    const detail = taskDetail;
    if (detail === null) return [];
    return detail.members.map((member) => ({
      sessionId: member.sessionId,
      label: member.label,
      activity: member.activity ?? 'idle',
      lastInputStatus: member.lastInputStatus ?? null,
      waitingUser: member.currentInputId !== null && (member.activity ?? 'idle') === 'idle',
      note: (member.activity ?? 'idle') === 'processing' ? member.phase : '',
    }));
  }, [taskDetail]);

  // The local echo keeps an answered card on screen just long enough to prove the answer was
  // recorded (a few seconds), then closes it: a box that stays after the question is over blocks
  // the transcript and asks the user to dismiss a decision they already made.
  const remembered = useRef(new Map<string, PendingInteraction>());
  for (const entry of slot.pending) remembered.current.set(entry.interactionId, entry);
  const visibleQuestions = [
    ...slot.pending.filter((entry) => entry.resolved !== true),
    ...[...remembered.current.values()].filter(
      (entry) =>
        answers[entry.interactionId]?.kind === 'done' &&
        !slot.pending.some((live) => live.interactionId === entry.interactionId) &&
        !echoExpired(entry.interactionId),
    ),
  ];
  const openQuestions = visibleQuestions.filter((entry) => answers[entry.interactionId]?.kind !== 'done');
  const activeStaleId =
    visibleQuestions.find((entry) => answers[entry.interactionId]?.kind === 'stale')?.interactionId ?? null;

  const answer = useCallback(
    async (interaction: PendingInteraction, response: unknown): Promise<void> => {
      setAnswers((current) => ({ ...current, [interaction.interactionId]: { kind: 'busy' } }));
      try {
        await session.respond(interaction, response);
        setAnswers((current) => ({ ...current, [interaction.interactionId]: { kind: 'done', echo: echoOf(response) } }));
        setAnsweredAt((current) => ({ ...current, [interaction.interactionId]: Date.now() }));
      } catch (error) {
        const code = error instanceof RpcError ? error.code : '';
        if (code === 'STALE_INTERACTION' || code === 'INTERACTION_STALE' || code === 'REVISION_CONFLICT') {
          setAnswers((current) => ({ ...current, [interaction.interactionId]: { kind: 'stale' } }));
        } else {
          setAnswers((current) => ({
            ...current,
            [interaction.interactionId]: { kind: 'failed', message: error instanceof Error ? error.message : String(error) },
          }));
        }
      }
    },
    [session],
  );

  const sourceLabel = useCallback(
    (interaction: PendingInteraction): string => {
      if (interaction.sourceSessionId === undefined || interaction.sourceSessionId === currentSessionId) {
        return t('ask.fromChief');
      }
      const row = sessions.find((entry) => entry.sessionId === interaction.sourceSessionId);
      return row === undefined || row.title === null || row.title === '' ? interaction.sourceSessionId : row.title;
    },
    [currentSessionId, sessions, t],
  );

  // An interrupted input is a fact the server holds; asking once per idle moment is enough, and a
  // run in progress is not the moment (it may still close its own input).
  useEffect(() => {
    if (projectId === '' || currentSessionId === '' || slot.busy !== 'idle') return;
    let cancelled = false;
    void session.rpc
      .call<{ interruptedInputs: Array<{ inputId: string; errorCode: string | null }> }>('session.recovery.inspect', {
        projectId,
        sessionId: currentSessionId,
      })
      .then((read) => {
        if (cancelled) return;
        setInterrupted(read.interruptedInputs.map((entry) => ({ inputId: entry.inputId, errorCode: entry.errorCode })));
        // A new interruption deserves to be seen again even if an older one was dismissed.
        setRecoveryDismissed((dismissed) => (read.interruptedInputs.length === 0 ? false : dismissed));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, currentSessionId, slot.busy, session.rpc]);

  const submit = useCallback(
    async (text: string, images: readonly string[]): Promise<void> => {
      try {
        const outcome = await session.submit(text, images);
        if (outcome.queued) {
          session.notify(
            outcome.waitingForTask === undefined ? t('queue.afterStep') : `${t('queue.afterStep')} · ${outcome.waitingForTask}`,
            'info',
          );
        }
      } catch (error) {
        session.notify(t('toast.sendFailed', { reason: errorText(error, t) }), 'error');
        throw error;
      }
    },
    [session, t],
  );

  return (
    <div className="chat">
      {compact && railOpen ? (
        <>
          <div className="drawer-scrim" onClick={onOpenRail} role="presentation" />
          <SessionsList
            className="sheet"
            rows={sessions}
            current={currentSessionId}
            onSelect={onSelectSession}
            onCreate={onCreateSession}
            questionCount={(sessionId) => (sessionId === currentSessionId ? openQuestions.length : 0)}
            hasMore={hasMoreSessions}
            onLoadMore={onLoadMoreSessions}
            onCleanup={onCleanupSession}
          />
        </>
      ) : (
        <SessionsList
          rows={sessions}
          current={currentSessionId}
          onSelect={onSelectSession}
          onCreate={onCreateSession}
          questionCount={(sessionId) => (sessionId === currentSessionId ? openQuestions.length : 0)}
          hasMore={hasMoreSessions}
          onLoadMore={onLoadMoreSessions}
          onCleanup={onCleanupSession}
        />
      )}
      <section className="conv">
        <Banner
          interrupted={recoveryDismissed ? [] : interrupted}
          onAskChief={(text) => onAskChief(text)}
          onDismissInterrupted={() => setRecoveryDismissed(true)}
          status={session.status}
          blocked={session.blocked}
          onDismissBlocked={session.dismissBlocked}
          onRetry={session.retry}
          onNewSession={onNewSession}
          historyProblems={session.historyProblems}
        />
        <TaskStrip
          detail={taskDetail}
          pendingQuestions={openQuestions.length}
          membersOpen={membersOpen}
          onToggleMembers={() => setMembersOpen((open) => !open)}
          onOpenTask={() => setTaskOpen(true)}
          onFollow={(sessionId) => setFollow(sessionId)}
          onPause={() => {
            if (taskDetail !== null) {
              void session.rpc
                .call('task.control', {
                  projectId,
                  taskId: taskDetail.task.taskId,
                  command: 'pause',
                  expectedRevision: taskDetail.task.revision,
                })
                .catch((error: unknown) => session.notify(error instanceof Error ? error.message : String(error), 'error'));
            }
          }}
          onResume={() => {
            if (taskDetail !== null) {
              void session.rpc
                .call('task.control', {
                  projectId,
                  taskId: taskDetail.task.taskId,
                  command: 'resume',
                  expectedRevision: taskDetail.task.revision,
                })
                .catch((error: unknown) => session.notify(error instanceof Error ? error.message : String(error), 'error'));
            }
          }}
        />
        <div className="tx scroll" ref={txRef} data-testid="transcript">
          <div className="tx-in">
            {slot.items.length > 0 && slot.hasEarlier && earlier.hasMore && (
              <button
                type="button"
                className="btn ghost more"
                disabled={earlier.loading}
                onClick={() => {
                  const oldest = slot.items.find((item) => item.entryId !== '');
                  if (oldest === undefined) {
                    setEarlier({ loading: false, hasMore: false });
                    return;
                  }
                  setEarlier((current) => ({ ...current, loading: true }));
                  // Prepending moves everything down; without this the reader's place jumps and
                  // the messages they were reading vanish above the fold.
                  const view = txRef.current;
                  const heightBefore = view?.scrollHeight ?? 0;
                  const topBefore = view?.scrollTop ?? 0;
                  void session
                    .loadEarlier(oldest.entryId)
                    .then((more) => {
                      setEarlier({ loading: false, hasMore: more });
                      requestAnimationFrame(() => {
                        const element = txRef.current;
                        if (element === null) return;
                        element.scrollTop = topBefore + (element.scrollHeight - heightBefore);
                      });
                    })
                    .catch((error: unknown) => {
                      setEarlier({ loading: false, hasMore: false });
                      session.notify(error instanceof Error ? error.message : String(error), 'error');
                    });
                }}
                data-testid="load-earlier"
              >
                {earlier.loading ? t('common.loading') : t('chat.earlier')}
              </button>
            )}
            {slot.items.length === 0 ? (
              <EmptyState hasProject={hasProject} onExample={(text) => void submit(text, [])} />
            ) : (
              <Transcript
                items={slot.items}
                busy={slot.busy}
                variant="chief"
                members={members}
                onFollow={(sessionId) => setFollow(sessionId)}
              />
            )}
          </div>
        </div>
        <div className="dock">
          <div className="dock-in">
            {scrollUi.showJumpButton && (
              <button type="button" className="jump" onClick={() => handleRef.current?.jumpToBottom()}>
                {t('chat.jump')}
              </button>
            )}
            <InteractionPanel
              interactions={visibleQuestions}
              answerState={answers}
              onAnswer={answer}
              sourceLabel={sourceLabel}
              collapsed={questionsCollapsed}
              onCollapse={() => setQuestionsCollapsed(true)}
              onExpand={() => setQuestionsCollapsed(false)}
              onRetry={() => {
                if (activeStaleId !== null) {
                  setAnswers((current) => {
                    const next = { ...current };
                    delete next[activeStaleId];
                    return next;
                  });
                }
              }}
            />
            <QueuedInputs
              inputs={slot.queuedInputs}
              onWithdraw={async (inputId) => {
                try {
                  await session.cancelQueuedInput(inputId);
                } catch (error) {
                  session.notify(t('queue.withdrawFailed', { reason: errorText(error, t) }), 'error');
                }
              }}
            />
            <Composer
              busy={slot.busy}
              canStop={slot.currentInputId !== null}
              // Sending while the session is not subscribed would start work the transcript could
              // never show: the stream is the only way those events arrive.
              disabled={!hasProject || session.status !== 'connected'}
              seed={draft}
              onSeed={(inserted) => onDraftConsumed(inserted)}
              onSubmit={submit}
              onUpload={(file) => session.rpc.upload(file)}
              onStop={async () => {
                await session.stop().catch((error: unknown) => {
                  session.notify(t('toast.stopFailed', { reason: errorText(error, t) }), 'error');
                  throw error;
                });
              }}
            />
            <DockHint busy={slot.busy} />
          </div>
        </div>
      </section>
      {taskOpen && taskDetail !== null && (
        <TaskDrawer rpc={session.rpc} projectId={projectId} detail={taskDetail} onClose={() => setTaskOpen(false)} />
      )}
      {follow !== null && (
        <MemberDrawer
          rpc={session.rpc}
          projectId={projectId}
          sessionId={follow}
          label={sessions.find((row) => row.sessionId === follow)?.title || follow}
          onClose={() => setFollow(null)}
        />
      )}
    </div>
  );
}
