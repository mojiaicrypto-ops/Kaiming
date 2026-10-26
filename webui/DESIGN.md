# WebUI 设计规格（以 webui/index.html 为规格源）

状态：**评审稿**。规格源：`webui/index.html`（mock，2978 行）；架构依据：[ui.md](../docs/architecture/ui.md)。

## 0. 核心裁决

**mock 即规格，不是灵感**。上一轮失败的根因是"看懂意图后重新实现"——转译必然走样。本次移植的三条铁律：

1. CSS 令牌与组件样式**逐行照搬**，类名不改；
2. DOM 嵌套层级 **1:1**（mock 的 class 层级就是组件规格）；
3. 任何偏离（协议数据缺失、字号例外）必须登记在 §6 差距表，不得静默改设计。

## 1. 设计定位

**驾驶舱，不是聊天应用**。第一使命是可监控性：3 秒内回答"谁在干活 / 卡在哪等我 / 产出了什么"。一切设计决策由此推导：

- 暗色控制台底：长时注视不疲劳，与代码/日志内容视觉融合；
- 荧光绿 accent 只标记"活着的东西"（运行态、当前导航、主按钮）——绿色即"正在进行的工作"；
- 高密度小字号 + mono 元数据：用户读的是 ID/哈希/分支名；
- 状态永远色+文双编码（无障碍合规同时是监控硬需求）。

## 2. 设计令牌（照搬 mock:10-38）

```css
:root {
  color-scheme: dark;
  --bg: #0b0e11;
  --surface: #101419;
  --surface-raised: #14191f;
  --surface-soft: #181e25;
  --console: #090c0f;
  --line: #242b33;
  --line-strong: #35404b;
  --text: #e8ebee;
  --muted: #929ca7;
  --dim: #89939d;
  --accent: #a3e635;
  --accent-soft: rgba(163, 230, 53, 0.11);
  --blue: #7aa2f7;
  --blue-soft: rgba(122, 162, 247, 0.12);
  --cyan: #63d2df;
  --amber: #e9b96e;
  --red: #ff7b86;
  --purple: #bb9af7;
  --sidebar: 224px;
  --header: 54px;
  --status: 26px;
  --sans: Inter, ui-sans-serif, -apple-system, ...;
  --mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  --font-scale: 1; /* 新增：全局密度旋钮，mock 原字号 × scale */
}
```

**字号决策**：mock 的 7-11px 展示密度**原样保留**（所有声明 `calc(<mock-px> * var(--font-scale))` 不可行处，直接用 mock 值，`--font-scale` 在 `html { font-size }` 不适用的场合用组件级缩放封装）。默认 1。这是与上一轮最大的差异——上轮擅自放大字号导致细节尽失，本规格禁止再犯。

## 3. 布局骨架（mock:60-75, 1310-1698）

```
.app                    grid-template-rows: var(--header) minmax(0,1fr) var(--status); 100dvh
├─ .topbar              grid: var(--sidebar) minmax(260px,1fr) auto
│   ├─ .brand           224px 左缘对齐侧栏；.brand-mark 2×2 绿点
│   ├─ .project-area    .project-switcher 按钮（repo-chip + 项目名 + 分支副标题 + ⌄）
│   │                   → .project-menu 下拉（运行数徽标、不可用项目禁用项）
│   └─ .top-actions     Go to ⌘K · Live · 语言 · （无登出挤占，入状态栏）
├─ .content-shell       grid: sidebar | workspace | runtime(右侧 dock)
│   ├─ .sidebar         三组导航（Workspace/Project/System）+ 徽标
│   ├─ .workspace       面板栈（Conversation / View Stack 切换）
│   └─ .runtime         控制台：chrome(三圆点+Tab) / run-summary / agent-tree / log / prompt
└─ .statusbar           左：连接 LED·Core·分支；右：Run·token·模式
```

与存量差异：登出入口从顶栏移到状态栏；顶栏增 ⌘K 入口；switcher 从平铺列表改为真下拉。

## 4. 组件规格（逐个，行号为 mock 依据）

| 组件                        | mock 依据  | 结构要点                                                                                                                                 | 状态枚举                             |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 对话消息 .message           | :490-550   | 25px .avatar（角色缩写，chief 绿框）+ .message-meta(名/时间) + .message-body；max-width 760px 居中                                       | user/chief/backend…；流式块见 §5     |
| 阶段条 .stage-strip         | :430-470   | 5 列 grid；.stage = 圆点 + mono 标签；::after 连接线；done 绿点/current 蓝点                                                             | done/current/pending                 |
| 看板卡 .board-card          | :900-940   | card-top(ID+priority) / strong 标题 / p 目标 / small meta / **card-facts 双列网格** / card-progress 2px 进度条 / card-footer(D·P 决策数) | queued/active/completed/archived     |
| 数据列表 .data-list         | :858-890   | grid 76px ID + 1fr 主体 + 86px 状态；行高 58px；`.data-status` mono 大写                                                                 | —                                    |
| 运行树 .tree-line           | :1069-1085 | grid 92px 分支符 + 1fr 角色(b 加粗) + auto 状态；状态色 running=accent/waiting=amber/queued=灰/passed=cyan                               | running/waiting/queued/passed/failed |
| 终端日志 .log-line          | :1076-1098 | grid 58px 时间 + 49px tag + 1fr 消息；tag 着色 info=blue/agent=purple/tool=cyan/pass=accent/warn=amber/error=red；.is-error 行红         | —                                    |
| 对话框 dialog               | :1152-1195 | dialog-head/body/actions 三段；input 高 37px；field-row 双列                                                                             | —                                    |
| Toast .toast                | :1110-1130 | fixed 右下 bottom:41px；opacity/translateY 过渡 0.16s；3.2s 自动消失                                                                     | success/error/neutral                |
| 顶栏按钮 .top-button        | :1250+     | 文字 + kbd 标签（Go to ⌘K）；hover surface-soft                                                                                          | —                                    |
| 活指示 .live-pill/.live-dot | :458-470   | 绿点 + box-shadow 光晕；Live 计数                                                                                                        | open/compact/hidden                  |
| 状态栏 .statusbar           | :1090-1105 | 高 26px 底行；.status-item + 5px LED；mono 8px                                                                                           | connected/connecting/reconnecting    |
| Agent 配置卡 .profile-card  | :730-800   | grid auto-fit ≥245px；.profile-model 块；.profile-meta chips；编辑入对话框                                                               | 继承/覆盖                            |
| Provider 卡 .provider-card  | :810-850   | 同上；.provider-health tested=accent/disabled=amber                                                                                      | ok/untested/disabled                 |
| 文件预览 .file-preview      | :820-855   | grid 39px 头 + 1fr 代码 + 27px 脚；.code-pre mono 10px                                                                                   | text/binary/truncated                |

## 5. 流式渲染组件（新增，mock 无对应物——本规格的扩展章节）

对话流中 AI 返回的块，按 run.delta 词汇表渲染（架构 ui.md §2.3）：

| 组件           | 渲染规则                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| MarkdownStream | text delta 增量渲染；**半截 fence/表格按纯文本段落暂存，闭合后重解析**；光标块 `▍` 跟随末尾；完成时整体重排版一次 |
| ThinkingBlock  | thinking delta 累积；默认折叠（header: "思考 · N 字"）；展开实时滚动；完成态灰阶                                  |
| ToolCard       | start 即出卡（工具名 mono + argsSummary + spinner）；end 翻转状态（isError 红）；参数/结果折叠展开                |
| BashBlock      | bash delta 逐行追加进 .log-line 语法（时间列空、tag=tool）；最多保留 500 行，头部显示截断数；完成态定版           |
| RunTree        | 通道 B 的树；选中 Run 高亮；子 Run 前缀 `├─/└─`（mock .tree-branch）                                              |

折叠/展开/选中均为本地 UI 状态，不进 URL。

## 6. 与协议的差距表（偏离登记处）

| mock 元素                           | 真实数据                               | 处置                                        |
| ----------------------------------- | -------------------------------------- | ------------------------------------------- |
| statusbar 的 "18.4k tok" token 用量 | run 实体有 tokensUsed                  | 真·聚合值（work 维度求和），无则 `—`        |
| run-summary 的模型名/耗时           | Run 实体 + attempt ready 描述          | 有则真值；无则隐藏整段，不留空壳            |
| .runtime 命令行 prompt 行           | 无 CLI 语义                            | **删除**（mock 装饰），登记为本表唯一删除项 |
| project-branch 分支名               | project snapshot deliveryBranch + head | 真值                                        |
| 看板 priority 字段                  | 协议无优先级概念                       | **删除**                                    |
| Agent 树的 "2 runs active" 计数     | run.list 实时计数                      | 真值                                        |

新发现的偏离一律补入本表并评审，不允许实现时现场决定。

## 7. 明确不做的事

- 不做浅色主题（mock 仅暗色；双主题维护成本不值）；
- 不引字体文件（Inter 走系统栈兜底；mono 占内容大头，差异可忽略）；
- 不加装饰性动效（仅 Toast 过渡/呼吸 LED/面板切换三种 ≤0.16s）；
- 不做响应式断点以外的移动端专项（mock 已含 1120/840/700/520px 四档，照搬即可）。
