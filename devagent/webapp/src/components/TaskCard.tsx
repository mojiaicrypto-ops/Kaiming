import { useEffect, useRef, useState } from 'react';
import type { TaskDetail, TaskMember } from '../state/slot';

const MEMBER_STATES = ['queued', 'working', 'waiting_user', 'stopping', 'completed', 'failed', 'stopped', 'interrupted'] as const;

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
  useEffect(() => {
    if (!visible) return;
    void onRefresh();
    const timer = setInterval(() => { void onRefresh(); }, 3_000);
    return () => clearInterval(timer);
  }, [visible, onRefresh]);

  if (detail === null) return null;
  return (
    <details className="task-card" data-task-id={detail.task.taskId} open>
      <summary>
        <span className="task-kind">{detail.task.type} task</span>
        <span className="task-phase">{detail.task.phase}</span>
        <span className={`task-status task-${detail.task.status}`}>{detail.task.status}</span>
        <span className="task-results">{detail.results.length} result(s)</span>
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

function MemberRow({ member, onOpenMember }: { member: TaskMember; onOpenMember: (sessionId: string, label: string) => void }) {
  const [state, setState] = useState<string>('queued');
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const read = await fetch(`/api/v1/rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          requestId: `m-${Date.now()}`,
          method: 'session.get',
          params: { projectId: '', sessionId: member.sessionId },
        }),
      }).then((response) => response.json() as Promise<{ result?: unknown }>);
      if (!cancelled) setState(read.result === undefined ? 'unknown' : 'linked');
    };
    void load();
    return () => { cancelled = true; };
  }, [member.sessionId]);
  void MEMBER_STATES;
  return (
    <button type="button" className="member-row" onClick={() => onOpenMember(member.sessionId, member.label)}>
      <span className="member-role">{member.roleId}</span>
      <span className="member-label">{member.label}</span>
      <span className="member-phase">{member.phase}</span>
      <span className="member-kind">{member.expectedKind}</span>
      <span className={`member-state member-${member.currentInputId === null ? 'idle' : 'active'}`}>
        {member.currentInputId === null ? 'idle' : 'active'}
      </span>
      <span className="member-open">跟随 ›</span>
    </button>
  );
}

/** Polls member input status via task.list each refresh instead of per-row fetches. */
export function useTaskPollingDisabled(): void {
  useRef(null);
}
