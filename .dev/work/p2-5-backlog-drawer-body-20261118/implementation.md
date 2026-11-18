# P2-5 实施记录

- `webapp/src/theme/base.css`：`textarea.inp` 改为 `height:auto`、`min-height:96px`、多行内边距、`resize:vertical`；`.drawer-backlog .backlog-body` 最小 `max(240px, 34vh)`；`.drawer.drawer-backlog` 宽 `min(760px, 94vw)`，并加入 ≤560px 的 100vw 覆盖（否则新增选择器优先级会赢过移动端规则）。
- `webapp/src/project/BacklogDrawer.tsx`：`Drawer` 传 `className="drawer-backlog"`；正文 `textarea` 加 `backlog-body`、rows 8。
- `docs/technicalnew/ui-design.md`：U6 详情抽屉补正文编辑器与宽度约定。
- 实测：抽屉 760（桌面）/390（手机），正文 306（桌面）/287（手机），规格引用 96；无横向溢出。
