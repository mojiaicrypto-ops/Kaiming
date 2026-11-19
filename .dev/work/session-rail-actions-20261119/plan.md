# 会话列行内动作收纳

状态：进行中（2026-11-19）
依据：U5 会话面、`webapp/src/chat/SessionsList.tsx`
验证档：`visual`（纯样式：动作按钮的行为、事件与请求不变，只改展开方式）

## 事实

- 240px 会话列里每行常驻最多 4 个动作（✎ 改名、⎇ 分支、⌄ 归档、× 清理），行尾约 110px 被按钮占走；标题和日期在剩余宽度里截断。
- 动作只对当前行/其它行有取舍，但按钮一直可见，既压缩标题，也没有额外信息量。

## 改动

1. `SessionsList.tsx`：主列表行的 4 个动作包进 `.sx-group`（DOM 顺序、testid、事件不变）。
2. `base.css`：`.sx-group` 静止时 `max-width: 0`、`overflow: hidden`，行 `:hover` / `:focus-within` / 已进入清理确认（`.armed`）时展开；`prefers-reduced-motion` 下不做过渡；`@media (hover: none)`（触屏）保持常驻。
3. `browser/acceptance.spec.ts`：点击行内动作前先 `hover()` 所在行（可见性前置条件），断言不变。
4. `docs/technicalnew/ui-design.md` U5：记录“动作悬停/聚焦展开，触屏常驻”。

## 不做

- 不新增菜单/弹出层状态，不改归档区（单按钮）与新建会话。
- 不改动动作语义、服务端接口或测试断言语义。
