import { useMemo } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { MessageItem } from './MessageItem';
import { indexToolResults } from './transcript-model';
import type { HistoryMessage } from '../state/slot';
import type { TaskMemberRow } from './ToolTask';
import type { SessionActivity } from '../api/stream';

export interface TranscriptProps {
  readonly items: readonly HistoryMessage[];
  readonly busy: SessionActivity;
  /** Chief transcript or a specialist one: the who-line colour and the busy wording follow it. */
  readonly variant: 'chief' | 'agent';
  readonly onFollow?: ((sessionId: string) => void) | undefined;
  readonly members?: readonly TaskMemberRow[] | undefined;
}

/**
 * The conversation. Consecutive assistant messages of one turn are grouped under a single header
 * (`.cont`), which is what makes a long answer with twelve tool calls read as one turn. Tool
 * results are indexed by call id first, so a card flips in place instead of a second blob
 * appearing below it (R4).
 */
export function Transcript({ items, busy, variant, onFollow, members }: TranscriptProps) {
  const { t } = useI18n();
  const results = useMemo(() => indexToolResults(items), [items]);
  const live = items.some((message) => message.streaming === true);

  return (
    <>
      {items.map((message, index) => {
        if (message.role === 'toolResult') return null;
        // Only the chief and the user are conversation here. A `system` entry carries the role
        // context (an empty text block), and an assistant message that has not produced a block
        // yet is not a turn: rendering either as an empty chief frame invents a second answer.
        if (message.role !== 'user' && message.role !== 'assistant') return null;
        if (message.role === 'assistant' && message.content.every((block) => block.type === 'text' && block.text === '')) return null;
        const previous = items[index - 1];
        const continuation = message.role === 'assistant' && previous?.role === 'assistant';
        return (
          <MessageItem
            key={message.entryId}
            message={message}
            role={message.role === 'user' ? 'user' : variant}
            label={t('chat.role.member')}
            continuation={continuation}
            results={results}
            onFollow={onFollow}
            members={members}
          />
        );
      })}
      {busy === 'processing' && !live && (
        <div className="busy">
          <State kind="run" />
          {variant === 'chief' ? t('chat.busy.chief') : t('chat.busy.member')}
        </div>
      )}
    </>
  );
}
