import { Component, type ErrorInfo, type ReactNode } from 'react';

interface BoundaryState {
  readonly error: Error | null;
}

function prefersChinese(): boolean {
  if (typeof navigator === 'undefined') return false;
  const language = navigator.languages?.[0] ?? navigator.language ?? '';
  return language.toLowerCase().startsWith('zh');
}

/**
 * The shell must never fail into an empty root. A render exception is a real state the user can
 * act on: name it, keep the technical detail readable, and offer the one recovery action (reload).
 * Event-handler failures are not React render failures; the normal toast/banner paths own those.
 */
export class AppErrorBoundary extends Component<{ readonly children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console remains the operator's diagnostic surface; do not hide the exception.
    console.error('workbench render failed', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const zh = prefersChinese();
    return (
      <div className="login" data-testid="app-error">
        <div className="dlg" role="alert">
          <h2>❯ Kaiming</h2>
          <p>
            {zh
              ? '界面发生错误，已停止渲染以免继续显示空白。'
              : 'The interface failed to render; this screen replaces the blank page.'}
          </p>
          <details>
            <summary>{zh ? '查看错误详情' : 'Show error details'}</summary>
            <pre className="err" style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '40vh' }}>
              {error.message}
              {error.stack === undefined ? '' : `\n\n${error.stack}`}
            </pre>
          </details>
          <div className="btns" style={{ justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn pri"
              onClick={() => window.location.reload()}
              data-testid="app-error-reload"
            >
              {zh ? '重新加载' : 'Reload'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
