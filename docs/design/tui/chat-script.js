/* Chat script builder: turns high-level "who says / which tool runs" into the Pi frame
   sequence the reducer consumes. A step is one of:
     { d, s, f }        frame f for session s after d ms (f may be a function, evaluated at play time)
     { d, srv: fn }     mutate the mock server (task.get / pending reads)
     { gate: id }       stop until interaction id is answered
     { deliver: sid }   hand queued user inputs to the chief (retained inputs, M4) */
(() => {
  const C = window.Chat;
  let seq = 0;
  const chunk = (t, n) => { const a = []; for (let i = 0; i < t.length; i += n) a.push(t.slice(i, i + n)); return a; };

  C.builder = (steps, instant = false) => {
    const dd = (d) => (instant ? 0 : d);
    const F = (s, event, d = 0, extra = {}) => steps.push({ d: dd(d), s, f: { type: 'pi', seq: ++seq, event, ...extra } });
    const upd = (s, x, d) => F(s, { type: 'message_update', assistantMessageEvent: x }, d);
    const b = {
      wait: (d) => steps.push({ d: dd(d) }),
      srv: (fn, d = 0) => steps.push({ d: dd(d), srv: fn }),
      inv: (s, entity, id, d = 0) => steps.push({ d: dd(d), s, f: { type: 'invalidate', entity, id } }),
      gate: (id) => steps.push({ gate: id }),
      deliver: (s) => steps.push({ deliver: s }),
      branch: (fn) => steps.push({ branch: () => { const sub = []; fn(C.builder(sub, instant)); return sub; } }),
      start: (s) => F(s, { type: 'agent_start' }, 150),
      end: (s) => F(s, { type: 'agent_end' }, 150),
      user: (s, text, t, inputId) => F(s, { type: 'message_end', t, message: { role: 'user', content: [{ type: 'text', text }] } }, 250, { inputId }),

      /* one assistant message: optional thinking, text, tool calls (args stream as JSON) */
      say(s, o) {
        F(s, { type: 'message_start', t: o.t, message: { role: 'assistant' } }, 200);
        let i = 0;
        if (o.think) {
          upd(s, { type: 'thinking_start', contentIndex: i }, 80);
          chunk(o.think, 4).forEach((c) => upd(s, { type: 'thinking_delta', contentIndex: i, delta: c }, 30));
          upd(s, { type: 'thinking_end', contentIndex: i }, 120); i++;
        }
        if (o.text) {
          upd(s, { type: 'text_start', contentIndex: i }, 80);
          chunk(o.text, 3).forEach((c) => upd(s, { type: 'text_delta', contentIndex: i, delta: c }, 22)); i++;
        }
        (o.tools || []).forEach((t) => {
          upd(s, { type: 'toolcall_start', contentIndex: i, id: t.id, name: t.name }, 120);
          chunk(JSON.stringify(t.args), 10).forEach((c) => upd(s, { type: 'toolcall_delta', contentIndex: i, delta: c }, 14)); i++;
        });
        F(s, { type: 'message_end', message: { role: 'assistant', stopReason: o.tools?.length ? 'toolUse' : 'stop' } }, 80);
        (o.tools || []).forEach((t) => { if (!t.defer) b.exec(s, t); });
      },

      begin(s, t) {
        F(s, { type: 'tool_execution_start', toolCallId: t.id, toolName: t.name }, 150);
        if (t.onStart) b.srv(t.onStart);
      },
      out(s, id, text, d = 220) { F(s, { type: 'tool_execution_update', toolCallId: id, partialResult: text }, d); },
      finish(s, t) {
        if (t.onEnd) b.srv(t.onEnd);
        const result = t.result ?? '';
        const mk = (r) => [
          { type: 'pi', seq: ++seq, event: { type: 'tool_execution_end', toolCallId: t.id, isError: !!t.err, result: r, ms: t.ms } },
          { type: 'pi', seq: ++seq, event: { type: 'message_end', message: { role: 'toolResult', toolCallId: t.id, isError: !!t.err, content: [{ type: 'text', text: r }] } } },
        ];
        if (typeof result === 'function') {
          steps.push({ d: dd(t.dur ?? 300), s, f: () => mk(result())[0] });
          steps.push({ d: 0, s, f: () => mk(result())[1] });
        } else {
          const [a, c] = mk(result);
          steps.push({ d: dd(t.dur ?? 300), s, f: a }, { d: 0, s, f: c });
        }
      },
      /* run a tool to the end: start → streamed output lines → end + toolResult */
      exec(s, t) {
        b.begin(s, t);
        let acc = '';
        (t.lines || []).forEach((l) => { acc += (acc ? '\n' : '') + l; b.out(s, t.id, acc, t.step ?? 240); });
        if (t.result === undefined && t.lines) t.result = acc;
        b.finish(s, t);
      },
    };
    return b;
  };

  /* ---------- mock server helpers ---------- */
  const task = () => C.srv.tasks['t-4f21'];
  const mem = (sid, patch) => () => { const m = task().members.find((x) => x.sessionId === sid); Object.assign(m, patch); };
  const addMem = (list) => () => { list.forEach((m) => task().members.push({ activity: 'processing', last: null, ...m })); };
  const phase = (p) => () => { task().phase = p; task().members = []; };
  const report = (kind, path, verdict) => () => task().reports.push({ kind, path, verdict });

  /* ---------- seeded history (instant) ---------- */
  C.seed = () => {
    C.meta = {
      s1: { label: '主管' }, s2: { label: '主管' }, s3: { label: '主管' }, s4: { label: '主管' },
      's-a1': { label: '开发 · 后端', role: 'developer' }, 's-a2': { label: '开发 · 前端', role: 'developer' },
      's-r1': { label: '审核', role: 'reviewer' }, 's-t1': { label: '测试', role: 'tester' }, 's-x1': { label: '结算', role: 'settler' },
      's-d1': { label: '设计', role: 'designer' }, 's-v1': { label: '设计审阅', role: 'reviewer' },
    };
    const st = []; const b = C.builder(st, true);
    // s1 — discussion already happened
    b.user('s1', '我想给账号加密码重置，先聊聊有没有必要。现在客户都是打电话找客服改密码。', '10:42');
    b.start('s1');
    b.say('s1', { t: '10:43', think: '先看现有账号模块和邮件能力，再给选项。', tools: [
      { id: 'h1', name: 'read', args: { path: 'src/auth/admin.ts' }, result: 'export async function resetPassword(adminId, targetId) { … }  (214 lines)' },
      { id: 'h2', name: 'grep', args: { pattern: 'sendMail', path: 'src/' }, result: 'src/invite/send.ts:12\nsrc/invite/send.ts:40\nsrc/billing/notify.ts:8' }] });
    b.say('s1', { text: '值得做。现在只有**管理员重置接口**，没有自助入口；邮件只在邀请流程使用，失败没有重试。\n\n两个方向：\n- **A** 邮件自助重置：覆盖面大，需要先补邮件可靠性\n- **B** 客服后台生成一次性链接：范围小，可以先做\n\n你倾向哪个？' });
    b.end('s1');
    b.user('s1', '先做 B，自助入口记下来以后做。保存为需求。', '10:46');
    b.start('s1');
    b.say('s1', { t: '10:47', tools: [
      { id: 'h3', name: 'requirement', args: { op: 'save', requirementId: 'REQ-0042', kind: 'implementation', title: '客服端临时重置链接', status: 'pending' }, result: 'saved REQ-0042 · implementation · pending' },
      { id: 'h4', name: 'requirement', args: { op: 'save', requirementId: 'PRO-0010', kind: 'proposal', title: '账号页自助重置入口', status: 'pending' }, result: 'saved PRO-0010 · proposal · pending' }] });
    b.say('s1', { text: '已保存两条记录，**不会自动开始开发**：\n- REQ-0042 客服端临时重置链接 · 实施需求\n- PRO-0010 账号页自助重置入口 · 提案' });
    b.end('s1');

    // s2 — design task waiting on a reviewer question
    b.srv(() => {
      C.srv.tasks['t-3a10'] = { taskId: 't-3a10', type: 'write', kind: '设计', title: '支付网关设计', req: 'PRO-0007', phase: 'review', status: 'waiting', phases: ['analyze', 'design', 'review', 'settle'],
        members: [{ sessionId: 's-v1', roleId: 'reviewer', label: '设计审阅', activity: 'waiting_user', last: null }], reports: [] };
      C.srv.asks.push({ interactionId: 'q-s2', chief: 's2', sourceSessionId: 's-v1', method: 'select', taskId: 't-3a10',
        title: '首版是否支持部分退款？', message: '原意图写“支持退款”，退款模块草案只定义了全额退款。影响 REQ-0043 的验收与对账模块。',
        options: ['支持部分退款', '首版只做全额退款，部分退款另存提案', '先不决定，其余设计继续'] });
    });
    b.user('s2', '先设计支付网关，不要开发。首版接两家渠道。', '08:52');
    b.start('s2');
    b.say('s2', { t: '08:55', text: '好，只做设计，不会自动开发。我建立了设计任务 t-3a10，设计完成后交给独立审阅。', tools: [
      { id: 'h5', name: 'task', args: { op: 'create', type: 'write', goal: '支付网关设计', requiresTest: false }, result: 'taskId=t-3a10 phase=analyze' }] });
    b.say('s2', { t: '09:40', tools: [{ id: 'h6', name: 'task', args: { op: 'dispatch', taskId: 't-3a10', sessions: [{ roleId: 'reviewer', label: '设计审阅' }] }, defer: true }] });
    b.begin('s2', { id: 'h6', name: 'task' });
    b.inv('s2', 'task', 't-3a10'); b.inv('s2', 'interaction', 'q-s2');

    // s3, s4 — finished conversations
    b.user('s3', '通知偏好有没有必要做？先看看现在有哪些通知渠道。', '昨天 17:35');
    b.say('s3', { t: '18:11', text: '值得做。现在只有**邮件**和**站内信**两个渠道，没有退订记录表。按你的要求已保存为提案 PRO-0009。', tools: [
      { id: 'h7', name: 'requirement', args: { op: 'save', requirementId: 'PRO-0009', kind: 'proposal' }, result: 'saved PRO-0009' }] });
    b.user('s4', '把结算按钮的「提交」改成「保存」。', '10/18 15:50');
    b.say('s4', { t: '16:20', text: '已完成：替换 2 处文案，独立检查确认没有行为变化，已提交 `a91c3e2`。' });
    return st;
  };

  C.helpers = { task, mem, addMem, phase, report };
})();
