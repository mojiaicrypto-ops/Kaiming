import { useI18n } from '../i18n/I18nProvider';

export interface EmptyStateProps {
  readonly hasProject: boolean;
  readonly onExample: (text: string) => void;
}

/**
 * The first thing a new session shows. Three examples that map to real behaviours (investigate,
 * discuss, design-then-stop) and a statement of the rule that matters: nothing is built until the
 * user says so.
 */
export function EmptyState({ hasProject, onExample }: EmptyStateProps) {
  const { t } = useI18n();
  const examples = [t('chat.empty.example1'), t('chat.empty.example2'), t('chat.empty.example3')];
  return (
    <div className="empty">
      <div className="logo">❯ AgentDev</div>
      <h2>{t('chat.empty.title')}</h2>
      <p>{hasProject ? t('chat.empty.body') : t('chat.empty.noProject')}</p>
      {hasProject && (
        <div className="ex">
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => onExample(example)}>
              {example}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
