import { useI18n } from '../i18n/I18nProvider';
import { State } from './State';
import type { ProjectSummary } from '../state/useWorkspace';

export interface StatusBarProps {
  readonly project: ProjectSummary | null;
  readonly runningMembers: number;
  readonly connection: 'connecting' | 'connected' | 'reconnecting' | 'offline';
}

/**
 * The bottom line: where the work happens and what is running. It is deliberately sparse — the
 * project path, the branch, the live agent count and the keyboard hint — and every field is
 * clipped rather than wrapped, so the line never grows the shell.
 */
export function StatusBar({ project, runningMembers, connection }: StatusBarProps) {
  const { t } = useI18n();
  return (
    <footer className="status">
      <span className="path" title={project?.realPath ?? ''}>
        {project?.realPath ?? t('shell.noProject')}
      </span>
      <span>⎇ {t('shell.branch')}</span>
      {runningMembers > 0 && <State kind="run">{t('shell.running', { count: runningMembers })}</State>}
      <span className="sp" />
      {connection !== 'connected' && (
        <span className="conn">
          {connection === 'offline' ? t('shell.offline') : connection === 'reconnecting' ? t('shell.reconnecting') : t('shell.connecting')}
        </span>
      )}
      <span className="hint-key">{t('nav.hint', { n: '1/2/3' })}</span>
    </footer>
  );
}
