import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { parseArgs } from './transcript-model';

export function ToolQuestion({ args, answered, echo }: { args: string; answered: boolean; echo?: string | undefined }) {
  const { t } = useI18n();
  const parsed = parseArgs(args) ?? {};
  const title = typeof parsed['title'] === 'string' ? parsed['title'] : '';
  return (
    <div className={`askline${answered ? ' ok' : ''}`}>
      <State kind={answered ? 'done' : 'decide'} />
      <span>{t('tool.question', { title })}</span>
      <span className="sp" />
      <span className={answered ? 'f3' : ''}>
        {answered ? t('tool.answered', { echo: echo === '' ? t('ask.answerReceived', { echo: '—' }) : `"${echo}"` }) : t('tool.waitingAnswer')}
      </span>
    </div>
  );
}

export function ToolReport({ args, status, resultText }: { args: string; status: 'running' | 'ok' | 'failed' | 'waiting'; resultText?: string | undefined }) {
  const { t } = useI18n();
  const parsed = parseArgs(args) ?? {};
  const verdict = typeof parsed['verdict'] === 'string' ? parsed['verdict'] : '';
  const passed = verdict === 'passed';
  const failed = verdict === 'failed';
  const summary = typeof parsed['summary'] === 'string' ? parsed['summary'] : '';
  return (
    <div className={`rep${passed ? ' done' : failed ? ' block' : ''}`}>
      <div className="row">
        <b>{t('tool.report')}</b>
        {verdict !== '' && <State kind={passed ? 'done' : 'block'}>{passed ? t('tool.passed') : t('tool.notPassed')}</State>}
        <span className="f2">{summary}</span>
        <span className="sp" />
        <span className="f3 ell">{status === 'ok' ? (resultText ?? '') : t('tool.saving')}</span>
      </div>
    </div>
  );
}


/**
 * A backlog write is one line of text ("已记为 B-12" / "已关闭 B-12"): the item itself lives on the
 * project page, so the transcript only needs to say what happened and which entry it was.
 */
export function ToolBacklog({ status, resultText }: { status: 'running' | 'ok' | 'failed' | 'waiting'; resultText?: string | undefined }) {
  const { t } = useI18n();
  if (status !== 'ok' || resultText === undefined) return null;
  const saved = /已记为\s+(\S+)/.exec(resultText);
  const closed = /已关闭\s+(\S+)/.exec(resultText);
  if (saved === null && closed === null) return null;
  return (
    <div className="ev ok">
      <State kind="done">
        {saved !== null
          ? t('tool.backlogSaved', { id: saved[1] ?? '' })
          : t('tool.backlogClosed', { id: closed?.[1] ?? '' })}
      </State>
    </div>
  );
}
