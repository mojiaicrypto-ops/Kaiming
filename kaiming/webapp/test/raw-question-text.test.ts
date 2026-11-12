import { describe, expect, it } from 'vitest';
import { hideRawQuestionMarkup } from '../src/lib/raw-question-text';

describe('hideRawQuestionMarkup', () => {
  it('removes a complete trailing question block', () => {
    const text = '结论。\n\n<question method="select" title="x">\n<options>a</options>\n</question>';
    expect(hideRawQuestionMarkup(text)).toBe('结论。\n\n');
  });

  it('removes an incomplete streaming opener through the end', () => {
    expect(hideRawQuestionMarkup('结论。\n<question method="select" tit')).toBe('结论。\n');
  });

  it('keeps markup inside a fenced code block', () => {
    const text = '例子：\n\n```xml\n<question method="select" title="x">\n</question>\n```';
    expect(hideRawQuestionMarkup(text)).toBe(text);
  });

  it('leaves ordinary assistant text alone', () => {
    expect(hideRawQuestionMarkup('没有标记。')).toBe('没有标记。');
  });
});
