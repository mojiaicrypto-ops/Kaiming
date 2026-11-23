import { useI18n } from '../i18n/I18nProvider';
import { State } from './State';
import { ContextMeter } from './ContextMeter';
import type { ProjectSummary } from '../state/useWorkspace';
import type { ContextView, SandboxStatusView, SessionActivity } from '../api/stream';
import type { CompactionResult, ConnectionStatus } from '../state/useSession';

export interface StatusBarProps {
  readonly project: ProjectSummary | null;
  readonly runningMembers: number;
  readonly connection: ConnectionStatus;
  /** The live state of the open session: a stop in progress is a state, not a silent wait. */
  readonly activity: SessionActivity;
  /** The model the running input was claimed with; a settings change does not rewrite it. */
  readonly config: { providerId: string; modelId: string; source: string } | null;
  /** Live service sandbox state; shown even before the session runs an input. */
  readonly sandbox: SandboxStatusView | null;
  /** How full that model's context window is; null when the model declares no window. */
  readonly context: ContextView | null;
  /** Pi is summarizing the session; the manual action is disabled until it settles. */
  readonly compacting: boolean;
  readonly onCompact: () => Promise<CompactionResult>;
}

/**
 * The bottom line: where the work happens and what is running. It is deliberately sparse — the
 * project path, the branch, the live agent count and the keyboard hint — and every field is
 * clipped rather than wrapped, so the line never grows the shell.
 */
export function StatusBar({ project, runningMembers, connection, activity, config, sandbox, context, compacting, onCompact }: StatusBarProps) {
  const { t } = useI18n();
  return (
    <footer className="status">
      <span className="path" title={project?.realPath ?? ''}>
        {project?.realPath ?? t('shell.noProject')}
      </span>
      <span className="branch">⎇ {t('shell.branch')}</span>
      {runningMembers > 0 && <State kind="run">{t('shell.running', { count: runningMembers })}</State>}
      {activity === 'stopping' && <State kind="paused">{t('shell.stopping')}</State>}
      {config !== null && (
        <span className="f3 mono model" title={t('shell.configSource', { source: config.source })} data-testid="status-model">
          {config.providerId}/{config.modelId}
        </span>
      )}
      {sandbox !== null && (
        <span
          className="f3 mono sandbox"
          data-state={sandbox.active ? 'active' : 'inactive'}
          data-testid="status-sandbox"
          title={sandbox.reason ?? ''}
        >
          {sandbox.mode === 'off'
            ? t('shell.sandboxOff')
            : sandbox.active
              ? t('shell.sandboxActive', { mode: sandbox.mode })
              : t('shell.sandboxUnavailable')}
        </span>
      )}
      {context !== null && (
        <ContextMeter context={context} activity={activity} compacting={compacting} onCompact={onCompact} />
      )}
      <span className="sp" />
      {connection !== 'connected' && (
        <span className="conn" data-state={connection}>
          {connection === 'offline'
            ? t('shell.offline')
            : connection === 'reconnecting'
              ? t('shell.reconnecting')
              : connection === 'idle'
                ? t('shell.noSession')
                : t('shell.connecting')}
        </span>
      )}
      <span className="hint-key">{t('nav.hint', { n: '1/2/3' })}</span>
    </footer>
  );
}
