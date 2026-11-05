# Settlement Report · devagent-p4-webui-20261008

```yaml
settlement:
  task: devagent-p4-webui-20261008
  stable_facts:
    - "同源 node:http 服务 + POST /api/v1/rpc 信封（requestId 幂等/同 id 异参 409、统一错误码与失败回执）+ 内存会话 cookie/CSRF（写调用必须带 CSRF，静态与 SSE 不带凭证）；凭证不出现在任何响应"
    - "只读面（project.open/get、session.create/get/messages.list、task.*、requirement.*、project.files.*、recovery.inspect、input.get）无模型可用；路径归属与符号链接在项目根外一律拒绝"
    - "SSE 每 Session 一个 EventHub + 有界缓冲：stream.prepare 先给缓冲、快照与 boundary；慢连接溢出或代次变化 → resync，绝不补洞；读者断开只销毁缓冲，工作继续（浏览器实测离开再回来仍重建同一会话对话）"
    - "交互桥：UI 适配器必须是普通对象，以 {uiContext, mode:'rpc'} 绑定；交互请求/答复入 WAL（pending/resolved/stale）；答复按方法校验形状（confirm 布尔、select 必须是已提供选项），过期答复 INTERACTION_STALE；question 工具走同一通道"
    - "输入提交：同一文本复用同一 requestId（重按即重试，不是新输入），在飞状态与重试 id 分离并在 finally 清空——一次失败不会锁死输入框"
    - "工具结果渲染：身份（toolCallId/toolName/isError）从 PI 的 toolResult 消息经 history 读取 → 快照 DTO（stream.prepare）与分页历史（session.messages.list）→ 客户端两条路径保留；流式卡片在完成消息命名该调用时采用真实 id 与名字，结果就地翻转该卡片（按 id 匹配，退到工具名，再退到仍在运行的卡片）；失败判定优先 isError"
    - "外壳保真：mock 的 485 个展开选择器逐条比对（found 485 / missing 0 / duplicated 0 / mismatched 0 / extra 0）；八视图容器与 topbar/statusbar/三对话框/toast 类名照搬；i18n 由 mock 字典导出，en 与 zh-CN 键集对称、视图引用的键全部命中"
    - "浏览器证据（真实 Chromium + 真实工作台进程 + stub 模型端点，8 场景）：开项目与八视图、提交输入到流式回答、浏览器内问答后模型继续、连续两次 Enter 只产生 1 条输入、业务 FORBIDDEN 后仍可写入且六视图无原始 i18n 键、离开与回来重建对话、首开无项目登录+空外壳、真实数据驱动的外壳（项目名/路径/状态栏/语言切换）"
    - "变异验证（证明断言不空转）：移除根包含检查 → 静态越根用例失败；移除提交的两处保护 → 重复提交用例失败（Received: 2）；快照去掉工具身份 → 新增快照用例失败"
  updated:
    - "docs/technicalnew/validation.md：实施证据边界补本轮 P4 证据，并收窄“浏览器产品验收未取证”的措辞为“P6 完整产品验收未执行”"
    - "devagent/src/server/{http,rpc,auth,methods,read-methods,write-methods,stream-methods,history,interactions}.ts：RPC/认证/只读/写入/SSE/交互桥与历史读取（含工具身份字段）"
    - "devagent/web/**：tokens/components/views 样式、app.js + core/*（store/rpc/stream/session-view/i18n/router/dom）、components/**（含 markdown 流、思考块、工具卡）、8 个视图、vendor 导入映射"
    - "devagent/browser/**：Playwright 夹具（真实服务进程 + stub 模型端点 + 项目夹具）与 8 个场景"
    - "devagent/test/**：本轮新增服务端与浏览器相关用例（快照身份、分页历史身份等），当前 200 项"
    - ".agentdev/work/devagent-p4-webui-20261008/：plan/implementation/test/review/settlement"
  checklist_result: "计划 P4-a…P4-i 全部完成（P4-h0 选型、P4-f 外壳抽取、P4-h 渲染部件一并交付）；四轮独立审阅（8 项 → 5 项 → 1 项阻断 → passed）无遗留阻断"
  not_covered:
    - "P6 完整产品验收：真实模型 + 浏览器走 AC-01/02/03/05/06/07 全链路、四断点视觉、逐组件人工截图对照（截图已存 test-results 附件）未执行"
    - "SSE 溢出/resync 语义由服务端测试取证，未在浏览器里人为制造慢连接复现"
    - "会话 cookie 为进程内存态：服务重启需重新登录（首版允许），已登记为允许项"
    - "多工具并发时工具卡匹配的最后退路（仍在运行的卡片）可能匹配错卡：本版任一时刻只有一个工具在跑"
  indexes_updated:
    - docs/technicalnew/validation.md
  archived:
    - .agentdev/work/devagent-p4-webui-20261008/
  no_change:
    - "docs/productnew/**（产品行为未变）"
    - "oldcode/、docs/old/、docs/architecturenew/、webui/（按 AGENTS.md 排除；webui 仅作样式与文案比对参照）"
  completion_gate: passed   # 四轮独立审阅 Round1 failed → Round2 failed → Round3 failed(1 阻断) → Round4 passed；本记录随本任务提交
```
