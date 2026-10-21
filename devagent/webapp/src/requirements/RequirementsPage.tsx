import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { RequirementDrawer } from './RequirementDrawer';
import { columnOf, useRequirements, type Column, type RequirementSummary } from './requirement-model';
import type { RpcClient } from '../api/rpc';

export interface RequirementsPageProps {
  readonly rpc: RpcClient;
  readonly projectId: string;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onNotice: (message: string, kind: 'info' | 'success' | 'error') => void;
}

const COLUMNS: ReadonlyArray<{ column: Column; key: 'req.col.proposal' | 'req.col.todo' | 'req.col.doing' | 'req.col.done'; glyph: 'idle' | 'wait' | 'run' | 'done' }> = [
  { column: 'proposal', key: 'req.col.proposal', glyph: 'idle' },
  { column: 'todo', key: 'req.col.todo', glyph: 'wait' },
  { column: 'doing', key: 'req.col.doing', glyph: 'run' },
  { column: 'done', key: 'req.col.done', glyph: 'done' },
];

/** Card status word, from the record itself: the board never invents a fifth state. */
function cardState(card: RequirementSummary): { glyph: 'idle' | 'wait' | 'run' | 'done' | 'block'; key: 'req.state.idle' | 'req.state.todo' | 'req.state.done' | 'req.state.paused' } {
  if (card.status === 'completed') return { glyph: 'done', key: 'req.state.done' };
  if (card.status === 'in_progress') return { glyph: 'run', key: 'req.state.todo' };
  if (card.status === 'cancelled' || card.status === 'archived') return { glyph: 'block', key: 'req.state.paused' };
  if (card.kind === 'proposal') return { glyph: 'idle', key: 'req.state.idle' };
  return { glyph: 'wait', key: 'req.state.todo' };
}

/**
 * The requirement board: four columns that are views of one record set, a notice for files that
 * could not be parsed (kept visible — a silently dropped requirement is worse than a warning),
 * and a drawer with the record's own sections.
 */
export function RequirementsPage({ rpc, projectId, selected, onSelect, onNotice }: RequirementsPageProps) {
  const { t } = useI18n();
  const { items, invalid, loading, error, reload } = useRequirements(rpc, projectId);
  const invalidSelection = selected !== null && selected.startsWith('invalid:') ? selected.slice('invalid:'.length) : null;
  const card = selected === null ? undefined : items.find((item) => item.id === selected);

  return (
    <section className="page">
      <div className="page-h">
        <h1>{t('req.title')}</h1>
        <span className="f3">{t('req.subtitle')}</span>
        <span className="sp" />
        <button type="button" className="btn ghost" onClick={() => void reload()}>
          {t('common.retry')}
        </button>
      </div>
      {error !== null && (
        <div className="notice">
          <State kind="block">{t('req.readFailed', { reason: error })}</State>
        </div>
      )}
      {invalid.length > 0 && (
        <div className="notice">
          <State kind="block">{t('req.invalid', { path: invalid[0]?.file ?? '' })}</State>
          <span className="sp" />
          <button type="button" className="lnk" onClick={() => onSelect(`invalid:${invalid[0]?.file ?? ''}`)}>
            {t('req.invalidView')}
          </button>
        </div>
      )}
      <div className="board" data-testid="board">
        {COLUMNS.map((entry) => {
          const cards = items.filter((item) => columnOf(item) === entry.column);
          return (
            <div className="colm" key={entry.column}>
              <div className="ch">
                {t(entry.key)}
                <span className="n">{cards.length}</span>
              </div>
              <div className="cards scroll">
                {cards.length === 0 && <div className="none">{t('req.none')}</div>}
                {cards.map((item) => {
                  const state = cardState(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className="rc"
                      aria-selected={selected === item.id}
                      onClick={() => onSelect(item.id)}
                      data-testid="requirement-card"
                    >
                      <span className="id">{item.id}</span>
                      <span className="tt">{item.title}</span>
                      <span className="mt">
                        <State kind={state.glyph}>{t(state.key)}</State>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {loading && (
        <div className="none f3" style={{ padding: '0 var(--s8)' }}>
          {t('common.loading')}
        </div>
      )}
      {selected !== null && (
        <RequirementDrawer
          rpc={rpc}
          projectId={projectId}
          card={card}
          invalid={invalid.find((entry) => entry.file === invalidSelection)}
          invalidFile={invalidSelection}
          onClose={() => onSelect(null)}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}
