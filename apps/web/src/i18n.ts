/**
 * Interface language for the workbench.
 *
 * `docs/product/experience.md` §6 fixes the two locales (English / 简体中文), the
 * device-local storage of the choice with an in-memory fallback, and the boundary
 * that matters most: **only the workbench's own strings are translated**. User
 * messages, project documents and Agent output are project content and are always
 * rendered verbatim with `translatable:false`, so this module never receives their
 * text in the first place.
 *
 * The dictionary is the UI's own catalogue; the daemon's `ui.translate` method is
 * the same contract exposed to a remote client, and `translationKeys()` lets a test
 * assert that every key the workbench renders exists in both locales.
 */

/** The interface locales this build ships. */
export const LANGUAGES = ['en', 'zh'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

/** The locale identifier the browser's Intl APIs need for formatting. */
export const LOCALE_TAG: Readonly<Record<Language, string>> = { en: 'en-US', zh: 'zh-CN' };

export interface InterfaceString {
  readonly en: string;
  readonly zh: string;
}

/**
 * The workbench's own strings.
 *
 * Keys are stable identifiers: HTML carries `data-i18n="<key>"` and the client
 * script swaps the text, so a missing key is visible as the key itself rather than
 * as silently blank text.
 */
export const UI_STRINGS: Readonly<Record<string, InterfaceString>> = {
  'app.title': { en: 'AgentDev Workspace', zh: 'AgentDev 工作台' },
  'app.projectWorkspace': { en: 'Project workspace', zh: '项目工作区' },
  'nav.workspace': { en: 'Workspace', zh: '工作区' },
  'nav.project': { en: 'Project', zh: '项目' },
  'nav.system': { en: 'System', zh: '系统' },
  'nav.projects': { en: 'Projects', zh: '项目' },
  'nav.chief': { en: 'Chief', zh: '主管' },
  'nav.requirements': { en: 'Requirements', zh: '需求' },
  'nav.docs': { en: 'Docs & Context', zh: '知识与上下文' },
  'nav.files': { en: 'Project Files', zh: '项目文件' },
  'nav.agents': { en: 'Agents', zh: '角色' },
  'nav.runs': { en: 'Runs', zh: '运行' },
  'nav.inbox': { en: 'Inbox', zh: '待处理' },
  'nav.live': { en: 'Live', zh: '实时' },
  'nav.settings': { en: 'Settings', zh: '设置' },
  'nav.primary': { en: 'Project navigation', zh: '项目导航' },
  'language.label': { en: 'Interface language', zh: '界面语言' },
  'language.en': { en: 'English', zh: 'English' },
  'language.zh': { en: '简体中文', zh: '简体中文' },
  'language.contentNotice': {
    en: 'Project content is never translated.',
    zh: '项目内容不参与翻译。',
  },
  'connection.state': { en: 'Connection', zh: '连接' },
  'connection.open': { en: 'Connected', zh: '已连接' },
  'connection.connecting': { en: 'Connecting', zh: '连接中' },
  'connection.reconnecting': {
    en: 'Connection lost; background state pending',
    zh: '连接中断，后台状态待同步',
  },
  'connection.closed': { en: 'Disconnected', zh: '已断开' },
  'connection.resync': { en: 'Re-synchronised from the event log', zh: '已从事件日志重新同步' },
  'connection.expired': { en: 'Session expired; sign in again', zh: '会话已过期，请重新登录' },
  'auth.login': { en: 'Sign in', zh: '登录' },
  'auth.token': { en: 'Installation token', zh: '安装令牌' },
  'auth.submit': { en: 'Sign in', zh: '登录' },
  'auth.logout': { en: 'Sign out', zh: '退出' },
  'auth.required': { en: 'An installation token is required.', zh: '需要安装令牌。' },
  'auth.rateLimited': {
    en: 'Too many attempts; try again shortly.',
    zh: '尝试次数过多，请稍后再试。',
  },
  'auth.showedOnce': {
    en: 'The installation token is shown once at install time and is never re-readable.',
    zh: '安装令牌仅在安装时显示一次，之后不可再次读取。',
  },
  'shell.skipToMain': { en: 'Skip to main content', zh: '跳到主要内容' },
  'shell.panelMode': { en: 'Live panel', zh: '实时面板' },
  'shell.panelMode.open': { en: 'Open', zh: '展开' },
  'shell.panelMode.compact': { en: 'Compact', zh: '紧凑' },
  'shell.panelMode.hidden': { en: 'Hidden', zh: '隐藏' },
  'shell.panelRestore': { en: 'Restore the Live panel', zh: '恢复实时面板' },
  'shell.panelClose': { en: 'Close the Live panel', zh: '关闭实时面板' },
  'shell.liveCount': { en: 'Live events', zh: '实时事件' },
  'shell.readOnly': { en: 'Read-only view', zh: '只读视图' },
  'shell.discussInChief': { en: 'Discuss in Chief', zh: '在主管中讨论' },
  'shell.chiefOnlyControls': {
    en: 'Conversation controls exist only on the Chief page.',
    zh: '对话创建与切换仅在主管页面。',
  },
  'state.received': { en: 'Received', zh: '已接收' },
  'state.processing': { en: 'Processing', zh: '处理中' },
  'state.processed': { en: 'Processed', zh: '已处理' },
  'state.failed': { en: 'Failed', zh: '失败' },
  'state.decision_required': { en: 'Decision required', zh: '需要决定' },
  'state.pending': { en: 'Pending', zh: '待处理' },
  'state.accepted': { en: 'Accepted', zh: '已接受' },
  'state.rejected': { en: 'Rejected', zh: '已拒绝' },
  'state.waiting_permission': { en: 'Waiting for permission', zh: '等待权限' },
  'state.queued': { en: 'Queued', zh: '排队中' },
  'state.active': { en: 'Active', zh: '进行中' },
  'state.completed': { en: 'Completed', zh: '已完成' },
  'state.archived': { en: 'Archived', zh: '已归档' },
  'state.cancelled': { en: 'Cancelled', zh: '已取消' },
  'state.paused': { en: 'Paused', zh: '已暂停' },
  'state.blocked': { en: 'Blocked', zh: '已阻断' },
  'state.recovery': { en: 'Recovery required', zh: '需要恢复' },
  'state.waiting': { en: 'Waiting', zh: '等待中' },
  'state.valid': { en: 'Valid', zh: '有效' },
  'state.invalidated': { en: 'Superseded', zh: '已失效' },
  'state.stale': { en: 'Stale', zh: '已过期' },
  'state.unknown': { en: 'Unknown', zh: '未知' },
  'state.actionable': { en: 'Actionable', zh: '可处理' },
  'state.expired': { en: 'Expired', zh: '已过期' },
  'board.queued': { en: 'Requirement queue', zh: '需求队列' },
  'board.active': { en: 'In iteration', zh: '迭代中需求' },
  'board.completed': { en: 'Completed', zh: '已完成' },
  'board.archived': { en: 'Archived', zh: '已归档' },
  'board.card.identity': { en: 'Requirement', zh: '需求' },
  'board.card.phase': { en: 'Phase', zh: '阶段' },
  'board.card.role': { en: 'Role', zh: '角色' },
  'board.card.tasks': { en: 'Tasks done / total', zh: '已完成/总任务' },
  'board.card.blockers': { en: 'Blockers', zh: '阻断' },
  'board.card.decisions': { en: 'Decisions', zh: '决定' },
  'board.card.saveState': { en: 'Save state', zh: '保存状态' },
  'board.card.waitingToContinue': { en: 'Waiting to continue', zh: '待继续' },
  'board.card.evidence': { en: 'Evidence availability', zh: '证据可用性' },
  'board.card.previousState': { en: 'Previous state', zh: '先前状态' },
  'board.card.open': { en: 'Open detail', zh: '查看详情' },
  // AC-090: the push state is only stated when the payload reported it; the read
  // surfaces do not carry `git.unpushed`, so the UI says so instead of inventing it.
  'board.card.unpushed': { en: 'Unpushed', zh: '未推送' },
  'board.card.pushed': { en: 'Pushed', zh: '已推送' },
  'board.card.pushUnknown': { en: 'Push state not reported', zh: '推送状态未上报' },
  'board.action.pause': { en: 'Pause', zh: '暂停' },
  'board.action.resume': { en: 'Resume', zh: '继续' },
  'board.action.continue': { en: 'Continue', zh: '续做' },
  'board.action.complete': { en: 'Complete', zh: '完成' },
  'board.action.cancel': { en: 'Cancel', zh: '取消' },
  'board.action.archive': { en: 'Archive', zh: '归档' },
  'board.actions': { en: 'Requirement actions', zh: '需求操作' },
  'board.empty': { en: 'Nothing in this column.', zh: '此列为空。' },
  'board.l1Hidden': {
    en: 'Direct-collaboration and L1 work stay in Chief and Runs, not on the board.',
    zh: '直接协作与 L1 工作仅在主管与运行中显示，不入看板。',
  },
  'board.pauseQueuedRefused': {
    en: 'A queued requirement without local work cannot be paused.',
    zh: '无本地工作的排队需求不能暂停。',
  },
  'detail.goal': { en: 'Goal', zh: '目标' },
  'detail.scope': { en: 'Scope', zh: '范围' },
  'detail.acceptance': { en: 'Acceptance', zh: '验收' },
  'detail.openQuestions': { en: 'Open questions', zh: '未决问题' },
  'detail.plan': { en: 'Plan', zh: '计划' },
  'detail.planVersion': { en: 'Plan version', zh: '计划版本' },
  'detail.planCurrent': { en: 'Current plan version', zh: '当前计划版本' },
  'detail.approve': { en: 'Approve this plan version', zh: '批准此计划版本' },
  'detail.approveExpired': {
    en: 'This plan version is not current any more; refresh before approving.',
    zh: '该计划版本已非当前版本，请刷新后再批准。',
  },
  'detail.approveUnavailable': {
    en: 'Approval is unavailable: the Plan body or its local authorization cannot be read.',
    zh: '当前无法批准：计划正文或其本地授权不可读取。',
  },
  // The daemon returns `approval.reasonCode` as a machine-readable identifier; the
  // page renders the interface string from here, so a Chinese page never mixes in
  // the daemon's English diagnostic (W9R2-05). The English text stays available in
  // the element's `title` for diagnosis.
  'detail.approveReason.no_plan': {
    en: 'The gate holds no approved Plan for this Work revision.',
    zh: '该工作版本尚无已批准的计划。',
  },
  'detail.approveReason.stale_version': {
    en: 'This plan version is not current any more; refresh before approving.',
    zh: '该计划版本已非当前版本，请刷新后再批准。',
  },
  'detail.approveReason.gate_not_approved': {
    en: 'The gate no longer accepts this plan version.',
    zh: '该计划版本已不再被闸门接受。',
  },
  'detail.approveReason.plan_unreadable': {
    en: 'Approval is unavailable: the Plan body cannot be read.',
    zh: '当前无法批准：无法读取计划正文。',
  },
  'detail.approveReason.no_authorization': {
    en: 'Approval is unavailable: the Plan records no local authorization.',
    zh: '当前无法批准：计划未记录本地授权。',
  },
  'detail.approveReason.authorization_unreadable': {
    en: 'Approval is unavailable: the local authorization is not readable for this Work.',
    zh: '当前无法批准：该工作的本地授权不可读取。',
  },
  'detail.approveReason.gate_unavailable': {
    en: 'Approval is unavailable: the Plan gate is not readable.',
    zh: '当前无法批准：计划闸门不可读取。',
  },
  'detail.approvedAt': { en: 'Approved at', zh: '批准时间' },
  // AC-090: the Git/projection agreement the detail surface must state.
  'detail.delivery': { en: 'Delivery state', zh: '交付状态' },
  'detail.branch': { en: 'Delivery branch', zh: '交付分支' },
  'detail.commit': { en: 'Commit', zh: '提交' },
  'detail.pushState': { en: 'Push state', zh: '推送状态' },
  'detail.tasks': { en: 'Tasks', zh: '任务' },
  'detail.runs': { en: 'Runs', zh: '运行' },
  'detail.settlement': { en: 'Settlement', zh: '结算' },
  'detail.artifacts': { en: 'Artifacts', zh: '产物' },
  'detail.versionHistory': { en: 'Version history', zh: '版本历史' },
  'detail.previewTruncated': {
    en: 'Inline preview is truncated; download the full artifact.',
    zh: '内联预览已截断，请下载完整产物。',
  },
  'detail.download': { en: 'Download the full artifact', zh: '下载完整产物' },
  'detail.previewFailed': {
    en: 'The preview could not be rendered; the source download stays available.',
    zh: '预览渲染失败，仍可下载源码。',
  },
  'files.branch': { en: 'Delivery branch', zh: '交付分支' },
  'files.revision': { en: 'Target revision', zh: '目标版本' },
  'files.search': { en: 'Search paths', zh: '搜索路径' },
  'files.tree': { en: 'Project file tree', zh: '项目文件树' },
  'files.preview': { en: 'Read-only file preview', zh: '只读文件预览' },
  'files.rootBoundary': {
    en: 'Only paths inside the project root are readable.',
    zh: '只能读取项目根目录内的路径。',
  },
  'files.snapshotUntouched': {
    en: 'Browsing does not change the Agent context snapshot.',
    zh: '浏览文件不会改变 Agent 上下文快照。',
  },
  'files.notFound': {
    en: 'The path is not inside the project root.',
    zh: '该路径不在项目根目录内。',
  },
  'files.binary': { en: 'Binary file; size and hash shown.', zh: '二进制文件，仅显示大小与哈希。' },
  'agents.role': { en: 'Role', zh: '角色' },
  'agents.profile': { en: 'Effective profile', zh: '有效配置' },
  'agents.tools': { en: 'Tool subset', zh: '工具集' },
  'agents.source': { en: 'Configuration source', zh: '配置来源' },
  'agents.unavailable': { en: 'No usable model', zh: '无可用模型' },
  'agents.readOnly': { en: 'Role profiles are read-only here.', zh: '角色配置在此为只读。' },
  'settings.providers': { en: 'Providers', zh: '模型提供方' },
  'settings.defaultProfile': { en: 'Default profile', zh: '默认配置' },
  'settings.limits': { en: 'Limits', zh: '上限' },
  'settings.policy': { en: 'Policy', zh: '策略' },
  'settings.revision': { en: 'Active revision', zh: '活动版本' },
  'settings.save': { en: 'Save configuration', zh: '保存配置' },
  'settings.test': { en: 'Test provider', zh: '测试提供方' },
  'settings.testOk': { en: 'The provider profile is usable.', zh: '提供方配置可用。' },
  'settings.testFailed': { en: 'The provider profile is not usable.', zh: '提供方配置不可用。' },
  'settings.saved': { en: 'Configuration saved.', zh: '配置已保存。' },
  'settings.rejected': { en: 'The configuration was rejected', zh: '配置未通过校验' },
  'settings.unchanged': {
    en: 'The active revision is unchanged and your input is preserved.',
    zh: '活动版本未改变，输入已保留。',
  },
  'settings.unsaved': { en: 'Unsaved edits', zh: '未保存的修改' },
  'settings.secretConfigured': { en: 'Secret configured', zh: '已配置密钥' },
  'settings.secretMissing': { en: 'No secret configured', zh: '未配置密钥' },
  'settings.newProvider': { en: 'New provider', zh: '新增 Provider' },
  'settings.providerId': { en: 'Provider id', zh: 'Provider 标识' },
  'settings.providerIdHint': {
    en: 'Leave empty to create a new provider; the server creates the id otherwise.',
    zh: '留空表示新建 Provider；否则使用已配置的标识。',
  },
  'settings.providerType': { en: 'Type', zh: '类型' },
  'settings.providerTypeOpenai': { en: 'OpenAI-compatible', zh: 'OpenAI 兼容' },
  'settings.providerTypeAnthropic': { en: 'Anthropic', zh: 'Anthropic' },
  'settings.providerTypeGoogle': { en: 'Google', zh: 'Google' },
  'settings.baseUrl': { en: 'Base URL', zh: 'Base URL' },
  'settings.enabled': { en: 'Enabled', zh: '启用' },
  'settings.models': { en: 'Models', zh: '模型' },
  'settings.modelsHint': {
    en: 'ModelDescriptor array: id, contextWindow, maxOutputTokens, reasoningLevels, vision, optional prices.',
    zh: 'ModelDescriptor 数组：id、contextWindow、maxOutputTokens、reasoningLevels、vision、可选价格。',
  },
  'settings.apiKey': { en: 'API key', zh: 'API 密钥' },
  'settings.apiKeyHint': {
    en: 'Leave empty to keep the stored credential. The value is never echoed back.',
    zh: '留空表示保留已保存的凭证。密钥值不会回显。',
  },
  'settings.providerSave': { en: 'Save provider', zh: '保存 Provider' },
  'settings.providerTest': { en: 'Test connection', zh: '连接测试' },
  'settings.testModel': { en: 'Model to test', zh: '测试模型' },
  'settings.testNeedsModel': {
    en: 'Save the provider before testing: it declares no model yet.',
    zh: '保存 Provider 后再测试：该 Provider 还没有模型。',
  },
  'settings.providerSaved': { en: 'Provider saved', zh: 'Provider 已保存' },
  'settings.testAccepted': { en: 'Connection test accepted.', zh: '连接测试已接受。' },
  'settings.testPending': {
    en: 'The result arrives later — check Runs or the Live event list.',
    zh: '结果稍后到达/查看 Runs 或事件。',
  },
  'settings.testCompleted': { en: 'Connection test result', zh: '连接测试结果' },
  'inbox.decision': { en: 'Decision', zh: '决定' },
  'inbox.finding': { en: 'Blocking finding', zh: '阻断发现' },
  'inbox.recovery': { en: 'Recovery', zh: '恢复' },
  'inbox.internalRepairs': { en: 'Internal repairs', zh: '内部修复' },
  'inbox.dedup': { en: 'One row per target version', zh: '每个目标版本一项' },
  'inbox.expiredDisabled': {
    en: 'An expired decision can no longer be applied.',
    zh: '过期决定不可再次应用。',
  },
  'inbox.resolve': { en: 'Record choice', zh: '提交选择' },
  'inbox.options': { en: 'Saved options', zh: '已保存选项' },
  'inbox.targetVersion': { en: 'Target version', zh: '目标版本' },
  'inbox.empty': { en: 'Nothing needs your decision.', zh: '当前没有待处理事项。' },
  'inbox.permission': { en: 'Tool permission request', zh: '工具权限请求' },
  'inbox.permissionBinding': { en: 'What will be granted', zh: '将授予的内容' },
  'inbox.operation': { en: 'Operation', zh: '操作' },
  'inbox.targets': { en: 'Targets', zh: '目标' },
  'inbox.noTargets': {
    en: 'No targets recorded (a command operation).',
    zh: '未记录目标（命令类操作）。',
  },
  'inbox.inputHash': { en: 'Input hash', zh: '输入哈希' },
  'inbox.bindingHash': { en: 'Binding hash', zh: '绑定哈希' },
  'inbox.grantScope': { en: 'Grant scope', zh: '授权范围' },
  'inbox.grantScopeOnce': { en: 'once (this call only)', zh: '一次（仅本次调用）' },
  'inbox.bindingMissing': {
    en: 'This daemon did not report the bound operation and targets, so approving is disabled. Denying still records a reason.',
    zh: '该 daemon 未报告绑定的操作与目标，因此批准已禁用；拒绝仍会记录原因。',
  },
  'inbox.approve': { en: 'Approve once', zh: '批准一次' },
  'inbox.deny': { en: 'Deny', zh: '拒绝' },
  'inbox.denyReason': { en: 'Reason for denial (required)', zh: '拒绝原因（必填）' },
  'inbox.denyReasonRequired': { en: 'A denial must record a reason.', zh: '拒绝必须记录原因。' },
  'inbox.l3': { en: 'L3 high-risk confirmation', zh: 'L3 高风险确认' },
  'inbox.l3RiskFlags': { en: 'Risk flags the routing produced', zh: '路由给出的风险标记' },
  'inbox.l3NoRiskFlags': {
    en: 'The routing raised the level to L3 without naming a risk flag.',
    zh: '路由把等级提到 L3，但没有给出风险标记。',
  },
  'inbox.l3What': { en: 'What you are confirming', zh: '你要确认的内容' },
  'inbox.l3Work': { en: 'Work', zh: 'Work' },
  'inbox.l3Requirement': { en: 'Requirement', zh: '需求' },
  'inbox.l3Revision': { en: 'Revision', zh: '修订' },
  'inbox.l3Reason': { en: 'Why the routing says high risk', zh: '路由给出的高风险原因' },
  'inbox.l3WritePaths': { en: 'Write paths', zh: '写路径' },
  'inbox.l3ReadPaths': { en: 'Read paths', zh: '读路径' },
  'inbox.l3Operations': { en: 'Operations', zh: '操作' },
  'inbox.l3NetworkTargets': { en: 'Network targets', zh: '网络目标' },
  'inbox.l3NoPaths': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoOperations': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoTargets': { en: 'None declared', zh: '未声明' },
  'inbox.l3NoRequirement': { en: 'No Requirement yet', zh: '尚无需求' },
  'inbox.l3FieldUnavailable': { en: 'Not reported', zh: '未报告' },
  'inbox.l3DeclineReason': { en: 'Reason for declining (required)', zh: '拒绝原因（必填）' },
  'inbox.l3DeclineReasonRequired': {
    en: 'Declining an L3 confirmation must record a reason.',
    zh: '拒绝 L3 确认必须记录原因。',
  },
  'inbox.l3HoldNote': {
    en: 'Until this is confirmed, the Work does not execute: no Plan, Develop or verification stage is dispatched.',
    zh: '在确认之前，该 Work 不会执行：Plan、Develop 及后续验证阶段都不会被派发。',
  },
  'inbox.l3Confirmed': {
    en: 'Confirmed: the L3 delivery may proceed.',
    zh: '已确认：该 L3 交付可以继续。',
  },
  'inbox.l3Declined': {
    en: 'Declined: the Work stays blocked and the high-risk step is not implemented.',
    zh: '已拒绝：Work 保持 blocked，不会实施高风险步骤。',
  },
  'inbox.decisionKind': { en: 'Kind', zh: '类型' },
  'inbox.raisedBy': { en: 'Raised by', zh: '发起方' },
  'inbox.raisedByChief': { en: 'Chief', zh: '主管' },
  'inbox.raisedByRun': { en: 'the Run below', zh: '下方运行' },
  'inbox.question': { en: 'Question', zh: '问题' },
  'inbox.questionUnavailable': {
    en: 'The question text could not be read from the decision artifact.',
    zh: '无法从决定产物读取问题正文。',
  },
  'inbox.questionEmpty': {
    en: 'The decision artifact carried no question text.',
    zh: '决定产物没有携带问题正文。',
  },
  'inbox.artifact': { en: 'Artifact', zh: '产物' },
  'inbox.work': { en: 'Work', zh: '工作' },
  'inbox.run': { en: 'Run', zh: '运行' },
  'inbox.resolved': { en: 'The decision was applied.', zh: '决定已应用。' },
  'inbox.denied': { en: 'The request was denied.', zh: '请求已拒绝。' },
  'inbox.refreshFailed': {
    en: 'The Inbox could not be refreshed; reload to see the latest state.',
    zh: '待处理列表刷新失败；请重新加载以查看最新状态。',
  },
  'inbox.todo': { en: 'Chief todo', zh: '主管待办' },
  'inbox.todoSensitiveFile': { en: 'Sensitive file needs you', zh: '敏感文件需你本人处理' },
  'inbox.todoSensitiveWhat': {
    en: 'The agent was refused this file because it is on the sensitive-file list. Its content was never read, and the agent will not read, search or edit it.',
    zh: '该文件在敏感文件清单内，Agent 的访问已被拒绝；文件内容从未被读取，Agent 也不会读取、搜索或修改它。',
  },
  'inbox.todoHandling': {
    en: 'Handle this file yourself (fill it in, update it or provide the value another way). The agent continues with other work and does not need a decision from you here.',
    zh: '请你本人处理该文件（填写、更新或改用其他方式提供该值）。Agent 会继续做其他工作，这里不需要你提交决定。',
  },
  'inbox.todoAction': { en: 'Refused operation', zh: '被拒操作' },
  'inbox.todoPath': { en: 'File', zh: '文件' },
  'inbox.todoPattern': { en: 'Matched rule', zh: '命中规则' },
  'inbox.todoConfigPolicy': { en: 'Config policy at refusal', zh: '拒绝时的配置档位' },
  'inbox.todoKind': { en: 'Todo kind', zh: '待办类型' },
  'inbox.todoKindUnknown': { en: 'kind not reported', zh: '未上报类型' },
  'inbox.todoOtherHint': {
    en: 'This Chief todo was reported without a documented user action; its reported fields are below.',
    zh: '该主管待办没有对应文档化的用户动作；下方是它上报的字段。',
  },
  'inbox.todoFieldUnavailable': {
    en: 'Not reported by the daemon',
    zh: '守护进程未上报',
  },
  'inbox.todoActions': { en: 'Close this todo', zh: '关闭该待办' },
  'inbox.todoHandled': { en: 'Handled', zh: '已处理' },
  'inbox.todoDismissed': { en: 'Ignore', zh: '忽略' },
  'inbox.todoReason': { en: 'Note (optional)', zh: '备注（可选）' },
  'inbox.todoResolved': { en: 'The todo was closed.', zh: '该待办已关闭。' },
  'inbox.raisedAt': { en: 'Raised at', zh: '提出时间' },
  'runs.work': { en: 'Work', zh: '工作' },
  'runs.run': { en: 'Run', zh: '运行' },
  'runs.attempt': { en: 'Attempt', zh: '尝试' },
  'runs.epoch': { en: 'Epoch', zh: '纪元' },
  'runs.status': { en: 'Status', zh: '状态' },
  'runs.outcome': { en: 'Outcome', zh: '结果' },
  'runs.evidence': { en: 'Evidence', zh: '证据' },
  'runs.tokens': { en: 'Tokens', zh: 'Token' },
  'runs.l1': { en: 'Direct collaboration / L1', zh: '直接协作 / L1' },
  'runs.empty': { en: 'No Work yet.', zh: '暂无工作。' },
  'run.topLive': { en: 'Live', zh: '实时' },
  'runs.pause': { en: 'Pause run', zh: '暂停运行' },
  'runs.cancel': { en: 'Cancel run', zh: '取消运行' },
  'runs.resume': { en: 'Resume run', zh: '恢复运行' },
  'live.title': { en: 'Live events', zh: '实时事件' },
  'live.watermark': { en: 'Watermark', zh: '水位' },
  'live.empty': { en: 'No events yet.', zh: '暂无事件。' },
  'live.transient': { en: 'Transient stream', zh: '临时流' },
  'live.reconnect': { en: 'Reconnecting from the watermark', zh: '按水位重连' },
  'chief.composer': { en: 'Message the Chief', zh: '给主管发消息' },
  'chief.send': { en: 'Send message', zh: '发送消息' },
  'chief.sending': { en: 'Sending…', zh: '发送中…' },
  'chief.newConversation': { en: 'New conversation', zh: '新建对话' },
  'chief.switchConversation': { en: 'Switch conversation', zh: '切换对话' },
  'chief.opinion': { en: 'Opinion routed by the Chief', zh: '意见由主管路由' },
  'chief.attachments': { en: 'Attachments', zh: '附件' },
  'chief.attach': { en: 'Add attachment', zh: '添加附件' },
  'chief.attachmentLimits': {
    en: 'Up to 5 attachments, 20 MiB each, 50 MiB total; PNG/JPEG/WebP and text/Markdown/HTML/PDF only.',
    zh: '最多 5 个附件，单个 20 MiB，总 50 MiB；仅支持 PNG/JPEG/WebP 与文本/Markdown/HTML/PDF。',
  },
  'chief.attachmentRejected': { en: 'The attachment was rejected', zh: '附件被拒绝' },
  'chief.attachmentTooMany': {
    en: 'At most 5 attachments per message.',
    zh: '每条消息最多 5 个附件。',
  },
  'chief.attachmentTooLarge': { en: 'The attachment exceeds 20 MiB.', zh: '附件超过 20 MiB。' },
  'chief.attachmentTotalTooLarge': {
    en: 'Attachments exceed 50 MiB in total.',
    zh: '附件总量超过 50 MiB。',
  },
  'chief.attachmentMime': {
    en: 'That file type is not a supported attachment type.',
    zh: '该文件类型不是受支持的附件类型。',
  },
  'chief.attachmentStaged': { en: 'Staged', zh: '已暂存' },
  'chief.attachmentBound': { en: 'Bound to the message', zh: '已绑定到消息' },
  'chief.attachmentUploading': { en: 'Uploading…', zh: '上传中…' },
  'chief.providerMissing': {
    en: 'No usable model is configured; the draft is kept.',
    zh: '未配置可用模型，草稿已保留。',
  },
  'chief.processRetry': { en: 'Retry processing', zh: '重试处理' },
  'common.error': { en: 'The server refused the request', zh: '服务端拒绝了请求' },
  'common.retry': { en: 'Retry', zh: '重试' },
  'common.reason': { en: 'Reason', zh: '原因' },
  'common.by': { en: 'By', zh: '作者' },
  'common.at': { en: 'At', zh: '时间' },
  'common.version': { en: 'Version', zh: '版本' },
  'common.validity': { en: 'Validity', zh: '有效性' },
  'common.open': { en: 'Open', zh: '打开' },
  'common.close': { en: 'Close', zh: '关闭' },
  'common.refresh': { en: 'Refresh', zh: '刷新' },
  'common.loading': { en: 'Loading…', zh: '加载中…' },
  'common.failed': { en: 'Failed', zh: '失败' },
  'common.waiting': { en: 'Waiting', zh: '等待中' },
  'common.utc': { en: 'UTC', zh: 'UTC' },
  'common.localTime': { en: 'Device time zone', zh: '设备时区' },
  'common.none': { en: 'None', zh: '无' },
  'common.more': { en: 'More', zh: '更多' },
  'common.back': { en: 'Back', zh: '返回' },
  'aria.liveDock': { en: 'Live panel', zh: '实时面板' },
  'aria.liveDockOpen': { en: 'Live panel, open', zh: '实时面板，已展开' },
  'aria.liveDockCompact': { en: 'Live panel, compact', zh: '实时面板，紧凑' },
  'aria.liveDockHidden': { en: 'Live panel, hidden', zh: '实时面板，已隐藏' },
  'aria.chiefConversation': { en: 'Chief conversation', zh: '主管对话' },
  'aria.messages': { en: 'Conversation messages', zh: '对话消息' },
  'aria.composer': { en: 'Message composer', zh: '消息输入框' },
  'aria.board': { en: 'Requirement board', zh: '需求看板' },
  'aria.detail': { en: 'Requirement detail', zh: '需求详情' },
  'aria.docs': { en: 'Knowledge documents', zh: '知识文档' },
  'aria.agents': { en: 'Agent roles', zh: 'Agent 角色' },
  'aria.settings': { en: 'Configuration', zh: '配置' },
  'aria.inbox': { en: 'Inbox items', zh: '待处理事项' },
  'aria.runs': { en: 'Runs', zh: '运行' },
  'aria.liveStream': { en: 'Live event stream', zh: '实时事件流' },
  'aria.projectFiles': { en: 'Project files', zh: '项目文件' },
  'aria.status': { en: 'Status messages', zh: '状态消息' },
  'aria.requirementProgress': { en: 'Requirement progress', zh: '需求进度' },
  'aria.focusOrderNote': {
    en: 'On narrow screens the Live panel is an overlay; closing it returns focus to its restore control.',
    zh: '窄屏下实时面板为覆盖层，关闭后焦点回到恢复控件。',
  },
  // WP-12 project UX: the browser-only project loading and switching surface.
  'projects.firstRunTitle': { en: 'No project yet', zh: '还没有项目' },
  'projects.firstRunHint': {
    en: 'Open an existing folder, create a new project folder, or clone from a Git URL. Everything here works in the browser; no command line is needed.',
    zh: '打开已有文件夹、新建项目文件夹，或从 Git 地址克隆。全部在浏览器内完成，不需要命令行。',
  },
  'projects.actions': { en: 'Project actions', zh: '项目操作' },
  'projects.openFolder': { en: 'Open a folder…', zh: '打开文件夹…' },
  'projects.createFolder': { en: 'New project folder…', zh: '新建项目文件夹…' },
  'projects.clone': { en: 'Clone from Git URL', zh: '从 Git 地址克隆' },
  'projects.cloneHint': {
    en: 'Cloning writes a new folder and needs your explicit confirmation; it uses a one-time installation Grant for that remote and path.',
    zh: '克隆会新建目录并需要你显式确认；它为该远端与路径铸一次安装级 Grant。',
  },
  'projects.remoteUrl': { en: 'Git remote URL', zh: 'Git 远端地址' },
  'projects.path': { en: 'Folder path', zh: '文件夹路径' },
  'projects.name': { en: 'Project name', zh: '项目名称' },
  'projects.pick': { en: 'Choose…', zh: '选择…' },
  'projects.open': { en: 'Open', zh: '打开' },
  'projects.opening': { en: 'Opening…', zh: '正在打开…' },
  'projects.trust': { en: 'Trust and work', zh: '信任并开始工作' },
  'projects.readOnly': { en: 'Read-only for now', zh: '暂时只读' },
  'projects.trustPromptTitle': { en: 'Trust this folder?', zh: '信任这个文件夹吗？' },
  'projects.trustPromptBody': {
    en: 'This folder is read-only (只看不改) until you trust it: your own instruction and extension resources are not loaded from it. Trust it now, or keep it read-only and change this later on the project row.',
    zh: '在信任之前，该项目只读（只看不改）：不会加载它自带的指令与扩展资源。可以现在信任，也可以暂时只读，之后在项目行里随时更改。',
  },
  'projects.trusted': { en: 'trusted', zh: '已信任' },
  'projects.untrusted': { en: 'read-only (untrusted)', zh: '只读（未信任）' },
  'projects.trustNow': { en: 'Trust', zh: '信任' },
  'projects.untrustNow': { en: 'Make read-only', zh: '改为只读' },
  'projects.initialize': { en: 'Initialize', zh: '初始化' },
  'projects.close': { en: 'Close', zh: '关闭' },
  'projects.closed': { en: 'closed', zh: '已关闭' },
  'projects.openAction': { en: 'Open', zh: '打开' },
  'projects.switch': { en: 'Switch', zh: '切换' },
  'projects.state': { en: 'state', zh: '状态' },
  'projects.chipTrust': { en: 'trust', zh: '信任' },
  'projects.chipRuns': { en: 'runs', zh: '运行中' },
  'projects.chipInit': { en: 'init', zh: '初始化' },
  'projects.lifecycleOpen': { en: 'open', zh: '已打开' },
  'projects.lifecycleClosed': { en: 'closed', zh: '已关闭' },
  'projects.lifecycleMissing': { en: 'path missing', zh: '路径不存在' },
  'projects.lifecycleUnreadable': { en: 'unreadable registry entry', zh: '注册表条目不可读' },
  'projects.opened': { en: 'Project opened.', zh: '项目已打开。' },
  'projects.trustApplied': { en: 'Trust updated.', zh: '信任状态已更新。' },
  'projects.closedNotice': {
    en: 'Project closed (navigation only).',
    zh: '项目已关闭（仅导航级）。',
  },
  'projects.picker': { en: 'Choose a folder', zh: '选择文件夹' },
  'projects.pickerHint': {
    en: 'Read-only browser of folder names. It starts at your home directory, can go up to the filesystem root, and accepts a pasted absolute path. Every listing is audited.',
    zh: '只读的文件夹名浏览：从主目录开始，可上溯到文件系统根目录，也接受粘贴的绝对路径。每次列表都进审计。',
  },
  'picker.title': { en: 'Choose a folder', zh: '选择文件夹' },
  'picker.path': { en: 'Path', zh: '路径' },
  'picker.go': { en: 'Go', zh: '前往' },
  'picker.up': { en: 'Up', zh: '上一级' },
  'picker.home': { en: 'Home', zh: '主目录' },
  'picker.root': { en: 'Filesystem root', zh: '文件系统根' },
  'picker.select': { en: 'Use this folder', zh: '使用此文件夹' },
  'picker.cancel': { en: 'Cancel', zh: '取消' },
  'picker.empty': { en: 'This folder is empty.', zh: '该文件夹为空。' },
  'picker.loading': { en: 'Loading…', zh: '加载中…' },
  'picker.truncated': { en: 'Showing the first 2000 entries.', zh: '只显示前 2000 个条目。' },
  'picker.hiddenEntry': { en: 'hidden', zh: '隐藏' },
  'picker.upEntry': { en: 'Parent folder', zh: '上级文件夹' },
  'picker.failed': { en: 'The folder could not be listed.', zh: '无法列出该文件夹。' },
  'picker.readOnlyNotice': {
    en: 'Names only: this picker never reads file contents.',
    zh: '只列名称：该选择器不读取文件内容。',
  },
};

/** Every key the dictionary defines, in a stable order. */
export function translationKeys(): readonly string[] {
  return Object.keys(UI_STRINGS);
}

/**
 * The whole interface dictionary, split by locale, for the browser.
 *
 * `public/app.js` switches language in the page, and the daemon's `ui.translate`
 * catalogue (`apps/daemon/src/protocol.ts`) is deliberately smaller than this
 * dictionary — it owns only the strings the daemon itself answers. Without its own
 * copy the client would keep the server-rendered wording for every key the daemon
 * does not know after a switch (the T7a gap: `aria.liveDock*`, `detail.*`,
 * `settings.*`). The shell embeds this as the `#uiStrings` island, so the client
 * falls back deterministically instead of reusing a stale label.
 */
export function clientDictionary(): Readonly<Record<Language, Readonly<Record<string, string>>>> {
  const dictionary: Record<Language, Record<string, string>> = { en: {}, zh: {} };
  for (const [key, entry] of Object.entries(UI_STRINGS)) {
    dictionary.en[key] = entry.en;
    dictionary.zh[key] = entry.zh;
  }
  return dictionary;
}

/** True for a supported interface locale. */
export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'zh';
}

/**
 * Normalises a stored or requested language.
 *
 * A device `localStorage` value can be anything (another build, a user edit), so an
 * unsupported tag falls back to the default instead of throwing.
 */
export function normaliseLanguage(value: unknown): Language {
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

/**
 * Reads one interface string.
 *
 * An unknown key is a programming error, and the caller sees the key itself so a
 * screenshot shows the gap instead of an empty label.
 */
export function translate(key: string, language: Language): string {
  const entry: InterfaceString | undefined = UI_STRINGS[key];
  if (entry === undefined) return key;
  return language === 'zh' ? entry.zh : entry.en;
}

/** A translate function bound to one locale, as the renderer wants it. */
export type Translator = (key: string) => string;

export function translator(language: Language): Translator {
  return (key: string) => translate(key, language);
}

/**
 * HTML attributes a translatable element carries.
 *
 * `data-i18n` is the text key, `data-i18n-aria` the ARIA-label key and
 * `data-i18n-project` marks a subtree whose content is project data and therefore
 * never translated (`experience.md` §6, AC-073).
 */
export function i18nAttributes(key: string, ariaKey?: string): Record<string, string> {
  return {
    'data-i18n': key,
    ...(ariaKey === undefined ? {} : { 'data-i18n-aria': ariaKey }),
  };
}
