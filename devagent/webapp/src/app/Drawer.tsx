import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

export interface DrawerProps {
  readonly title: ReactNode;
  readonly eyebrow: ReactNode;
  readonly footer?: ReactNode;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
  readonly className?: string;
}

/**
 * The one drawer shape: a scrim plus a right-hand panel between the header and the status bar.
 * Esc closes it, the scrim closes it, and on a narrow screen CSS turns it full width instead of
 * inventing a second component. Requirement detail and member follow both use it.
 */
export function Drawer({ title, eyebrow, footer, aside, children, onClose, className }: DrawerProps) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} role="presentation" />
      <aside
        ref={panelRef}
        className={`drawer${className === undefined ? '' : ` ${className}`}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : t('aria.dialog')}
        tabIndex={-1}
      >
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            <div className="f3">{eyebrow}</div>
            <h2>{title}</h2>
          </div>
          <span className="sp" />
          {aside}
          <button type="button" className="btn ghost" onClick={onClose}>
            {t('chat.member.close')}
          </button>
        </div>
        <div className="db scroll">{children}</div>
        {footer !== undefined && <div className="df">{footer}</div>}
      </aside>
    </>
  );
}
