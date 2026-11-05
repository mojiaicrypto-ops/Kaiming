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
 * Usage: what the installation consumed, by role and by model, for one project or all.
 *
 * Layout follows the workbench's grammar rather than a spreadsheet: three headline figures (requests,
 * tokens, cost) answer "how much" without arithmetic, then two bordered panels answer "where". Each
 * panel repeats the same five columns and adds a share bar, because the question a reader actually
 * has is "who used most", and a bar answers it faster than comparing two numbers.
 *
 * The numbers are reported by the provider per response and recorded when each response completes,
 * so opening this page costs one aggregate query and never slows a conversation.
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
     * A delegated member can run for minutes and its row grows with every response. Reading once
     * would show a stale number that looks like "nothing is being counted", so the page rereads while
     * it is visible (the requirement board does the same) and stops when it is not.
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

  const totals = report?.totals ?? null;
  const tokens = (figures: Figures): number =>
    (figures.inputTokens ?? 0) + (figures.outputTokens ?? 0);
  const cache = (figures: Figures): number | null =>
    figures.cacheReadTokens === null && figures.cacheWriteTokens === null
      ? null
      : (figures.cacheReadTokens ?? 0) + (figures.cacheWriteTokens ?? 0);
  const totalTokens = totals === null ? 0 : tokens(totals);

  /** Share of the scope's tokens, for the bar. Null when there is nothing to divide by. */
  const share = (figures: Figures): number | null =>
    totalTokens === 0 ? null : Math.min(1, tokens(figures) / totalTokens);

  return (
    <section className="set-pane scroll">
      <div className="set-in">
        <h1>{t('usage.title')}</h1>
        <p className="f3">{t('usage.desc')}</p>
        <div className="set-body" data-testid="usage">
          <div className="usage-scope">
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
            {report !== null && (
              <span className="usage-scope-note">
                {report.scope === 'all' ? t('usage.scope.allHint') : t('usage.scope.projectHint')}
              </span>
            )}
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
              {/* Headline: three figures, read once. Everything finer lives in the panels below. */}
              <div className="usage-sum" data-testid="usage-totals">
                <Figure label={t('usage.requests')} value={format(totals.responses)} />
                <Figure label={t('usage.tokens')} value={format(totalTokens)} />
                <Figure
                  label={t('usage.cost')}
                  value={money(totals.costTotal, t('usage.unreported'))}
                  hint={t('usage.costHint')}
                />
                <div className="usage-sum-detail">
                  {[
                    `${t('usage.input')} ${figure(totals.inputTokens, t)}`,
                    `${t('usage.output')} ${figure(totals.outputTokens, t)}`,
                    `${t('usage.cache')} ${figure(cache(totals), t)}`,
                    `${t('usage.reasoning')} ${figure(totals.reasoningTokens, t)}`,
                  ].join(' · ')}
                </div>
              </div>

              <Panel
                title={t('usage.byRole')}
                count={report.byRole.length}
                empty={t('usage.empty')}
                testId="usage-by-role"
                head={t('usage.role')}
                rows={report.byRole.map((row) => ({
                  key: `role-${row.roleId}`,
                  label: t(`settings.role.${row.roleId}` as 'settings.role.chief'),
                  detail: null,
                  figures: row,
                  share: share(row),
                }))}
              />

              <Panel
                title={t('usage.byModel')}
                count={report.byModel.length}
                empty={t('usage.empty')}
                testId="usage-by-model"
                head={t('usage.model')}
                mono
                rows={report.byModel.map((row) => ({
                  key: `model-${row.providerId}-${row.modelId}`,
                  label: row.modelId,
                  detail: row.providerId,
                  figures: row,
                  share: share(row),
                }))}
              />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** One headline figure. The label is quiet, the number is not: that is the whole point of a summary. */
function Figure({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="usage-fig" {...(hint === undefined ? {} : { title: hint })}>
      <span className="usage-fig-v">{value}</span>
      <span className="usage-fig-l">{label}</span>
    </div>
  );
}

interface PanelRow {
  readonly key: string;
  readonly label: string;
  /** A quieter qualifier under/after the label (the provider id for a model row). */
  readonly detail: string | null;
  readonly figures: Figures;
  readonly share: number | null;
}

/**
 * One breakdown table.
 *
 * A real `<table>` rather than a grid: these are tabular data, and the header cells scope the columns
 * for a screen reader ("Requests, 2"). The five columns are the ones a reader compares; cache read and
 * write are summed here and kept apart in the row's tooltip, because splitting them across two columns
 * made the interesting numbers ("tokens", "cost") sit far apart with empty cells between.
 */
function Panel({
  title,
  count,
  empty,
  testId,
  head,
  mono = false,
  rows,
}: {
  title: string;
  count: number;
  empty: string;
  testId: string;
  head: string;
  mono?: boolean;
  rows: readonly PanelRow[];
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <section className="usage-panel">
      <div className="usage-panel-h">
        <span className="usage-panel-t">{title}</span>
        <span className="usage-panel-n">{t('usage.count', { count: String(count) })}</span>
      </div>
      {rows.length === 0 ? (
        <div className="note">{empty}</div>
      ) : (
        <table className={mono ? 'usage-tbl mono' : 'usage-tbl'} data-testid={testId}>
          <thead>
            <tr>
              <th scope="col">{head}</th>
              <th scope="col" className="usage-share-col" aria-label={t('usage.share')} />
              <th scope="col">{t('usage.requests')}</th>
              <th scope="col">{t('usage.input')}</th>
              <th scope="col">{t('usage.output')}</th>
              <th scope="col">{t('usage.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <span className="usage-name" title={row.label}>
                    {row.label}
                  </span>
                  {row.detail !== null && <span className="usage-sub">{row.detail}</span>}
                </th>
                <td className="usage-share-col">
                  <span
                    className="usage-bar"
                    title={`${t('usage.share')} ${row.share === null ? '—' : `${Math.round(row.share * 100)}%`}`}
                  >
                    <span
                      className="usage-bar-fill"
                      style={{ width: `${String(Math.round((row.share ?? 0) * 100))}%` }}
                    />
                  </span>
                </td>
                <td>{format(row.figures.responses)}</td>
                <td>{figure(row.figures.inputTokens, t)}</td>
                <td>{figure(row.figures.outputTokens, t)}</td>
                <td title={t('usage.costHint')}>{money(row.figures.costTotal, t('usage.unreported'))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** Counts are read at a glance: 1.2M and 480k, never 1200000. */
function format(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  return String(value);
}

/** A figure the provider may never have reported prints as a dash, not as a free request. */
function figure(value: number | null, t: (key: 'usage.unreported') => string): string {
  return value === null ? t('usage.unreported') : format(value);
}

function money(value: number | null, missing: string): string {
  if (value === null) return missing;
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}
