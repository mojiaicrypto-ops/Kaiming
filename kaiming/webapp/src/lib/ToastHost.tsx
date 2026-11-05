import { useEffect, useState, type CSSProperties } from 'react';
import { subscribeToasts, type Toast } from './toast';

/**
 * Renders the module-level toast bus. Bottom-centred, above the status bar.
 *
 * `lift` is how much is already using the bottom of this screen: the chat composer needs the toast
 * to clear it, while a screen without one can let the toast sit at the edge. It is a prop, not a
 * descendant selector, because "is there a composer" is a fact the screen knows.
 */
export function ToastHost({ lift }: { readonly lift: number }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" style={{ '--toast-lift': `${String(lift)}px` } as CSSProperties} role="status" aria-live="polite" aria-atomic="true">
      {toasts.map((entry) => (
        <div
          key={entry.id}
          // An error interrupts; a confirmation waits its turn.
          role={entry.kind === 'error' ? 'alert' : 'status'}
          className={`toast${entry.kind === 'error' ? ' err' : entry.kind === 'success' ? ' ok' : ''}`}
        >
          {entry.text}
        </div>
      ))}
    </div>
  );
}
