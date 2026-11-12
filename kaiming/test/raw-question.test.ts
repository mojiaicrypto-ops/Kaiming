import { describe, expect, it } from 'vitest';
import { extractTrailingRawQuestions, isHiddenRawQuestionAnswerEvent, rawQuestionAnswerMessage } from '../src/runtime/raw-question.ts';

const OBSERVED = `我查了刚才那次首解的库记录，问题找到了。

<question method="select" title="真实模型配置" message="要判断真实首解的信息量，必须先配一个可用的 OpenAI 兼容模型。你现在是什么情况？">
<options>我有 DeepSeek 或其他 OpenAI 兼容 key，我自己写进 .env.local</options>
<options>我有 key，但不确定写到哪几行，你告诉我位置（不要把 key 贴到聊天里）</options>
<options>暂时没有 key，先保留 fake，只修掉 fake 的误导/加启动提示</options>
<options>先只诊断，暂时不改</options>
</question>`;

describe('raw question recovery', () => {
  it('parses the observed model output into the native question contract', () => {
    const extraction = extractTrailingRawQuestions(OBSERVED);
    expect(extraction).toBeDefined();
    expect(extraction?.questions).toHaveLength(1);
    expect(extraction?.questions[0]?.request).toMatchObject({
      method: 'select',
      title: '真实模型配置',
      message: '要判断真实首解的信息量，必须先配一个可用的 OpenAI 兼容模型。你现在是什么情况？',
      options: [
        '我有 DeepSeek 或其他 OpenAI 兼容 key，我自己写进 .env.local',
        '我有 key，但不确定写到哪几行，你告诉我位置（不要把 key 贴到聊天里）',
        '暂时没有 key，先保留 fake，只修掉 fake 的误导/加启动提示',
        '先只诊断，暂时不改',
      ],
    });
    expect(extraction?.cleaned).toBe('我查了刚才那次首解的库记录，问题找到了。');
  });

  it('does not convert a code-fence example', () => {
    const text = 'The syntax looks like:\n\n```xml\n<question method="select" title="x">\n<options>a</options>\n</question>\n```';
    expect(extractTrailingRawQuestions(text)).toBeUndefined();
  });

  it('does not convert when the block is not at the end of the answer', () => {
    const text = '<question method="select" title="x"><options>a</options></question>\n\nThen more explanation.';
    expect(extractTrailingRawQuestions(text)).toBeUndefined();
  });

  it('rejects an invalid select without options', () => {
    expect(extractTrailingRawQuestions('<question method="select" title="x"></question>')).toBeUndefined();
  });

  it('supports a single options block with one option per line', () => {
    const extraction = extractTrailingRawQuestions(
      '<question method="select" title="x"><options>\n- one\n- two\n</options></question>',
    );
    expect(extraction?.questions[0]?.request.options).toEqual(['one', 'two']);
  });

  it('builds a hidden answer message that names the question and answer', () => {
    const extraction = extractTrailingRawQuestions(OBSERVED);
    expect(extraction).toBeDefined();
    const text = rawQuestionAnswerMessage([
      { request: extraction!.questions[0]!.request, answer: '先只诊断，暂时不改' },
    ]);
    expect(text).toContain('真实模型配置');
    expect(text).toContain('先只诊断，暂时不改');
    expect(text).toContain('Do not ask the same question again.');
  });

  it('recognizes only the private answer message frames', () => {
    expect(
      isHiddenRawQuestionAnswerEvent({
        type: 'message_end',
        message: { role: 'custom', customType: 'kaiming.raw-question-answer' },
      }),
    ).toBe(true);
    expect(
      isHiddenRawQuestionAnswerEvent({
        type: 'message_end',
        message: { role: 'custom', customType: 'other' },
      }),
    ).toBe(false);
    expect(
      isHiddenRawQuestionAnswerEvent({
        type: 'message_end',
        message: { role: 'assistant' },
      }),
    ).toBe(false);
  });
});
