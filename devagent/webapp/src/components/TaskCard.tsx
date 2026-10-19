import { useEffect, useState } from 'react';
import type { TaskDetail, TaskMember } from '../state/slot';

interface Props {
  detail: TaskDetail | null;
  visible: boolean;
  onOpenMember: (sessionId: string, label: string) => void;
  onRefresh: () => Promise<TaskDetail | null>;
}

/**
 * Inline Task card (D-06): the members of the current step with role, label, phase and live
 * state. Polls task.get while visible (3s) — the server does not yet push task invalidations
 * to the chief stream; that gap is registered in the plan and is a later package.
 */
export function TaskCard({ detail, visible, onOpenMember, onRefresh }: Props) {
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const poll = (): void => {
      onRefresh().catch(() => setRefreshFailed(true));
    };
    void poll();
    const timer = setInterval(poll, 3_000);
    return () => clearInterval(timer);
  }, [visible, onRefresh]);

  // The invalidate frame arrives before the first task.get answers: show a skeleton, not void.
  if (detail === null) {
    return (
      <details className="task-card task-card-loading" open>
        <summary>
          <span className="task-kind">task</span>
          <span className="task-phase">加载中…</span>
          <span className="task-status task-running">loading</span>
        </summary>
      </details>
    );
  }
  return (
    <details className="task-card" data-task-id={detail.task.taskId} open>
      <summary>
        <span className="task-kind">{detail.task.type} task</span>
        <span className="task-phase">{detail.task.phase}</span>
        <span className={`task-status task-${detail.task.status}`}>{detail.task.status}</span>
        <span className="task-results">{detail.results.length} result(s)</span>
        {(() => {
          const working = detail.members.filter((m) => (m.activity ?? 'idle') === 'processing').length;
          const queued = detail.members.reduce((sum, m) => sum + (m.queuedInputs ?? 0), 0);
          if (working > 0 || queued > 0) {
            return (
              <span className="task-live">
                {working > 0 && <span className="task-live-working">{working} 个成员正在运行</span>}
                {queued > 0 && <span className="task-live-queued">{queued} 个排队输入</span>}
              </span>
            );
          }
          return null;
        })()}
        {refreshFailed && <span className="task-refresh-failed" title="task.get 最近一次刷新失败，稍后自动重试">刷新失败</span>}
      </summary>
      <div className="task-members">
        {detail.members.length === 0 && <p className="task-empty">当前步骤还没有成员会话。</p>}
        {detail.members.map((member) => (
          <MemberRow key={member.sessionId} member={member} onOpenMember={onOpenMember} />
        ))}
      </div>
    </details>
  );
}

/**
 * Member row: state derives from the live session activity (task.get enrichment, R2) —
 * `working` means the member is running right now, `queued` means work is waiting, `idle`
 * means this member has nothing in flight. The delegation-time `currentInputId` alone would
 * show every ever-delegated member as permanently active.
 */
function MemberRow({ member, onOpenMember }: { member: TaskMember; onOpenMember: (sessionId: string, label: string) => void }) {
  const activity = member.activity ?? 'idle';
  const active = activity === 'processing';
  const queued = member.queuedInputs ?? 0;
  const last = member.lastInputStatus ?? null;
  // idle means "no run in flight"; the last-input status says HOW the assignment ended.
  const stateText =
    active
      ? 'working'
      : activity === 'queued'
        ? `queued (${queued})`
        : last === 'completed'
          ? 'done'
          : last === 'failed'
            ? 'failed'
            : last === 'interrupted'
              ? 'interrupted'
              : last === 'stopped'
                ? 'stopped'
                : 'idle';
  const stateClass =
    active ? 'active' : activity === 'queued' ? 'queued' : last === 'completed' ? 'done' : last === 'failed' || last === 'interrupted' ? 'failed' : 'idle';
  return (
    <button type="button" className={`member-row member-${active ? 'processing' : activity}`} onClick={() => onOpenMember(member.sessionId, member.label)}>
      <span className={`member-dot${active ? ' member-dot-live' : last === 'completed' ? ' member-dot-done' : ''}`} aria-hidden />
      <span className="member-role">{member.roleId}</span>
      <span className="member-label">{member.label}</span>
      <span className="member-phase">{member.phase}</span>
      <span className="member-kind">{member.expectedKind}</span>
      <span className={`member-state member-${stateClass}`}>
        {stateText}
        {active && <span className="member-live-note">· 正在运行</span>}
      </span>
      <span className="member-open">跟随 ›</span>
    </button>
  );
}
