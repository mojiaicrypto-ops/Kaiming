import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RpcError } from '../api/rpc';
import { useI18n } from '../i18n/I18nProvider';
import { SessionsList } from './SessionsList';
import { useTier } from '../layout/useTier';
import { Transcript } from './Transcript';
import { Banner } from './Banner';
import { TaskStrip } from './TaskStrip';
import { TaskTodo } from './TaskTodo';
import { InteractionPanel, type AnswerState } from './InteractionPanel';
import { Composer, DockHint } from './Composer';
import { QueuedInputs } from './QueuedInputs';
import { EmptyState } from './EmptyState';
import { MemberDrawer } from './MemberDrawer';
import { TaskDrawer } from './TaskDrawer';
import { echoOf } from './interaction-model';
import { parseArgs } from './transcript-model';
import { createAutoscroll } from '../lib/scroll';
import { resolveLink } from '../files/link-target';
import type { ChiefSessionApi } from '../state/useSession';
import type { SessionRow } from '../state/useWorkspace';
import type { TaskMemberRow } from './task-labels';
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
  /** The project's absolute path: what an absolute link in a report is measured against. */
  readonly projectRealPath: string;
  readonly hasProject: boolean;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onCreateSession: () => void;
  readonly hasMoreSessions: boolean;
  /** Removes a settled session; resolves to whether it was removed. */
  readonly onCleanupSession: (sessionId: string, revision: number) => Promise<boolean>;
  /** Names a conversation; an empty title restores the derived one. */
  readonly onRenameSession: (sessionId: string, title: string, revision: number) => Promise<boolean>;
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
  /** Open one project file in the viewer: report links and evidence go through the same canvas. */
  readonly onOpenFile: (path: string) => void;
}

/**
 * The chat screen. Region order is the prototype's: banners, task strip, transcript, dock. The
 * transcript owns its own scroll-follow handle so that a streaming answer never yanks the view
 * away from a user who scrolled up (R5); the "back to latest" pill is the only way it moves you.
 */
export function ChatPage({ session, sessions, currentSessionId, projectId, projectRealPath, hasProject, onSelectSession, onCreateSession, hasMoreSessions, onLoadMoreSessions, onCleanupSession, onRenameSession, onAskChief, onNewSession, draft, onDraftConsumed, railOpen, onOpenRail, onOpenFile }: ChatPageProps) {
  // Below 861px the session rail is a sheet, not a column: CSS hides the column, so the sheet is
  // the only way to switch sessions there.
  const compact = useCompact();
  const { t } = useI18n();
  const { slot } = session;
  const txRef = useRef<HTMLDivElement | null>(null);
  const [scrollUi, setScrollUi] = useState<{ locked: boolean; showJumpButton: boolean; unseen: number }>({ locked: false, showJumpButton: false, unseen: 0 });
  const handleRef = useRef<ReturnType<typeof createAutoscroll> | null>(null);
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
    // The handle reports "how far has it grown since you left", which the trailing edge shows:
    // a static bar tells the reader the output is still coming, a count tells them how much.
    const handle = createAutoscroll(element, () => {
      setScrollUi({ locked: handle.locked, showJumpButton: handle.showJumpButton, unseen: handle.unseen });
    });
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

  // Growth changes scrollHeight without a user scroll: follow again. This is a LAYOUT effect on
  // purpose — it runs after React wrote the new content but before the browser paints, so a
  // streaming line never becomes visible one frame off the tail.
  useLayoutEffect(() => {
    handleRef.current?.followIfUnlocked();
  }, [slot.items, slot.busy]);

  const taskDetail: TaskDetail | null = slot.taskDetail;

  /**
   * A link in a message or a report is a reference to a file on this machine. It is resolved here,
   * once, for every place that shows text: absolute host paths inside the project open the viewer,
   * anything else says it cannot be opened rather than navigating the shell to a 404.
   */
  const openLink = useCallback(
    (href: string): void => {
      const target = resolveLink(href, projectRealPath);
      if (target.kind === 'project') {
        onOpenFile(target.path);
        return;
      }
      if (target.kind === 'outside') {
        session.notify(t('files.outside'), 'error');
        return;
      }
      if (target.kind === 'external') window.open(target.href, '_blank', 'noopener,noreferrer');
    },
    [projectRealPath, onOpenFile, session, t],
  );

  /**
   * The running Task must be visible in the conversation, and after a reload the dispatch card is
   * not there yet: while the chief waits inside that tool call, the assistant message holding it has
   * not ended, so nothing is in history to render. This block fills exactly that gap, and steps
   * aside as soon as a dispatch card names one of the same members.
   */
  const liveSessionIds = useMemo(() => {
    const detail = taskDetail;
    if (detail === null) return new Set<string>();
    // "Still working" is not the same as the live activity flag: a member whose input is processing
    // can read as idle between events. What settles it is the assignment's own status.
    const settled = new Set(['completed', 'failed', 'stopped', 'interrupted']);
    return new Set(
      detail.members
        .filter((member) => {
          if (member.activity === 'processing' || member.activity === 'queued') return true;
          return member.lastInputStatus !== null && member.lastInputStatus !== undefined
            ? !settled.has(member.lastInputStatus)
            : false;
        })
        .map((member) => member.sessionId),
    );
  }, [taskDetail]);

  /**
   * The plan the chief wrote at create time, taken from the newest `task create` call in the
   * transcript: the task list's header offers "N 行 Plan" behind a disclosure, and the source
   * of truth is the call the model actually made (the Task row only keeps a file reference).
   */
  const taskPlan = useMemo(() => {
    let plan: string | undefined;
    for (const item of slot.items) {
      for (const block of item.content) {
        if (block.type !== 'toolCall' || block.name !== 'task') continue;
        const parsed = parseArgs(block.arguments ?? '');
        if (parsed?.['op'] === 'create' && typeof parsed['planMarkdown'] === 'string') {
          plan = parsed['planMarkdown'];
        }
      }
    }
    return plan;
  }, [slot.items]);

  /**
   * The running Task's roster block: rendered whenever a Task is live, independent of the
   * transcript. The dispatch cards are history now (one line each), so this list is the only
   * place live member state exists — including after a reload, when no dispatch call is in
   * history yet because the chief is still waiting inside it.
   */
  const liveRun = useMemo(() => {
    const detail = taskDetail;
    if (detail === null) return null;
    return detail.task.status === 'active' ||
      detail.task.status === 'waiting' ||
      detail.task.status === 'pausing' ||
      detail.task.status === 'paused'
      ? detail
      : null;
  }, [taskDetail]);

  // A member is not in the rail any more, so the dispatch card in the transcript and the drawer it
  // opens are where its name comes from: the role and the label the chief gave the assignment.
  // The row clicked in a dispatch card carries what it knows about its member; the Task's live
  // detail fills in the rest. Without this the drawer can only name the member after a poll.
  const [followedRow, setFollowedRow] = useState<TaskMemberRow | null>(null);
  const followMember = useCallback(
    (row: TaskMemberRow): void => {
      setFollowedRow(row);
      setFollow(row.sessionId);
    },
    [],
  );
  const memberOf = useCallback(
    (sessionId: string): TaskDetail['members'][number] | undefined =>
      taskDetail?.members.find((entry) => entry.sessionId === sessionId),
    [taskDetail],
  );
  const memberLabel = useCallback(
    (sessionId: string): string => {
      const member = memberOf(sessionId);
      // A card's own row names the member before the Task detail has caught up.
      if (member === undefined) return followedRow?.sessionId === sessionId ? followedRow.label : sessionId;
      return member.label === '' || member.label === member.roleId
        ? t(`chat.role.${member.roleId}` as 'chat.role.member')
        : `${t(`chat.role.${member.roleId}` as 'chat.role.member')} · ${member.label}`;
    },
    [memberOf, followedRow, t],
  );
  /**
   * One row per member, with what the design shows beside the name: the report it delivered, the
   * question it is waiting on, or the phase it is working in. Keeping the sentence here (not in the
   * row component) lets the dispatch card and the live block read identically.
   */
  const members: readonly TaskMemberRow[] = useMemo(() => {
    const detail = taskDetail;
    if (detail === null) return [];
    const phaseLabel = (phase: string): string => t(`task.${phase}` as 'task.plan');
    return detail.members.map((member) => {
      const roleName = t(`chat.role.${member.roleId}` as 'chat.role.member');
      const activity = member.activity ?? 'idle';
      const lastInputStatus = member.lastInputStatus ?? null;
      // A member is waiting on the user only while it really holds a pending question; an idle
      // assignment that already delivered its report is done, not waiting.
      const question = slot.pending.find(
        (entry) => entry.sourceSessionId === member.sessionId && entry.resolved !== true,
      );
      const waitingUser = question !== undefined;
      const report = [...detail.results].reverse().find((entry) => entry.sessionId === member.sessionId && entry.summary);
      // The latest report (save order, reversed) decides whether a finished input counts as a pass.
      const latest = [...detail.results].reverse().find((entry) => entry.sessionId === member.sessionId);
      const note =
        waitingUser && question !== undefined
          ? t('task.note.asking', { title: question.title })
          : report !== undefined && lastInputStatus === 'completed'
            ? t('task.note.report', { summary: report.summary ?? '' })
            : activity === 'processing' && phaseLabel(member.phase) !== roleName
              ? // A settler working in Settle says nothing twice: the role already names the step.
                t('task.note.working', { phase: phaseLabel(member.phase) })
              : '';
      return {
        sessionId: member.sessionId,
        phase: member.phase,
        // The design's row names the role; the assignment is the fallback note, so a long title
        // cannot squeeze the role out of its column.
        label: roleName,
        assignment: member.label === '' || member.label === member.roleId ? '' : member.label,
        activity,
        lastInputStatus,
        reportMissing: member.reportMissing === true,
        latestVerdict: latest?.verdict ?? null,
        waitingUser,
        note,
      };
    });
  }, [taskDetail, slot.pending, t]);

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
      // Sending is a statement of intent to watch the answer: whatever the reader was looking
      // at, the view goes (and stays) at the tail from here.
      handleRef.current?.pinToTail();
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
            onRename={onRenameSession}
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
          onRename={onRenameSession}
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
          onOpenTask={() => setTaskOpen(true)}
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
            {slot.items.length === 0 && slot.pendingEcho === null ? (
              <EmptyState hasProject={hasProject} onExample={(text) => void submit(text, [])} />
            ) : (
              <Transcript
                items={slot.items}
                busy={slot.busy}
                echo={slot.pendingEcho ?? undefined}
                variant="chief"
                members={members}
                liveSessions={liveSessionIds}
                onFollow={(sessionId) => {
                  const row = members.find((entry) => entry.sessionId === sessionId);
                  if (row === undefined) setFollow(sessionId);
                  else followMember(row);
                }}
                onLink={openLink}
              />
            )}
            {/* Outside the transcript switch: a Task can be running before any message is stored. */}
            {liveRun !== null && (
              <TaskTodo
                detail={liveRun}
                members={members}
                pendingQuestions={openQuestions.length}
                planMarkdown={taskPlan}
                onFollow={(sessionId) => {
                  const row = members.find((entry) => entry.sessionId === sessionId);
                  if (row === undefined) setFollow(sessionId);
                  else followMember(row);
                }}
                onOpenTask={() => setTaskOpen(true)}
              />
            )}
          </div>
        </div>
        <div className="dock">
          <div className="dock-in">
            {scrollUi.showJumpButton && (
              <button
                type="button"
                className={`jump${scrollUi.unseen > 0 ? ' more' : ''}`}
                onClick={() => handleRef.current?.jumpToBottom()}
                data-testid="jump-tail"
              >
                {t('chat.jump')}
                {scrollUi.unseen > 0 ? <span className="n">{t('chat.jumpMore', { count: Math.max(1, Math.round(scrollUi.unseen / 120)) })}</span> : undefined}
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
              onReleaseSight={() => handleRef.current?.pinToTail()}
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
        <TaskDrawer
          rpc={session.rpc}
          projectId={projectId}
          detail={taskDetail}
          onOpenFile={onOpenFile}
          projectRealPath={projectRealPath}
          onOutside={() => session.notify(t('files.outside'), 'error')}
          onClose={() => setTaskOpen(false)}
        />
      )}
      {follow !== null && (
        <MemberDrawer
          rpc={session.rpc}
          projectId={projectId}
          sessionId={follow}
          label={memberLabel(follow)}
          phaseLabel={memberOf(follow)?.phase ?? (followedRow?.note === '' ? undefined : followedRow?.note)}
          expectedKind={memberOf(follow)?.expectedKind}
          onClose={() => setFollow(null)}
        />
      )}
    </div>
  );
}
