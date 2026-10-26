import { useI18n } from '../i18n/I18nProvider';
import { State } from '../app/State';
import { Markdown } from './Markdown';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';
import { ToolQuestion, ToolReport, ToolRequirement } from './ToolBusiness';
import { ToolTask } from './ToolTask';
import type { TaskMemberRow } from './task-labels';
import { blocksOf, membersForDispatch, parseArgs, type ToolResultView } from './transcript-model';
import { hrefOfEvent } from '../files/link-target';
import type { HistoryMessage } from '../state/slot';

export interface MessageItemProps {
  readonly message: HistoryMessage;
  readonly role: 'user' | 'chief' | 'agent';
  readonly label: string;
  /** Continues the previous assistant message of the same turn: no repeated header. */
  readonly continuation: boolean;
  readonly results: ReadonlyMap<string, ToolResultView>;
  readonly onFollow?: ((sessionId: string) => void) | undefined;
  readonly members?: readonly TaskMemberRow[] | undefined;
  readonly liveSessions?: ReadonlySet<string> | undefined;
  readonly liveCallId?: string | undefined;
  /**
   * A link in the text. Reports quote host paths (`/Users/…/shots/a.png`), and the browser cannot
   * open those: the shell resolves them and opens the file viewer instead of navigating away.
   */
  readonly onLink?: ((href: string) => void) | undefined;
}

/**
 * One message: who said it, when, and its blocks in order. The border-left rail is the
 * prototype's way of tying a whole answer together without a bubble; the cursor only ever sits
 * on the last block of the streaming message, so a long answer does not flicker.
 */
/** The tool's own result text is a `key=value` report; the answer is what the user chose. */
function extractAnswer(text: string): string {
  return /answer="([^"]*)"/.exec(text)?.[1] ?? '';
}

export function MessageItem({ message, role, label, continuation, results, onFollow, members, liveSessions, liveCallId, onLink }: MessageItemProps) {
  const { t } = useI18n();
  const streaming = message.streaming === true;
  const blocks = blocksOf(message);
  const stopped = message.stopReason === 'aborted';

  const rendered = blocks.map((block, index) => {
    const isLast = index === blocks.length - 1;
    const cursor = streaming && isLast ? <span className="cursor">▍</span> : null;
    if (block.kind === 'thinking') {
      return <ThinkingBlock key={`k${index}`} text={block.text} live={streaming && isLast} />;
    }
    if (block.kind === 'text') {
      return (
        <div
          key={`t${index}`}
          className="md"
          onClick={
            onLink === undefined
              ? undefined
              : (event) => {
                  const href = hrefOfEvent(event.target);
                  if (href === undefined) return;
                  // Never let a reference navigate the workbench away: it is a file, not a route.
                  event.preventDefault();
                  onLink(href);
                }
          }
        >
          <Markdown text={block.text} />
          {cursor}
        </div>
      );
    }
    if (block.kind === 'image') {
      return (
        <a key={`i${index}`} className="msg-image" href={block.src} target="_blank" rel="noreferrer">
          <img src={block.src} alt={block.alt} loading="lazy" />
        </a>
      );
    }
    const result = results.get(block.callId) ?? block.result;
    const status = result !== null ? (result.failed ? 'failed' : 'ok') : streaming ? 'running' : 'waiting';
    const parsed = parseArgs(block.args);
    const name = block.name;

    if (name === 'task') {
      const op = typeof parsed?.['op'] === 'string' ? parsed['op'] : '';
      const taskId = typeof parsed?.['taskId'] === 'string' ? parsed['taskId'] : undefined;
      const planMarkdown = typeof parsed?.['planMarkdown'] === 'string' ? parsed['planMarkdown'] : undefined;
      const phase = typeof parsed?.['phase'] === 'string' ? parsed['phase'] : '';
      // The card stands where the chief dispatched, so it lists the members THAT call named.
      const own = membersForDispatch(members, parsed, block.callId === liveCallId, liveSessions);
      return (
        <ToolTask
          key={`c${index}`}
          callId={block.callId}
          op={op}
          args={block.args}
          status={status}
          resultText={result?.text}
          taskId={taskId}
          planMarkdown={planMarkdown}
          members={own}
          liveSessions={block.callId === liveCallId ? liveSessions : undefined}
          onFollow={onFollow}
          phase={phase}
        />
      );
    }
    if (name === 'question') {
      const title = typeof parsed?.['title'] === 'string' ? parsed['title'] : '';
      const answered = result !== null;
      return (
        <ToolQuestion
          key={`c${index}`}
          args={block.args}
          answered={answered}
          echo={answered ? extractAnswer(result?.text ?? '') : undefined}
        />
      );
    }
    if (name === 'agent_report') {
      return <ToolReport key={`c${index}`} args={block.args} status={status} resultText={result?.text} />;
    }
    if (name === 'requirement') {
      const saved = <ToolRequirement key={`c${index}`} status={status} resultText={result?.text} />;
      if (status === 'ok' && result?.text !== undefined && /saved/.test(result.text)) return saved;
    }
    return (
      <ToolCard
        key={`c${index}`}
        name={name}
        callId={block.callId}
        args={block.args}
        status={status}
        resultText={result?.text}
        resultImages={result?.images}
      />
    );
  });
  const userLine = role === 'user';

  return (
    <article
      className={`m ${role}${continuation ? ' cont' : ''}`}
      data-entry-id={message.entryId}
    >
      {/* The flat terminal flow: a user line is one ❯-prefixed run, an assistant message is
          its blocks laid out directly. No who header, no side rail — turn breaks are spacing. */}
      {userLine ? <div className="uline">{rendered.length > 0 ? rendered : <State kind="run" />}</div> : rendered.length > 0 ? rendered : <State kind="run" />}
      {stopped && <div className="stopped">{t('chat.stopped')}</div>}
    </article>
  );
}
