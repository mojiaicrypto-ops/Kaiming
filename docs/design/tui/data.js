/* Mock data for the simplified TUI prototype. Fake; nothing talks to a server. */
window.MOCK = {
  projects: [
    { id: 'pay', name: 'payments-api', path: '/home/dev/work/payments-api' },
    { id: 'web', name: 'web-console', path: '/home/dev/work/web-console' },
  ],

  // Chief sessions. s1 follows the prototype scenario; the others are static.
  sessions: [
    { id: 's1', title: '密码重置' },
    { id: 's2', title: '支付网关设计', state: 'decide' },
    { id: 's3', title: '通知偏好讨论', state: 'idle' },
    { id: 's4', title: '结算按钮文案', state: 'done' },
  ],

  phases: ['计划', '开发', '审核', '测试', '结算'],

  // Requirement board. col: proposal | todo | doing | done
  reqs: [
    { id: 'PRO-0010', kind: '提案', col: 'proposal', title: '账号页自助重置入口', meta: ['idle', '待规划'],
      intent: '用户在登录页自助找回密码，不经过客服。', source: '会话「密码重置」10:47', unknown: '是否支持短信；找回频率限制。' },
    { id: 'PRO-0007', kind: '提案', col: 'proposal', title: '支付网关', meta: ['decide', '设计中 · 等你决定'], session: 's2',
      intent: '统一接入两家支付渠道：下单、回调、退款、对账。', source: '会话「支付网关设计」', unknown: '首版是否支持部分退款。' },
    { id: 'PRO-0009', kind: '提案', col: 'proposal', title: '通知偏好', meta: ['idle', '待规划'],
      intent: '用户选择接收哪些通知、通过什么渠道。', source: '会话「通知偏好讨论」', unknown: '与营销邮件退订的关系。' },
    { id: 'REQ-0043', kind: '实施需求', col: 'todo', title: '退款二次确认', meta: ['idle', '依赖 REQ-0041'],
      goal: '大额退款前要求二次确认，避免误操作。', accept: ['≥ 5000 元退款必须二次确认', '确认记录写入审计'], source: 'PRO-0007 设计产出' },
    { id: 'REQ-0042', kind: '实施需求', col: 'doing', title: '客服端临时重置链接', dynamic: true, session: 's1',
      goal: '客服在后台为用户生成一次性重置链接，替代电话改密。',
      accept: ['链接 30 分钟内可用一次，之后失效', '重置后旧会话全部下线', '过期 / 已用链接显示明确原因', '操作写入审计日志'],
      source: '会话「密码重置」· 用户选定方案 B' },
    { id: 'REQ-0038', kind: '实施需求', col: 'done', title: '结算按钮文案改为「保存」', meta: ['done', '已完成 · 10/18'], session: 's4',
      goal: '统一结算页按钮文案。', accept: ['结算页、编辑弹窗文案一致'], source: '会话「结算按钮文案」',
      summary: '替换 2 处文案；独立检查确认无行为变化；已提交 a91c3e2。' },
  ],

  invalid: { path: '.dev/requirements/REQ-0046.md', line: 5, reason: 'status「doing」不是合法状态',
    raw: '---\nid: REQ-0046\nkind: implementation\ntitle: 退款原路返回\nstatus: doing\n---' },

  providers: [
    { name: 'Anthropic', base: 'https://api.anthropic.com', models: 'claude-opus-5-5 · claude-sonnet-5-5 · claude-haiku-5-5', state: ['done', '可用'] },
    { name: '本地推理', base: 'http://10.0.0.12:8000/v1', models: 'qwen3-coder-32b', state: ['block', '连接被拒绝'] },
  ],
  models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'qwen3-coder-32b'],
  roles: [
    ['主管', 'claude-opus-5-5'], ['设计', 'claude-opus-5-5'], ['开发', 'claude-sonnet-5-5'],
    ['审核', 'claude-opus-5-5', 'claude-sonnet-5-5'], ['测试', 'claude-sonnet-5-5'], ['结算', 'claude-haiku-5-5'], ['调查', 'claude-sonnet-5-5'],
  ],
};
