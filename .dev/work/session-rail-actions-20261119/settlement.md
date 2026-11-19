# Settlement · 会话列行内动作收纳

日期：2026-11-19
验证档：`visual`

## 交付

- `webapp/src/chat/SessionsList.tsx`：主列表行的改名/分支/归档/清理包进 `.sx-group`；按钮、testid、顺序、事件与“当前会话不提供归档/清理”的规则不变。
- `webapp/src/theme/base.css`：`.sx-group` 静止 `max-width: 0; overflow: hidden`，行 `:hover`、`:has(:focus-visible)`、`.armed` 时展开到 `max-width: 100%`；`prefers-reduced-motion` 下无过渡；`hover: none` 触屏常驻；动作按钮的键盘焦点改为内嵌 accent 环，避免被组裁剪。
- `browser/acceptance.spec.ts`、`browser/session-fork.spec.ts`：点击行内动作前先悬停所在行；清理用例的行定位从 `has: settled.first()`（实际匹配两行）收紧为“第一个非当前行”。断言未变。
- `docs/technicalnew/ui-design.md` U5：记录展开规则与触屏例外。

## 效果

- 静止时 240px 会话列标题占满整行，动作按钮不占宽度；悬停或键盘聚焦（`:focus-visible`）才让出宽度，清理确认（`.armed`）保持展开且确认文字完整。
- 触屏（`hover: none`）没有悬停概念，动作保持常驻，不退化为不可发现。
- 按钮始终在 DOM 中，键盘可聚焦（聚焦即展开）、读屏可读；归档区的单个恢复按钮不在组内，行为不变。

## 证据

- 真实 Chromium（Playwright，独立 harness）：改名、清理（含忙会话拒绝）、归档/恢复、分支 4 条用例通过。
- 量值：静止组宽 0；悬停 111.31px、无裁剪；确认态英文 161.89/162、中文 172.88/173，均无裁剪，按钮右边 = 行右边 227 < 列右边 240；`hover: none` 计算值 `max-width: none`。
- `webapp` typecheck 与构建通过。
- 截图：静止时行内只有状态符号 + 标题 + 日期，无动作字形；悬停行展开 4 个动作（当前行 2 个），标题仅在悬停期间截断。
- 独立 Review：首轮 NEEDS_FIX（确认文字被 148px 上限裁剪、焦点环被 `overflow: hidden` 裁掉），修正后 Round 2 PASS（含 `zh-CN` 量值与键盘焦点像素扫描）；见 `review.md`。

## 边界

- 未引入菜单/弹层状态；未改服务端、存储或请求。
- 悬停展开会让被悬停行的标题临时截断（宽度让给动作），这是本次选择的取舍，不是布局抖动缺陷。
- 触屏终端的移动端形态仍按缺口登记 M1–M5 重做，本包不涉及。
