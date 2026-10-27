import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { errorText } from '../lib/errors';
import type { RpcClient } from '../api/rpc';

/** One slice of the ledger: every figure but `responses` is null when nothing was reported. */
interface Figures {
  readonly responses: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly costTotal: number | null;
}

interface Report {
  readonly scope: 'project' | 'all';
  readonly totals: Figures;
  readonly byRole: ReadonlyArray<Figures & { readonly roleId: string }>;
  readonly byModel: ReadonlyArray<Figures & { readonly providerId: string; readonly modelId: string }>;
}

/**
 * Usage: what the installation actually consumed, by role and by model, for one project or all.
 *
 * The numbers are reported by the provider per response; the ledger behind this page is written once
 * per finished input, so opening it costs one aggregate query and never slows the conversation. A
 * figure that was never reported stays empty — a request whose price is unknown is not a free one.
 */
export function UsagePage({ rpc, projectId }: { rpc: RpcClient; projectId: string }): React.JSX.Element {
  const { t } = useI18n();
  const [scope, setScope] = useState<'project' | 'all'>(projectId === '' ? 'all' : 'project');
  const [report, setReport] = useState<Report | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailure(null);
    const params = scope === 'project' && projectId !== '' ? { projectId } : {};
    const read = (): void => {
      void rpc
        .call<Report>('usage.report', params)
        .then((next) => {
          if (!cancelled) setReport(next);
        })
        .catch((error: unknown) => {
          if (!cancelled) setFailure(errorText(error, t));
        });
    };
    read();
    /*
     * A delegated member can run for minutes, and its ledger row grows with every response. Reading
     * once would show a stale number that looks like "nothing is being counted", so the page rereads
     * while it is visible (the requirement board does the same) and stops the moment it is not.
     */
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, 10_000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rpc, scope, projectId, t]);

  const count = (value: number | null): string => (value === null ? t('usage.unreported') : compact(value));
  const cost = (value: number | null): string =>
    value === null ? t('usage.unreported') : `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;

  const totals = report?.totals ?? null;

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('usage.title')}</h1>
        <p className="f3">{t('usage.desc')}</p>
        <div className="set-body" data-testid="usage">
          <div className="row" style={{ marginBottom: 'var(--s4)' }}>
            <span className="seg">
              <button
                type="button"
                aria-pressed={scope === 'project'}
                onClick={() => setScope('project')}
                disabled={projectId === ''}
                data-testid="usage-scope-project"
              >
                {t('usage.scope.project')}
              </button>
              <button
                type="button"
                aria-pressed={scope === 'all'}
                onClick={() => setScope('all')}
                data-testid="usage-scope-all"
              >
                {t('usage.scope.all')}
              </button>
            </span>
          </div>

          {failure !== null && (
            <div className="st block" data-testid="usage-failed">
              {failure}
            </div>
          )}

          {failure === null && totals !== null && totals.responses === 0 && (
            <div className="note" data-testid="usage-empty">
              {t('usage.empty')}
            </div>
          )}

          {failure === null && report !== null && totals !== null && totals.responses > 0 && (
            <>
              {/* The totals row is the page's headline: same columns as the tables below, so a row can
                  be read against it without arithmetic. */}
              <div className="usage-grid" data-testid="usage-totals">
                <Head />
                <span className="ut" data-col="label">
                  {t('usage.total')}
                </span>
                <span data-col="requests">{compact(totals.responses)}</span>
                <span data-col="input">{count(totals.inputTokens)}</span>
                <span data-col="output">{count(totals.outputTokens)}</span>
                <span data-col="cacheRead">{count(totals.cacheReadTokens)}</span>
                <span data-col="cacheWrite">{count(totals.cacheWriteTokens)}</span>
                <span data-col="reasoning">{count(totals.reasoningTokens)}</span>
                <span title={t('usage.costHint')} data-col="cost">
                  {cost(totals.costTotal)}
                </span>
              </div>

              <div className="usage-split">
                <div>
                  <div className="f3 usage-h">{t('usage.byRole')}</div>
                  <div className="usage-grid" data-testid="usage-by-role">
                    <Head />
                    {report.byRole.length === 0 && <span className="ut">{t('usage.empty')}</span>}
                    {report.byRole.map((row) => (
                      <Row
                        key={`role-${row.roleId}`}
                        label={t(`settings.role.${row.roleId}` as 'settings.role.chief')}
                        figures={row}
                        count={count}
                        cost={cost}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="f3 usage-h">{t('usage.byModel')}</div>
                  <div className="usage-grid mono" data-testid="usage-by-model">
                    <Head />
                    {report.byModel.length === 0 && <span className="ut">{t('usage.empty')}</span>}
                    {report.byModel.map((row) => (
                      <Row
                        key={`model-${row.providerId}-${row.modelId}`}
                        label={`${row.providerId}/${row.modelId}`}
                        figures={row}
                        count={count}
                        cost={cost}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** The column headings every table repeats: three tables, one set of columns, no cross-referencing. */
function Head({ label }: { label?: string } = {}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <>
      <span className="uh ul" data-col="label">
        {label ?? ''}
      </span>
      <span className="uh" data-col="requests">
        {t('usage.requests')}
      </span>
      <span className="uh" data-col="input">
        {t('usage.input')}
      </span>
      <span className="uh" data-col="output">
        {t('usage.output')}
      </span>
      <span className="uh" data-col="cacheRead">
        {t('usage.cacheRead')}
      </span>
      <span className="uh" data-col="cacheWrite">
        {t('usage.cacheWrite')}
      </span>
      <span className="uh" data-col="reasoning">
        {t('usage.reasoning')}
      </span>
      <span className="uh" data-col="cost">
        {t('usage.cost')}
      </span>
      {/* One rule for the whole row: per-cell borders leave a stray segment under the empty label
          column, which reads as a broken table. */}
      <span className="uh-rule" aria-hidden="true" />
    </>
  );
}

/** One ledger slice. `count`/`cost` format a figure, so both tables read identically. */
function Row({
  label,
  figures,
  count,
  cost,
}: {
  label: string;
  figures: Figures;
  count: (value: number | null) => string;
  cost: (value: number | null) => string;
}): React.JSX.Element {
  return (
    <>
      <span className="ur" title={label} data-col="label">
        {label}
      </span>
      <span data-col="requests">{compact(figures.responses)}</span>
      <span data-col="input">{count(figures.inputTokens)}</span>
      <span data-col="output">{count(figures.outputTokens)}</span>
      <span data-col="cacheRead">{count(figures.cacheReadTokens)}</span>
      <span data-col="cacheWrite">{count(figures.cacheWriteTokens)}</span>
      <span data-col="reasoning">{count(figures.reasoningTokens)}</span>
      <span data-col="cost">{cost(figures.costTotal)}</span>
    </>
  );
}

/** Counts are read at a glance: 1.2M and 480k, never 1200000. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(value);
}
