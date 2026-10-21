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

export function ToolRequirement({ status, resultText }: { status: 'running' | 'ok' | 'failed' | 'waiting'; resultText?: string | undefined }) {
  const { t } = useI18n();
  if (status !== 'ok' || resultText === undefined || !/saved/.test(resultText)) return null;
  const id = resultText.replace('saved ', '').trim();
  return (
    <div className="ev ok">
      <State kind="done">{t('tool.requirementSaved', { id })}</State>
    </div>
  );
}
