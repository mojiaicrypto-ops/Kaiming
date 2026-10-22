/* Mock data for the v2 prototype. Everything here is fake; nothing talks to a server. */
window.MOCK = (() => {
  const roles = {
    chief: { label: '主管', ab: '主' },
    designer: { label: '设计', ab: '设' },
    developer: { label: '开发', ab: '开' },
    reviewer: { label: '审核', ab: '审' },
    tester: { label: '测试', ab: '测' },
    settler: { label: '结算', ab: '结' },
    investigator: { label: '调查', ab: '调' },
  };

  const phaseNames = { clarify: '澄清', analyze: '分析', design: '设计', plan: '计划', develop: '开发', review: '审核', test: '测试', settle: '结算' };

  const projects = [
    { id: 'pay', name: 'payments-api', path: '/home/dev/work/payments-api', git: 'main', state: 'run', note: '1 个任务进行中' },
    { id: 'web', name: 'web-console', path: '/home/dev/work/web-console', git: 'develop', state: 'block', note: '1 项待核实' },
    { id: 'box', name: 'payments-api', path: '/home/dev/sandbox/payments-api', git: null, state: 'idle', note: '无版本管理' },
  ];

  const sessions = {
    pay: [
      { id: 's1', title: '密码重置', task: 't-4f21' },
      { id: 's2', title: '支付网关设计', task: 't-3a10', state: 'decide', meta: '等你决定 · 设计审阅中' },
      { id: 's3', title: '通知偏好讨论', task: null, state: 'idle', meta: '讨论 · 昨天' },
      { id: 's4', title: '结算按钮文案', task: 't-1c55', state: 'done', meta: '已完成 · 10/18' },
    ],
    web: [{ id: 'w1', title: '首页性能排查', task: 't-0f12', state: 'block', meta: '待核实 · 重启后' }],
    box: [],
  };

  const reqs = [
    { id: 'REQ-0042', kind: 'implementation', title: '客服端临时重置链接', status: 'in_progress', updated: '今天 11:02', task: 't-4f21', session: 's1',
      source: '会话「密码重置」10:47 · 用户决定选用方案 B', modules: ['.dev/product/account.md'], tech: ['.dev/technical/auth.md#令牌'], deps: [],
      goal: '客服在后台为用户生成一次性重置链接，替代电话改密，用户不再需要把新密码告诉客服。',
      scope: '处理：后台用户详情页生成链接、令牌签发与校验、过期与单次使用。不处理：用户自助入口（见 PRO-0010）、短信渠道。',
      behavior: '客服点击「生成重置链接」→ 返回 30 分钟有效的链接；用户打开后设置新密码，满足 12 位规则；令牌过期、已使用或被撤销时显示原因并引导联系客服。',
      accept: ['客服生成的链接 30 分钟内可用一次，之后失效', '重置后旧会话全部下线', '过期 / 已用链接显示明确原因', '操作写入审计日志，含客服身份'],
      unknown: '短信渠道是否需要（不阻止实施）。',
      summary: null },
    { id: 'REQ-0038', kind: 'implementation', title: '结算按钮文案改为「保存」', status: 'completed', updated: '10/18 16:20', task: 't-1c55', session: 's4',
      source: '会话「结算按钮文案」', modules: ['.dev/product/payments.md'], tech: [], deps: [],
      goal: '统一结算页按钮文案。', scope: '只改文案，不改变按钮行为。', behavior: '按钮显示「保存」。', accept: ['结算页、编辑弹窗文案一致'], unknown: '无',
      summary: '已替换 2 处文案；独立检查确认无行为变化；已提交 a91c3e2。' },
    { id: 'REQ-0035', kind: 'implementation', title: '导出对账 CSV', status: 'archived', updated: '09/30 09:12', task: 't-0c90', session: null,
      source: 'PRO-0004 设计产出', modules: ['.dev/product/payments.md'], tech: [], deps: [], goal: '财务按日导出对账数据。', scope: '—', behavior: '—', accept: ['—'], unknown: '无',
      summary: '已完成并归档。本环境没有该任务的详细执行记录。' },
    { id: 'REQ-0030', kind: 'implementation', title: '旧版短信验证码登录', status: 'cancelled', updated: '09/21 14:03', task: null, session: null,
      source: '用户决定 09/21', modules: [], tech: [], deps: [], goal: '—', scope: '—', behavior: '—', accept: ['—'], unknown: '—', summary: '用户取消：改走邮件渠道。' },
    { id: 'PRO-0010', kind: 'proposal', title: '账号页自助重置入口', status: 'pending', updated: '今天 10:47', session: 's1',
      intent: '用户在登录页自助找回密码，不经过客服。', origin: '会话「密码重置」10:47', limits: '依赖邮件发送可靠性；需先完成 REQ-0042 的令牌能力。', unknown: '是否同时支持短信；找回频率限制。', outputs: [], design: null },
    { id: 'PRO-0007', kind: 'proposal', title: '支付网关', status: 'planning', updated: '今天 09:30', session: 's2',
      intent: '统一接入多家支付渠道，支持下单、回调、退款和对账。', origin: '会话「支付网关设计」', limits: '首版只接两家渠道。', unknown: '是否首版支持部分退款（等你决定）。', outputs: [], design: 't-3a10' },
    { id: 'PRO-0009', kind: 'proposal', title: '通知偏好', status: 'pending', updated: '昨天 18:11', session: 's3',
      intent: '用户选择接收哪些通知、通过什么渠道。', origin: '会话「通知偏好讨论」· 只读分析 t-2b07', limits: '—', unknown: '与营销邮件退订的关系。', outputs: [], design: null },
    { id: 'PRO-0004', kind: 'proposal', title: '对账能力', status: 'archived', updated: '09/12 10:00', session: null,
      intent: '财务对账。', origin: '历史会话', limits: '—', unknown: '—', outputs: ['REQ-0035'], design: 't-0b31' },
    { id: 'PRO-0003', kind: 'proposal', title: '多币种结算', status: 'cancelled', updated: '09/02 11:40', session: null,
      intent: '—', origin: '—', limits: '—', unknown: '—', outputs: [], design: null },
  ];

  const invalidReqs = [
    { path: '.dev/requirements/REQ-0046.md', line: 5, reason: 'status「doing」不是实施需求的合法状态（可用：pending / in_progress / completed / cancelled / archived）',
      raw: ['---', 'schemaVersion: 2', 'id: REQ-0046', 'kind: implementation', 'status: doing', 'title: 退款原路返回', 'createdAt: 2026-10-19T08:11:02Z', 'updatedAt: 2026-10-20T02:40:51Z', '---', '', '## 目标', '退款按原支付渠道返回……'] },
  ];

  const reqStatus = {
    pending: { proposal: ['待规划', 'idle'], implementation: ['待实现', 'idle'] },
    planning: ['规划中', 'run'], in_progress: ['进行中', 'run'], completed: ['已完成', 'done'],
    archived: ['已归档', 'wait'], cancelled: ['已取消', 'wait'],
  };

  const tasks = [
    { id: 't-4f21', type: 'write', kind: '标准代码', title: '客服端临时重置链接', req: 'REQ-0042', session: 's1', dynamic: true },
    { id: 't-3a10', type: 'write', kind: '设计', title: '支付网关设计', req: 'PRO-0007', session: 's2', phase: 'review', state: 'decide', stateText: '等你决定：首版是否支持部分退款', started: '今天 08:55',
      phases: [['analyze', 'done'], ['design', 'done'], ['review', 'decide'], ['settle', 'todo']], members: [['designer', '交易与退款模块', 'done', '产出 4 个模块草案'], ['reviewer', '设计独立审阅', 'decide', '等你决定 1 项']] },
    { id: 't-2b07', type: 'read', kind: '专业分析', title: '通知渠道现状调查', req: null, session: 's3', phase: 'analyze', state: 'done', stateText: '已完成 · 报告保存在工作台', started: '昨天 17:40',
      phases: [['analyze', 'done']], members: [['investigator', '通知渠道调查', 'done', '报告 1 份']] },
    { id: 't-1c55', type: 'write', kind: '轻量修改', title: '结算按钮文案', req: 'REQ-0038', session: 's4', phase: 'settle', state: 'done', stateText: '已完成 · 已提交 a91c3e2', started: '10/18 15:52',
      phases: [['plan', 'done'], ['develop', 'done'], ['review', 'done'], ['settle', 'done']], members: [['developer', '文案替换', 'done', '2 处'], ['reviewer', '独立检查', 'done', '通过'], ['settler', '结算', 'done', '已提交']] },
  ];

  const models = {
    providers: [
      { name: 'Anthropic', base: 'https://api.anthropic.com', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], key: true, state: 'done', check: '2 分钟前 · 正常' },
      { name: '本地推理', base: 'http://10.0.0.12:8000/v1', models: ['qwen3-coder-32b'], key: false, state: 'block', check: '连接被拒绝（ECONNREFUSED）' },
    ],
    roles: [
      ['chief', 'claude-opus-5-5', '全局默认'], ['designer', 'claude-opus-5-5', '全局默认'], ['developer', 'claude-sonnet-5-5', '角色设置'],
      ['reviewer', 'claude-opus-5-5', '本项目覆盖'], ['tester', 'claude-sonnet-5-5', '角色设置'], ['settler', 'claude-haiku-5-5', '角色设置'], ['investigator', 'claude-sonnet-5-5', '角色设置'],
    ],
  };

  const tree = [
    { p: 'AGENTS.md', k: 'k' },
    { p: '.dev/', d: 1, open: 1 },
    { p: '.dev/INDEX.md', k: 'k' }, { p: '.dev/PROJECT.md', k: 'k' }, { p: '.dev/issues.md', k: 'k' },
    { p: '.dev/product/', d: 1, open: 1 }, { p: '.dev/product/account.md', k: 'k' }, { p: '.dev/product/payments.md', k: 'k' },
    { p: '.dev/technical/', d: 1, open: 1 }, { p: '.dev/technical/auth.md', k: 'k' },
    { p: '.dev/maps/', d: 1 }, { p: '.dev/requirements/', d: 1 },
    { p: '.dev/work/', d: 1, open: 1 }, { p: '.dev/work/t-4f21/', d: 1, open: 1 }, { p: '.dev/work/t-4f21/plan.md' },
    { p: 'src/', d: 1, open: 1 }, { p: 'src/auth/', d: 1, open: 1 },
    { p: 'src/auth/admin.ts' }, { p: 'src/auth/reset-link.ts' }, { p: 'src/auth/reset-link.test.ts' },
    { p: 'web/', d: 1 }, { p: 'docs/', d: 1, open: 1 }, { p: 'docs/architecture.png' }, { p: 'package.json' },
  ];

  const files = {
    'src/auth/reset-link.ts': `import { randomBytes, createHash } from 'node:crypto';
import { db } from '../db';
import { audit } from '../audit';

const TTL_MS = 30 * 60 * 1000;

/** Issue a single-use reset link for a user. Called from the admin console. */
export async function issueResetLink(adminId: string, userId: string) {
  const raw = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(raw).digest('hex');
  await db.resetTokens.insert({ userId, hash, expiresAt: Date.now() + TTL_MS });
  await audit('reset_link.issued', { adminId, userId });
  return \`/reset?token=\${raw}\`;
}

export async function consumeResetToken(raw: string) {
  const hash = createHash('sha256').update(raw).digest('hex');
  const row = await db.resetTokens.findByHash(hash);
  if (!row) return { ok: false, reason: 'not_found' } as const;
  if (row.usedAt) return { ok: false, reason: 'used' } as const;
  if (row.expiresAt < Date.now()) return { ok: false, reason: 'expired' } as const;
  await db.resetTokens.markUsed(row.id);
  return { ok: true, userId: row.userId } as const;
}`,
    'package.json': `{
  "name": "payments-api",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}`,
  };

  return { roles, phaseNames, projects, sessions, reqs, invalidReqs, reqStatus, tasks, models, tree, files };
})();
