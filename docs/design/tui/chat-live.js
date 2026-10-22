/* Live scenario for session s1: "实现 REQ-0042" from Plan to settlement.
   Chief channel: chief messages + task tool cards + pending interactions.
   Member sessions (s-a1 …) stream into their own slots (opened via the member drawer). */
(() => {
  const C = window.Chat;
  const { task, mem, addMem, phase, report } = C.helpers;
  const ans = (id) => () => { const a = C.srv.answers[id]; return a === undefined ? '' : typeof a === 'boolean' ? (a ? 'confirmed' : 'declined') : `answer: ${a}`; };

  C.liveScript = () => {
    const st = []; const b = C.builder(st);
    const S = 's1';

    b.wait(600);
    b.user(S, '实现 REQ-0042。', undefined, 'in-1');
    b.start(S);
    b.say(S, { think: '用户明确要求实施 REQ-0042，这是实施授权。先读需求与依据，确认没有阻止实施的未知。', tools: [
      { id: 'c1', name: 'requirement', args: { op: 'get', requirementId: 'REQ-0042' }, result: 'REQ-0042 · implementation · pending\n验收 4 条 · 依据 account.md#密码重置, auth.md#令牌 · 未知：短信渠道（不阻止）', dur: 500 },
      { id: 'c2', name: 'read', args: { path: '.dev/technical/auth.md' }, result: '## 令牌\n- 随机 32 字节，存 sha256\n- 单次使用，过期时间由调用方给定', dur: 400 }] });
    b.say(S, { text: '依据充分：范围、验收与令牌契约都已定义。我建立修改任务并保存总体 Plan，按项目默认规则，你的实施指令已授权这份 Plan。', tools: [
      { id: 'c3', name: 'task', args: { op: 'create', type: 'write', goal: '客服端临时重置链接', requirementId: 'REQ-0042', requiresTest: true, planMarkdown: '1. 计划\n2. 开发：后端令牌 / 前端入口并行\n3. 独立审核\n4. 独立测试\n5. 结算' },
        onStart: () => { C.srv.tasks['t-4f21'] = { taskId: 't-4f21', type: 'write', kind: '标准代码', title: '客服端临时重置链接', req: 'REQ-0042', phase: 'plan', status: 'active',
          phases: ['plan', 'develop', 'review', 'test', 'settle'], members: [], reports: [{ kind: 'plan', path: '.dev/work/t-4f21/plan.md', verdict: 'passed' }] }; },
        result: 'taskId=t-4f21 · phase=plan · planRef=.dev/work/t-4f21/plan.md' }] });
    b.inv(S, 'task', 't-4f21');
    b.say(S, { tools: [{ id: 'c4', name: 'task', args: { op: 'update', taskId: 't-4f21', phase: 'develop', summary: '计划完成' }, onStart: phase('develop'), result: 'phase=develop' }] });
    b.inv(S, 'task', 't-4f21');

    /* ---- develop: two writers in parallel ---- */
    b.say(S, { text: '派发两位开发并行，写入范围不重叠。', tools: [
      { id: 'c5', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [
        { roleId: 'developer', label: '开发 · 后端', writeScope: ['src/auth/**'], instructions: '实现令牌签发/校验/单次使用，TDD' },
        { roleId: 'developer', label: '开发 · 前端', writeScope: ['web/admin/**'], instructions: '后台用户详情页加入生成入口' }] } }] });
    b.begin(S, { id: 'c5', name: 'task', onStart: addMem([
      { sessionId: 's-a1', roleId: 'developer', label: '开发 · 后端' }, { sessionId: 's-a2', roleId: 'developer', label: '开发 · 前端' }]) });
    b.inv(S, 'task', 't-4f21');

    const A = 's-a1', F = 's-a2';
    b.user(A, '实现令牌签发/校验/单次使用（src/auth/**），先写失败的单元测试。');
    b.start(A);
    b.say(A, { think: '先写测试：签发后可用一次、过期失败、重复使用失败、旧会话下线。', tools: [
      { id: 'a1', name: 'write', args: { path: 'src/auth/reset-link.test.ts' }, result: 'wrote 58 lines', dur: 300 }] });
    b.say(A, { tools: [{ id: 'a2', name: 'bash', args: { command: 'pnpm vitest run src/auth' }, err: true, step: 300,
      lines: ['RUN  v3.2.4 src/auth', ' ✗ reset-link.test.ts > issues a single-use link', '   Error: issueResetLink is not a function', ' Tests  1 failed | 12 passed (13)'] }] });

    b.user(F, '后台用户详情页加入「生成重置链接」入口（web/admin/**）。');
    b.start(F);
    b.say(F, { tools: [{ id: 'f1', name: 'read', args: { path: 'web/admin/UserDetail.tsx' }, result: 'export function UserDetail({ user }) { … }  (186 lines)', dur: 300 }] });
    b.say(F, { text: '需求没有写入口具体位置和按钮文案，我需要先问一下。', tools: [
      { id: 'f2', name: 'question', defer: true, args: { method: 'select', title: '临时重置链接的入口放在哪里？' } }] });
    b.begin(F, { id: 'f2', name: 'question', onStart: () => {
      C.srv.asks.push(
        { interactionId: 'q1', chief: S, sourceSessionId: F, method: 'select', taskId: 't-4f21', title: '临时重置链接的入口放在哪里？',
          message: '这会决定客服的操作路径和 E2E 用例。REQ-0042 只写了“后台用户详情页”。', options: ['客服后台 · 用户详情页（与需求一致）', '客服后台 · 工单侧栏', '先不做入口，只交付接口'] },
        { interactionId: 'q2', chief: S, sourceSessionId: F, method: 'input', taskId: 't-4f21', title: '按钮文案用什么？',
          message: '会出现在客服后台，留空则使用默认文案。', placeholder: '例如：生成重置链接' });
      mem(F, { activity: 'waiting_user' })();
    } });
    b.inv(S, 'interaction', 'q1');

    b.say(A, { tools: [{ id: 'a3', name: 'write', args: { path: 'src/auth/reset-link.ts' }, result: 'wrote 41 lines', dur: 400 }] });
    b.say(A, { tools: [{ id: 'a4', name: 'bash', args: { command: 'pnpm vitest run src/auth' }, step: 260,
      lines: ['RUN  v3.2.4 src/auth', ' ✓ password.test.ts (12 tests) 4.1s', ' ✓ reset-link.test.ts (5 tests) 1.2s', ' Tests  17 passed (17)'] }] });
    b.say(A, { text: '后端完成：签发、校验、过期、单次使用、审计。单元测试 17/17 通过。', tools: [
      { id: 'a5', name: 'agent_report', args: { summary: '后端令牌完成', checks: [{ name: 'unit', status: 'passed' }] }, result: 'report saved · .dev/work/t-4f21/s-a1/impl.md' }] });
    b.end(A);
    b.srv(mem(A, { activity: 'idle', last: 'completed' })); b.srv(report('impl', '.dev/work/t-4f21/s-a1/impl.md', 'passed'));
    b.inv(S, 'task', 't-4f21');

    b.gate('q1'); b.gate('q2');
    b.finish(F, { id: 'f2', name: 'question', result: () => `${ans('q1')()} · ${ans('q2')()}`, dur: 200 });
    b.srv(mem(F, { activity: 'processing' }));
    b.say(F, { text: '收到，按你的选择继续。', tools: [
      { id: 'f3', name: 'edit', args: { path: 'web/admin/UserDetail.tsx' }, result: '+36 −2', dur: 600 },
      { id: 'f4', name: 'bash', args: { command: 'pnpm vitest run web/admin -t reset' }, lines: [' ✓ renders button for admins', ' ✓ hides button for agents', ' Tests  4 passed (4)'] },
      { id: 'f5', name: 'agent_report', args: { summary: '前端入口完成', checks: [{ name: 'component', status: 'passed' }] }, result: 'report saved · .dev/work/t-4f21/s-a2/impl.md' }] });
    b.end(F);
    b.srv(mem(F, { activity: 'idle', last: 'completed' })); b.srv(report('impl', '.dev/work/t-4f21/s-a2/impl.md', 'passed'));
    b.finish(S, { id: 'c5', name: 'task', result: '当前步骤 2 名成员均已结束 · 2 份实施说明', dur: 300 });
    b.inv(S, 'task', 't-4f21');
    b.deliver(S);

    /* ---- review → fix → re-review ---- */
    b.say(S, { text: '开发完成，进入独立审核。', tools: [{ id: 'c6', name: 'task', args: { op: 'update', taskId: 't-4f21', phase: 'review', summary: '开发完成（2 份实施说明）' }, onStart: phase('review'), result: 'phase=review' }] });
    b.inv(S, 'task', 't-4f21');
    b.say(S, { tools: [{ id: 'c7', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [{ roleId: 'reviewer', label: '审核' }] } }] });
    b.begin(S, { id: 'c7', name: 'task', onStart: addMem([{ sessionId: 's-r1', roleId: 'reviewer', label: '审核' }]) });
    b.inv(S, 'task', 't-4f21');
    const R = 's-r1';
    b.user(R, '独立审核 REQ-0042 的实现与验收。');
    b.start(R);
    b.say(R, { think: '对照 4 条验收逐条检查实际代码，不读开发聊天。', tools: [
      { id: 'r1', name: 'bash', args: { command: 'git diff --stat main' }, lines: [' src/auth/reset-link.ts      | 41 +', ' src/auth/reset-link.test.ts | 58 +', ' web/admin/UserDetail.tsx    | 38 +-'] },
      { id: 'r2', name: 'read', args: { path: 'src/auth/reset-link.ts' }, result: '…consumeResetToken(raw) { … markUsed(row.id) … }', dur: 300 }] });
    b.say(R, { text: '**1 项阻止完成**：重置成功后没有使旧会话下线（验收 2），位置 `src/auth/reset-link.ts:24`。', tools: [
      { id: 'r3', name: 'agent_report', args: { verdict: 'failed', summary: '旧会话未下线' }, result: 'report saved · review-1.md · verdict=failed' }] });
    b.end(R);
    b.srv(mem(R, { activity: 'idle', last: 'failed' })); b.srv(report('review', '.dev/work/t-4f21/s-r1/review-1.md', 'failed'));
    b.finish(S, { id: 'c7', name: 'task', result: '审核 verdict=failed · 1 项阻断', dur: 200 });
    b.inv(S, 'task', 't-4f21');

    b.say(S, { text: '审核发现 1 个阻断问题，属于当前验收范围，我直接组织修复后复审，无需你重新批准。', tools: [
      { id: 'c8', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [{ sessionId: 's-a1', instructions: '修复：重置后使旧会话下线' }] } }] });
    b.begin(S, { id: 'c8', name: 'task', onStart: () => { task().members = [{ sessionId: A, roleId: 'developer', label: '开发 · 后端', activity: 'processing', last: null }]; } });
    b.inv(S, 'task', 't-4f21');
    b.user(A, '修复审核问题：重置成功后使旧会话下线（review-1.md）。');
    b.start(A);
    b.say(A, { tools: [
      { id: 'a6', name: 'edit', args: { path: 'src/auth/reset-link.ts' }, result: '+6 −1', dur: 400 },
      { id: 'a7', name: 'bash', args: { command: 'pnpm vitest run src/auth' }, lines: [' ✓ reset-link.test.ts (6 tests)', ' Tests  18 passed (18)'] },
      { id: 'a8', name: 'agent_report', args: { summary: '已修复旧会话下线' }, result: 'report saved · fix-1.md' }] });
    b.end(A);
    b.srv(mem(A, { activity: 'idle', last: 'completed' }));
    b.finish(S, { id: 'c8', name: 'task', result: '修复完成 · 1 份说明', dur: 200 });
    b.say(S, { tools: [{ id: 'c9', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [{ sessionId: 's-r1', instructions: '复审修复' }] } }] });
    b.begin(S, { id: 'c9', name: 'task', onStart: () => { task().members = [{ sessionId: R, roleId: 'reviewer', label: '审核', activity: 'processing', last: null }]; } });
    b.inv(S, 'task', 't-4f21');
    b.start(R);
    b.say(R, { text: '复审通过：问题已修复并有单元测试覆盖，无其他阻止项。', tools: [
      { id: 'r4', name: 'agent_report', args: { verdict: 'passed', summary: '复审通过' }, result: 'report saved · review-2.md · verdict=passed' }] });
    b.end(R);
    b.srv(mem(R, { activity: 'idle', last: 'completed' })); b.srv(report('review', '.dev/work/t-4f21/s-r1/review-2.md', 'passed'));
    b.finish(S, { id: 'c9', name: 'task', result: '审核 verdict=passed', dur: 200 });
    b.inv(S, 'task', 't-4f21');

    /* ---- test ---- */
    b.say(S, { tools: [{ id: 'c10', name: 'task', args: { op: 'update', taskId: 't-4f21', phase: 'test', summary: '审核 2 轮通过' }, onStart: phase('test'), result: 'phase=test' }] });
    b.inv(S, 'task', 't-4f21');
    b.say(S, { text: '进入独立测试：接口集成 + 真实浏览器 E2E。', tools: [{ id: 'c11', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [{ roleId: 'tester', label: '测试' }] } }] });
    b.begin(S, { id: 'c11', name: 'task', onStart: addMem([{ sessionId: 's-t1', roleId: 'tester', label: '测试' }]) });
    b.inv(S, 'task', 't-4f21');
    const T = 's-t1';
    b.user(T, '对 REQ-0042 执行接口集成与浏览器 E2E。');
    b.start(T);
    b.say(T, { tools: [{ id: 't1', name: 'bash', args: { command: 'pnpm test:api -- reset' }, step: 200,
      lines: ['▶ POST /admin/users/42/reset-link  201', '▶ GET  /reset?token=…  200', '▶ POST /reset (expired)  410', '▶ POST /reset (used)  409', '✓ 9 passed'] }] });
    b.say(T, { tools: [{ id: 't2', name: 'bash', args: { command: 'pnpm e2e reset-link.spec.ts' }, step: 320,
      lines: ['Running 6 tests using 2 workers', '  ✓ admin generates link (2.1s)', '  ✓ user sets new password (3.4s)', '  ✓ expired link shows reason (1.2s)', '  ✓ reused link shows reason (1.1s)', '  ✓ old sessions signed out (2.6s)', '  ✓ audit log records admin (0.9s)', '  6 passed (12.4s)'] }] });
    b.say(T, { text: '通过：接口集成 9/9、浏览器 E2E 6/6。', tools: [{ id: 't3', name: 'agent_report', args: { verdict: 'passed', summary: 'E2E 6/6' }, result: 'report saved · test-1.md · verdict=passed' }] });
    b.end(T);
    b.srv(mem(T, { activity: 'idle', last: 'completed' })); b.srv(report('test', '.dev/work/t-4f21/s-t1/test-1.md', 'passed'));
    b.finish(S, { id: 'c11', name: 'task', result: '测试 verdict=passed', dur: 200 });
    b.inv(S, 'task', 't-4f21');

    /* ---- settle ---- */
    b.say(S, { tools: [{ id: 'c12', name: 'task', args: { op: 'update', taskId: 't-4f21', phase: 'settle', summary: '测试通过' }, onStart: phase('settle'), result: 'phase=settle' }] });
    b.inv(S, 'task', 't-4f21');
    b.say(S, { tools: [{ id: 'c13', name: 'task', defer: true, args: { op: 'dispatch', taskId: 't-4f21', sessions: [{ roleId: 'settler', label: '结算' }] } }] });
    b.begin(S, { id: 'c13', name: 'task', onStart: addMem([{ sessionId: 's-x1', roleId: 'settler', label: '结算' }]) });
    b.inv(S, 'task', 't-4f21');
    const X = 's-x1';
    b.start(X);
    b.say(X, { tools: [
      { id: 'x1', name: 'edit', args: { path: '.dev/product/account.md' }, result: '+8 −2', dur: 300 },
      { id: 'x2', name: 'edit', args: { path: '.dev/maps/tests.md' }, result: '+3', dur: 300 },
      { id: 'x3', name: 'requirement', args: { op: 'save', requirementId: 'REQ-0042', status: 'completed' }, result: 'saved REQ-0042 · completed', dur: 300 },
      { id: 'x4', name: 'agent_report', args: { summary: '知识与需求已更新' }, result: 'report saved · settlement.md' }] });
    b.end(X);
    b.srv(mem(X, { activity: 'idle', last: 'completed' })); b.srv(report('settle', '.dev/work/t-4f21/s-x1/settlement.md', 'passed'));
    b.finish(S, { id: 'c13', name: 'task', result: '结算完成', dur: 200 });
    b.inv(S, 'task', 't-4f21');

    b.say(S, { tools: [{ id: 'c14', name: 'question', defer: true, args: { method: 'confirm', title: '提交本次成果到 main？' } }] });
    b.begin(S, { id: 'c14', name: 'question', onStart: () => {
      C.srv.asks.push({ interactionId: 'q3', chief: S, sourceSessionId: S, method: 'confirm', taskId: 't-4f21', title: '提交本次成果到 main？',
        message: '将提交 6 个文件（代码、测试、知识、REQ-0042 与交付记录）。工作区里 2 个无关改动不会纳入。' });
    } });
    b.inv(S, 'interaction', 'q3');
    b.gate('q3');
    b.finish(S, { id: 'c14', name: 'question', result: ans('q3'), dur: 200 });
    b.branch((x) => {
      if (C.srv.answers.q3 === false) {
        // Refused: the pending action must not run. Results stay, the Task stays open in settle.
        x.say(S, { text: '好，**不提交**。成果和交付记录保留在工作区，任务停在结算阶段、保持未完成——成果没有保存到版本库，不能算交付完成。\n\n你想提交时告诉我“提交”，我会重新确认一次再执行。', tools: [
          { id: 'c15n', name: 'task', args: { op: 'update', taskId: 't-4f21', status: 'waiting', blockReason: '用户拒绝提交', nextStep: '等待用户决定是否提交' }, onStart: () => { Object.assign(task(), { status: 'waiting', note: '未提交 · 等你决定是否提交' }); task().members = []; }, result: 'status=waiting' }] });
        x.inv(S, 'task', 't-4f21');
        return;
      }
      x.say(S, { tools: [
      { id: 'c15', name: 'bash', args: { command: 'git commit -m "feat(auth): admin reset link (REQ-0042)"' }, lines: ['[main 4c7e19b] feat(auth): admin reset link (REQ-0042)', ' 6 files changed, 151 insertions(+), 3 deletions(-)'] },
      { id: 'c16', name: 'task', args: { op: 'end', taskId: 't-4f21' }, onStart: () => { task().status = 'completed'; task().members = []; }, result: 'completed' }] });
      x.inv(S, 'task', 't-4f21');
      x.say(S, { text: '交付完成。\n\n| 项目 | 结果 |\n|---|---|\n| 改变 | 客服后台可生成 30 分钟一次性重置链接 |\n| 验证 | 单元 22/22 · 审核 2 轮 · 集成 9/9 · E2E 6/6 |\n| 未覆盖 | 短信渠道（需求标记为不阻止） |\n| 保存 | 已提交 `4c7e19b`，已更新 account 模块与 REQ-0042 |\n\n剩余：PRO-0010 自助入口待规划，可以在新会话里继续。' });
    });
    b.end(S);
    return st;
  };
})();
