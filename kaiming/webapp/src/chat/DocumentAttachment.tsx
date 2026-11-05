import { useI18n } from '../i18n/I18nProvider';

export interface DocumentAttachmentProps {
  readonly src: string;
  readonly name: string;
  readonly mimeType: string;
  readonly text?: string;
  readonly truncated?: boolean;
}

/** One uploaded document: a file card, with the extracted text available on demand. */
export function DocumentAttachment({ src, name, mimeType, text, truncated }: DocumentAttachmentProps) {
  const { t } = useI18n();
  const kind = documentKind(mimeType, name);
  return (
    <details className="msg-doc">
      <summary>
        <span className="msg-doc-kind">{kind}</span>
        <span className="msg-doc-name">{name}</span>
        {text !== undefined && <span className="msg-doc-hint">{t('chat.document.text')}</span>}
      </summary>
      <div className="msg-doc-actions">
        <a href={src} target="_blank" rel="noreferrer">
          {t('chat.document.open')}
        </a>
        {text !== undefined && (
          <span>
            {text.length.toLocaleString()} {t('chat.document.characters')}
            {truncated === true ? ` · ${t('chat.document.truncated')}` : ''}
          </span>
        )}
      </div>
      {text !== undefined && <pre className="msg-doc-text">{text}</pre>}
    </details>
  );
}

function documentKind(mimeType: string, name: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  const fromName = /\.([A-Za-z0-9]+)$/.exec(name)?.[1];
  if (fromName !== undefined) return fromName.toUpperCase();
  return 'DOC';
}
