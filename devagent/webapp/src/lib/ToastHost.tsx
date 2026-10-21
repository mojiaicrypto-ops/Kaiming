import { useEffect, useState } from 'react';
import { subscribeToasts, type Toast } from './toast';

/** Renders the module-level toast bus. Bottom-centred, above the status bar. */
export function ToastHost() {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((entry) => (
        <div key={entry.id} className={`toast${entry.kind === 'error' ? ' err' : entry.kind === 'success' ? ' ok' : ''}`}>
          {entry.text}
        </div>
      ))}
    </div>
  );
}
