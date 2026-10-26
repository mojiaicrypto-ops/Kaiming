import type { MouseEvent } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import type { Route } from './router';
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
  /**
   * The project file viewer. It is a shell-level place, not something hidden in a dialog: reading a
   * project's files is a reason to open the workbench at all, so it gets a nav label next to the
   * other screens.
   */
  readonly onOpenFiles: () => void;
  /** The viewer is a canvas over the current screen: the label shows as current while it is open. */
  readonly filesOpen: boolean;
  /**
   * Every label goes through the shell's navigation, which first closes the file canvas: the canvas
   * covers the screen the user is leaving, so a plain route change would look like a dead click.
   */
  readonly onNavigate: (path: string) => void;
}

const NAV: ReadonlyArray<{
  view: Route['view'];
  path: string;
  key: 'nav.chat' | 'nav.requirements' | 'nav.settings';
  /** The phone form. Four words do not fit 320px; the glyph does, and the name stays in `title`. */
  glyph: string;
}> = [
  { view: 'chat', path: '/', key: 'nav.chat', glyph: '❯' },
  { view: 'requirements', path: '/requirements', key: 'nav.requirements', glyph: '▤' },
  { view: 'settings', path: '/settings/providers', key: 'nav.settings', glyph: '⚙' },
];

/**
 * The shell header: brand, project switcher, three navigation labels and the connection state.
 * Navigation is plain anchors so a middle-click or a copied address works; a same-origin click
 * is intercepted to keep the shell mounted.
 */
export function TopBar({ route, project, status, pendingQuestions, onOpenProject, onOpenRail, railOpen, onOpenFiles, filesOpen, onNavigate }: TopBarProps) {
  const { t } = useI18n();
  // 'idle' only exists before a session does, so it must not borrow the "connecting" word: nothing
  // is in progress, the workbench is waiting for the user to open a project or a session.
  const statusKey =
    status === 'idle'
      ? 'shell.noSession'
      : status === 'connected'
        ? 'shell.connected'
        : status === 'connecting'
          ? 'shell.connecting'
          : status === 'reconnecting'
            ? 'shell.reconnecting'
            : 'shell.offline';

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
            // While the file canvas is open it is the place the user is in, so only it looks
            // current: two selected labels would say the shell is in two places at once.
            aria-current={!filesOpen && route.view === entry.view ? 'page' : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onNavigate(entry.path);
            }}
          >
            {/* One word, two shapes: on a phone the word is swapped for its glyph by CSS, so the
                accessible name is always the word and nothing appears twice in the DOM. */}
            <span className="nav-word" data-glyph={entry.glyph}>
              {t(entry.key)}
            </span>
            {entry.view === 'chat' && pendingQuestions > 0 && <span className="n decide">◆{pendingQuestions}</span>}
          </a>
        ))}
        {/* A button, not a link: the viewer is a canvas over the current screen, so the address
            bar stays on the screen the user is already on. */}
        <button
          type="button"
          // The project must be open first: a listing of nothing is not a screen worth having.
          disabled={project === null}
          // Open is a location, so it says so the same way the screens do: the label is current.
          aria-current={filesOpen ? 'page' : undefined}
          onClick={onOpenFiles}
          data-testid="nav-files"
          title={project === null ? t('files.needProject') : t('files.browse')}
        >
          <span className="nav-word" data-glyph="▦">
            {t('nav.files')}
          </span>
        </button>
      </nav>
      <span className="sp" />
      {route.view === 'chat' && (
        <button
          type="button"
          className="rail-toggle"
          aria-expanded={railOpen}
          onClick={onOpenRail}
          data-testid="rail-toggle"
          title={t('aria.rail')}
        >
          {/* It opens the session list, so it says so: the nav label "Chat" belonged to a different
              control and read as a second, identical nav entry on a phone. The glyph is the
              visible form, the label is the accessible name. */}
          <span aria-hidden="true">≡</span>
          <span className="sr-only">{t('aria.rail')}</span>
        </button>
      )}
      {/* The connection is a state, and the shell's tests read it as one. The word already carries
          the state, so the chip adds no second glyph (the glyphless part of `.st`). */}
      <span data-testid="connection" data-state={status} className="st">
        <span className="long-label">{t(statusKey)}</span>
        <span className="short-label">{status === 'connected' ? '✓' : t(statusKey).slice(0, 1)}</span>
      </span>
    </header>
  );
}
