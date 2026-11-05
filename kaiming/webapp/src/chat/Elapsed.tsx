import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { elapsed } from './transcript-model';

export interface ElapsedProps {
  /** Delivery/creation time. Missing means the work never started, so there is no duration. */
  readonly startedAt?: string | null;
  /** Settled time. Null with a start means the work is still running. */
  readonly endedAt?: string | null;
  readonly className?: string;
  readonly testId?: string;
}

function timestamp(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * One execution duration, updated once a second only while it is really running. Keeping the
 * ticker inside the number (not in the task transcript) means a live Task does not re-render its
 * plan or member list every second.
 */
export function Elapsed({ startedAt, endedAt, className, testId }: ElapsedProps) {
  const { t } = useI18n();
  const start = timestamp(startedAt);
  const end = timestamp(endedAt);
  const running = start !== null && end === null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (start === null) return null;
  const finish = end ?? now;
  const title = end === null
    ? t('task.elapsedRunning', { started: clock(start) })
    : t('task.elapsedStopped', { started: clock(start), ended: clock(finish) });
  return (
    <span className={className ?? 'f3 mono'} title={title} data-testid={testId}>
      {elapsed(Math.max(0, finish - start))}
    </span>
  );
}
