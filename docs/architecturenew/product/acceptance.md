# 可执行验收用例

状态：这是验收要求，尚未对产品实现执行。每项必须保存实际输入/输出、文件/状态和命令/浏览器证据；没有实现不能用文档静态检查标记产品 PASS。

## 1. 统一测试夹具

- P：临时 Git 项目，初始只有 AGENTS 原有文字与一个可运行小程序；Q 为第二项目，另有无 Git 项目 N。模型使用可控工具调用夹具验证工程故障，再使用真实 Provider 验证 Agent 行为。
- 登录为安装用户，默认 explicit_goal，项目 trust/ready 按用例前提设置。所有 requestId、taskId、stepId、文件 hash 和实际模型配置保存。
- 固定目标示例：账号登录能力中增加“密码重置邮件”，现有产品模块 `.dev/product/features/account-access.md`；另外有无关库存模块，不能默认读入。
- 每个用例独立环境，不能依赖前一用例偶然留下状态。Server 故障用真实终止/重启，浏览器用实际断线/重连。

## 2. 项目

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-P01 | 同时两次 project.open(P)，再经符号链接别名打开 | 只有一个 Project/同 projectId，未创建 Session/task，未调用模型 |
| AC-P02 | 打开不存在目录/不可读目录；无模型打开有效目录 | 前两者明确错误且无记录；有效项目仍可列文件/需求，不伪造模型结果 |
| AC-P03 | read_only 项目请求修改；信任后初始化含已有 AGENTS；拒绝/接受差异各一次 | 未信任拒绝写；原文保留；拒绝不写，接受写固定入口且 project_ready=ready；模型不能自授 trust |
| AC-P04 | 将 P 移动后重绑定；活动执行和已占用路径分别重试 | 合法重绑定保留身份/会话；两个冲突明确拒绝，引用缺失阻断而非猜路径 |
| AC-P05 | P task 正在运行，浏览器切换 Q、关闭、重开 P并选择主管 | P继续工作，无新增 task/Session/投递，状态来自 Runtime；Q无P正文/事件 |

## 3. 知识与需求

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-M01 | 输入“分析一下密码重置”；模型另外提出通知优化；不答复保存建议 | 仅分析/候选，无需求文件/task，未把提议写成用户决定 |
| AC-M02 | 明确“将密码重置保存为需求”；读取生成文件/查询结果 | 使用固定 7 字段、正文有范围/行为/异常/AC/来源/未知，id与文件名匹配；queued，不自动开发 |
| AC-M03 | 已有账号模块，保存登录/重置相关变化；提供无关库存资料 | 保存时引用内聚账号模块，正式文档交付才更新模块；不机械按前后端复制完整定义；共享约束引用；库存未默认加载，索引可定位 |
| AC-M04 | 制造非法 status、重复 id、缺完成摘要/空正文、失效 productRef；无模型查询 | 返回有效 items 与逐文件 errors，错误不隐藏、不让模型猜状态；正常列表顺序确定 |
| AC-M05 | 两个写执行读取同 hash，A更新、B仍用旧 expectedHash 写；再解析 | B获 FILE_CONFLICT，A成果保留；不覆盖，不出现半写文件 |
| AC-M06 | N 保存、Git 项目正常提交、Git 有不相关 staged/冲突时保存；提交失败后重试 | 分别显示本机/committed/GIT_BLOCKED；保留全部文件和无关改动；重试不建重复需求；初始化 Git 必须明确授权 |
| AC-M07 | Clone 只有 queued/active/completed 文件；分别查看/继续；直接标准开发无预存需求 | 查询无需DB；active无现场标待继续，不自动运行；标准指令先补需求再沿原授权继续，不要求重复开始 |

## 4. task 与验证

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-T01 | 明确改按钮文案；再用“仅给方案”；另设置 per_plan 并要求实施 | 文案有 Compact Plan/工程师/独立ReviewCheck/结算；给方案不写代码；per_plan 在确认当前Plan前不开发 |
| AC-T02 | 开始标准密码重置任务，开发成功后故意缺 Test/结算调用 finish | 同一 task 持久；missing明确test/settlement，不能completed；补齐后方可完成 |
| AC-T03 | 开发/主管聊天放自评，通过声明；委派Review/Test检查启动包与工具权限 | 新Pi文件，无开发/主管聊天、自评和伪造通过；可以读实际源码/依据；开发检查不顶替Test |
| AC-T04 | 两专业写执行指向同工作区；另用独立工作区产生两个成果 | 同工作区第二写被拒；组合后必须对最终目标独立验证，任一子结果不直接完成父task |
| AC-T05 | 相同dispatchKey重试、改参数、同step新operationId重复/改结果；needs_input后补输入 | 原派发只一个；参数冲突；同结果同resultId，不同终态结果STEP_CLOSED；needs_input历史保留，continue可达 |
| AC-T06 | Review通过后修改既有源码、增新源码、修改需求行为/被引用产品技术定义；仅结算status/完成摘要/模块事实状态各试一次 | 源码/需求/引用定义变化均失效；新增文件不能漏检；合法摘要/status/事实区段不失效；finish复算最终目标 |
| AC-T07 | Review/Test失败→修复→重审重测；环境导致部分未覆盖，用户未/已接受各一次 | 真实失败不可当未覆盖；修复先独立Review；未处置阻断，明确接受覆盖缺口留证据；从未执行不能passed |

## 5. 规则与模型

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-A01 | 创建主管后讨论、保存需求、实施、结算；检查模型请求/读取痕迹 | core/chief/目录实际注入；相应时刻read knowledge/delivery/settlement，不把目录当正文 |
| AC-A02 | 主管派发丰富任务说明和路径，查看子Agent启动包/阅读来源 | 角色+core+规则入口+项目参数+任务上下文；能自主补读/质疑；不强制逐字段上下文编译 |
| AC-A03 | product/planning/frontend/backend/review/test/settlement分别正常/失败/缺输入 | 每角色实际输出匹配stageData；工具校验给具体缺项；自然语言结束不提交则result_missing |
| AC-A04 | 项目覆盖角色模型，禁用Provider，修改配置，测试无效值/实际连接 | 实际配置按优先级；不中途静默换模型；新执行明确阻断；输入保留/查询无密钥/连接有实际证据 |

## 6. 消息与动作

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-E01 | 模型user_request(requirement.create)，用户accept；另直接明确保存 | 点击只持久指令到正确主管，不立即显示已保存；工具写文件/解析后显示；直接保存不重复确认 |
| AC-E02 | 同action同答复重试、不同答复；改引用需求后答复task.start | 原inputId不重复投递；不同答复ACTION_CLOSED；内容变更ACTION_STALE，未执行旧候选 |
| AC-E03 | 观察Pi增量、tool result、agent轮结束、task缺验证，再成功finish | Pi payload/身份正确；一轮结束和工具ok不改task完成；finish后才有有效task.changed |
| AC-E04 | 在生成/子任务期间断网，重连；制造事件缺口/队列溢出 | 先快照再事件/文件查询；完整messageId合并，不重复发送/派发；后台继续，显示连接真实状态 |
| AC-E05 | 重发session.send同id同/不同参数；busy时follow_up/steer；跨项目身份；未认证请求 | 同输入不重复；不同参数冲突；busy不另起同Session；跨项目/未认证拒绝且无正文泄漏 |

## 7. 结算

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-S01 | 代码交付后只发总结，故意留旧产品/技术/入口；再补结算，新Session从入口查 | 未结算不能finish；补齐后找到实际行为/代码/测试/差距，不依赖聊天；只更新受影响层 |
| AC-S02 | 需求已completed但finish缺项；无Git正常完整结算；Git提交失败 | 前者显示待核对，task未完成；无Git本机完成标注；Git失败settling且仅重试提交，不重开发 |
| AC-S03 | 结算agent_result后观察步骤JSON，主管publish/finish，再读Git内容和task | 故意从publishPaths漏列已改源码/删除文件，程序仍按实际变更补齐；最终结算结果JSON及所有阶段/Plan/成果入提交；回执只在task，不循环提交；引用可读 |
| AC-S04 | 完成第5个task/漏检事故，拒绝/接受规则改进；清理被引用/未引用结束会话 | 提出具体复盘diff，未同意不改规则；被引用拒删，其他清理不删项目事实/归档 |

## 8. 恢复故障

| ID | 输入与检查步骤 | 通过条件 |
|---|---|---|
| AC-R01 | 子任务result持久后、通知主管前终止Server；重启，再重复通知 | 原结果和归档可找，未处理通知重投，主管接着Review/下一步，不重新Develop；同key不重复派发 |
| AC-R02 | 输入刚持久但未开始时重启；输入started但执行未知时重启 | 前者继续投递一次；后者核对/阻断，不盲目重发副作用；received不谎称已执行 |
| AC-R03 | bash可能已写外部数据但回执前终止Server；进程状态不确定；再试新写/重绑定 | blocked(effect_unknown)保存具体核实项，不自动重试/假定回滚；同工作区新写和重绑定拒绝 |
| AC-R04 | completed文件写出/task未结束；Git commit已做/回执未存；finish成功后重试 | 核对有效结果后接续收口，查operation提交不重复；无证明时GIT_RESULT_UNKNOWN；重复finish同结果 |

## 9. 全旅程交付判定

必须在真实 Provider + 实际浏览器完成：打开/信任/初始化 P → 自由讨论 → 保存需求 → standard实施 → Review失败返工 → Review/Test → 结算/提交/finish → 新主管从知识入口理解结果。再走 compact/document，并执行恢复故障用例。

每个实现单元保存 AC 对应证据；未执行写 NOT_RUN，环境阻断写 BLOCKED，真实失败写 FAIL。工程夹具只能证明工程规则，不证明模型能内聚组织需求；语义用例需要独立审阅实际产物。全部必需用例通过或有明确允许的覆盖风险处置，才可报告产品交付完成。
