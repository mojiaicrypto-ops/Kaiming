# Independent Review · 会话列行内动作收纳

只读独立上下文；读完整个 diff、`SessionsList.tsx`、rail CSS、四个 spec 与 Plan，并在独立 harness 里量了静止/悬停/确认/触屏四种状态。

## Round 1: NEEDS_FIX

通过的部分：静止时组宽 0（`clientWidth 0`、`scrollWidth 111`）；悬停展开 111.31px、四个动作完整无裁剪；`:has(:focus-visible)` 键盘展开；`hover: none` 下 `max-width: none`、组宽 111.31px 常驻；TSX 只是包一层，按钮顺序、testid、事件、当前会话排除、改名输入、两步确认、归档区单按钮均未变；spec 的悬停前置足够，断言没有被削弱；U5 新句与实现一致。

阻塞项：

1. `base.css:3258-3262` 的 148px 展开上限小于确认态内容宽：英文 `Delete?` 内容 162px、中文更长（173px），`overflow: hidden` 会把确认文字与红色右边框切掉；`hover: none` 下 `.srow.armed` 的更高优先级又覆盖了常驻规则，按钮会画到行外。
2. `base.css:3251-3256` 的 `overflow: hidden` 会裁掉 `.sx` 的 `:focus-visible` 外轮廓（2px offset），只剩内部 1px 边框，键盘焦点指示低于 3:1。
## Round 2: PASS

- 确认态：`max-width: 100%` 后英文组宽 161.89 / 内容 162（亚像素差）、中文 `确认删除？` 172.88 / 173，均无裁剪，按钮右边 = 行右边 227 < 列 240；`hover: none` 下 armed 解析为 100%，既不裁剪也不越界。
- 焦点：键盘从行标题 Tab 到 `✎`，计算值 `outline: none`、`box-shadow: inset 0 0 0 1px var(--accent)`，像素扫描显示内嵌环四边完整；accent 在 `--bg` 上约 7:1。
- 其余 diff 与首轮一致；四个受影响用例在重建后通过，`webapp` typecheck/build 通过。
