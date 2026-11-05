/**
 * Module-level toast bus: any component (InteractionCard, composer handlers, drawer) can
 * report a user-visible outcome without threading a callback through props. ToastHost
 * subscribes on mount and renders the queue top-right. Boring emitter, no context.
 */
export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

type Listener = (toasts: readonly Toast[]) => void;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

/** Show a toast; errors stay 6s, everything else 3.5s. */
export function toast(text: string, kind: ToastKind = 'info'): void {
  const entry: Toast = { id: nextId, kind, text };
  nextId += 1;
  toasts = [...toasts, entry];
  emit();
  setTimeout(() => dismiss(entry.id), kind === 'error' ? 6_000 : 3_500);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => listeners.delete(listener);
}
