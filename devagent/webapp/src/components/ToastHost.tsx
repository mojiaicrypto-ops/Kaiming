import { useEffect, useState } from 'react';
import { subscribeToasts, dismiss, type Toast } from '../lib/toast';

/** Renders the toast queue top-right. Mounted once by ChiefApp. */
export function ToastHost(): React.ReactElement {
  const [items, setItems] = useState<readonly Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className={`toast toast-${entry.kind}`}
          onClick={() => dismiss(entry.id)}
          title="点击关闭"
        >
          {entry.text}
        </button>
      ))}
    </div>
  );
}
