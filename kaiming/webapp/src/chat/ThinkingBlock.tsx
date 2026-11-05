import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';

export interface ThinkingBlockProps {
  readonly text: string;
  readonly live: boolean;
}

/**
 * Reasoning is present but never shouting: while it streams the summary shows the tail (that is
 * where the current thought is) with a running glyph; once finished it collapses to a count, so a
 * long deliberation costs one line in the transcript (C5/C6).
 */
export function ThinkingBlock({ text, live }: ThinkingBlockProps) {
  const { t } = useI18n();
  const tail = text.slice(-50).replace(/\s+/g, ' ');
  return (
    <details className={`think${live ? ' live' : ''}`}>
      <summary>
        {live ? (
          <>
            <State kind="run" />
            {t('chat.thinking')} <span className="f3 ell">{tail}</span>
          </>
        ) : (
          <>{t('chat.thought', { count: text.length })}</>
        )}
      </summary>
      <div className="think-b">{text}</div>
    </details>
  );
}
