import type { MouseEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { navigate, type Route } from './router';
import { State } from './State';
import type { ConnectionStatus } from '../state/useSession';
import type { ProjectSummary } from '../state/useWorkspace';

export interface TopBarProps {
  readonly route: Route;
  readonly project: ProjectSummary | null;
  readonly status: ConnectionStatus;
  readonly pendingQuestions: number;
  readonly onOpenProject: () => void;
  readonly onOpenRail: () => void;
  readonly railOpen: boolean;
}

const NAV: ReadonlyArray<{ view: Route['view']; path: string; key: 'nav.chat' | 'nav.requirements' | 'nav.settings' }> = [
  { view: 'chat', path: '/', key: 'nav.chat' },
  { view: 'requirements', path: '/requirements', key: 'nav.requirements' },
  { view: 'settings', path: '/settings/providers', key: 'nav.settings' },
];

/**
 * The shell header: brand, project switcher, three navigation labels and the connection state.
 * Navigation is plain anchors so a middle-click or a copied address works; a same-origin click
 * is intercepted to keep the shell mounted.
 */
export function TopBar({ route, project, status, pendingQuestions, onOpenProject, onOpenRail, railOpen }: TopBarProps) {
  const { t } = useI18n();
  const statusKey =
    status === 'connected' ? 'shell.connected' : status === 'connecting' ? 'shell.connecting' : status === 'reconnecting' ? 'shell.reconnecting' : 'shell.offline';
  const statusKind = status === 'connected' ? 'done' : status === 'offline' ? 'block' : 'run';

  return (
    <header className="top">
      <span className="brand">AgentDev</span>
      <button
        type="button"
        className="proj"
        title={t('shell.project')}
        onClick={onOpenProject}
        data-testid="project-switcher"
      >
        <b>{project?.realPath.split('/').filter(Boolean).pop() ?? t('shell.noProject')}</b> <span className="f3 caret">▾</span>
      </button>
      <nav className="nav" aria-label={t('aria.nav')}>
        {NAV.map((entry) => (
          <a
            key={entry.view}
            href={entry.path}
            aria-current={route.view === entry.view ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              navigate(entry.path);
            }}
          >
            {t(entry.key)}
            {entry.view === 'chat' && pendingQuestions > 0 && <span className="n decide">◆{pendingQuestions}</span>}
          </a>
        ))}
      </nav>
      <span className="sp" />
      {route.view === 'chat' && (
        <button
          type="button"
          className="rail-toggle"
          aria-expanded={railOpen}
          onClick={onOpenRail}
          data-testid="rail-toggle"
        >
          {t('nav.chat')}
        </button>
      )}
      {/* The connection is a state, and the shell's tests read it as one. */}
      <span data-testid="connection" data-state={status}>
        <State kind={statusKind}>
          <span className="long-label">{t(statusKey)}</span>
          <span className="short-label">{status === 'connected' ? '✓' : t(statusKey).slice(0, 1)}</span>
        </State>
      </span>
    </header>
  );
}
