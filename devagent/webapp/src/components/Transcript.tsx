import { useEffect, useRef } from 'react';
import type { HistoryMessage, ContentBlock } from '../state/slot';
import { Markdown } from './Markdown';

interface ToolCardProps {
  name: string;
  callId: string;
  args: string;
  status: 'running' | 'ok' | 'failed';
  resultText?: string;
}

export function ToolCard({ name, callId, args, status, resultText }: ToolCardProps) {
  const summary = args === '' ? '' : args.slice(0, 160);
  return (
    <details className={`tool-card tool-${status}`} data-call-id={callId}>
      <summary>
        <span className="tool-name">{name}</span>
        <span className="tool-args">{summary}{args.length > 160 ? '…' : ''}</span>
        <span className="tool-status">{status === 'running' ? 'running' : status === 'ok' ? 'done' : 'error'}</span>
      </summary>
      <pre className="tool-args-full">{args}</pre>
      {resultText !== undefined && <pre className={`tool-result ${status === 'failed' ? 'is-error' : ''}`}>{resultText}</pre>}
    </details>
  );
}

interface ThinkingBlockProps {
  text: string;
  streaming: boolean;
}

export function ThinkingBlock({ text, streaming }: ThinkingBlockProps) {
  return (
    <details className="thinking-block" open={false}>
      <summary>{streaming ? 'thinking…' : `thinking · ${text.length} chars`}</summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}

interface MessageProps {
  message: HistoryMessage;
  live: boolean;
}

export function MessageView({ message, live }: MessageProps) {
  if (message.role === 'system') {
    const text = typeof message.content === 'string'
      ? String(message.content)
      : JSON.stringify(message.content);
    return (
      <details className="message system-note">
        <summary>system · {text.length} chars</summary>
        <pre>{text}</pre>
      </details>
    );
  }
  const role = message.role === 'toolResult' ? 'tool' : message.role;
  return (
    <article className={`message ${role}${message.isError === true ? ' error' : ''}`} data-entry-id={message.entryId}>
      <div className="message-body">
        {message.content.map((block: ContentBlock, index: number) => {
          if (block.type === 'thinking') {
            return <ThinkingBlock key={index} text={block.thinking} streaming={live} />;
          }
          if (block.type === 'toolCall') {
            return (
              <ToolCard
                key={index}
                name={block.name ?? 'tool'}
                callId={block.id ?? `block-${index}`}
                args={block.arguments ?? ''}
                status={live ? 'running' : 'ok'}
              />
            );
          }
          return <Markdown key={index} text={block.text} />;
        })}
      </div>
    </article>
  );
}

interface TranscriptProps {
  items: readonly HistoryMessage[];
}

/**
 * The transcript renders the slot's items. Completed toolResult messages flip the matching
 * running card (matched by call id, falling back to the newest running card) instead of
 * rendering a separate blob.
 */
export function Transcript({ items }: TranscriptProps) {
  const toolResults = useRef(new Map<string, { text: string; failed: boolean }>());
  for (const message of items) {
    if (message.role === 'toolResult') {
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('');
      if (message.toolCallId !== undefined) {
        toolResults.current.set(message.toolCallId, { text, failed: message.isError === true });
      }
    }
  }
  return (
    <div className="transcript">
      {items.map((message) => {
        if (message.role === 'toolResult') return null;
        return (
          <MessageWithResults
            key={message.entryId}
            message={message}
            results={toolResults.current}
          />
        );
      })}
    </div>
  );
}

function MessageWithResults(
  { message, results }: {
    message: HistoryMessage;
    results: Map<string, { text: string; failed: boolean }>;
  },
) {
  const blocks = message.content.map((block, index) => {
    if (block.type === 'toolCall') {
      const callId = block.id ?? `block-${index}`;
      const result = results.get(callId);
      return (
        <ToolCard
          key={index}
          name={block.name ?? 'tool'}
          callId={callId}
          args={block.arguments ?? ''}
          status={result === undefined ? (message.streaming === true ? 'running' : 'ok') : result.failed ? 'failed' : 'ok'}
          resultText={result?.text}
        />
      );
    }
    if (block.type === 'thinking') {
      return <ThinkingBlock key={index} text={block.thinking} streaming={message.streaming === true} />;
    }
    return <Markdown key={index} text={block.text} />;
  });
  const role = message.role === 'system' ? 'system' : message.role;
  if (role === 'system') {
    const text = typeof message.content === 'string' ? String(message.content) : JSON.stringify(message.content);
    return (
      <details className="message system-note" data-entry-id={message.entryId}>
        <summary>system · {text.length} chars</summary>
        <pre>{text}</pre>
      </details>
    );
  }
  return (
    <article className={`message ${role}`} data-entry-id={message.entryId}>
      <div className="message-body">{blocks}</div>
    </article>
  );
}
