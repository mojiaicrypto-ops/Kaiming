/* Chat view: renders slots into the chat page regions. Regions are patched in place
   (#c-sess #c-banner #c-strip #c-tx #c-dock #c-pop #c-drawer) so the composer keeps focus. */
(() => {
  const C = window.Chat;
  const { esc, md } = C;
  const PH = { clarify: '澄清', analyze: '分析', design: '设计', plan: '计划', develop: '开发', review: '审核', test: '测试', settle: '结算' };
  C.PH = PH;
  const st = (k, t = '') => `<span class="st ${k}">${t}</span>`;
  const glyph = { running: 'run', ok: 'done', failed: 'block', args: 'wait', pending: 'wait' };
  const secs = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
  const parse = (a) => { try { return JSON.parse(a); } catch { return null; } };
  const field = (raw, k) => { const m = new RegExp(`"${k}":"([^"]*)`).exec(raw || ''); return m ? m[1] : ''; };
  const openAttr = (k) => (C.ui.open.has(k) ? ' open' : '');
  const label = (sid) => C.meta[sid]?.label || sid;

  /* ---------- tool cards ---------- */
  function argSummary(name, raw, a) {
    if (a) return a.command || a.path || a.pattern || [a.op, a.requirementId || a.taskId].filter(Boolean).join(' ') || a.title || '';
    return field(raw, 'command') || field(raw, 'path') || field(raw, 'op') || raw.slice(0, 60);
  }
  function generic(sid, b, t, status) {
    const a = parse(b.arguments);
    const k = `${sid}:${b.id}`;
    const time = t?.ms ? secs(t.ms) : status === 'running' ? secs(Date.now() - t.t0) : status === 'args' ? '…' : '';
    const out = typeof t?.out === 'string' ? t.out : '';
    const tail = status === 'running' && out ? `<pre class="tc-tail">${esc(out.split('\n').slice(-4).join('\n'))}</pre>` : '';
    const body = `<div class="tc-sec">参数</div><pre>${esc(a ? JSON.stringify(a, null, 2) : b.arguments)}</pre>${t?.result || out ? `<div class="tc-sec">${status === 'failed' ? '错误' : '输出'}</div><pre class="${status === 'failed' ? 'err' : ''}">${esc(t.result || out)}</pre>` : ''}`;
    return `<details class="tc ${status}" data-k="${k}"${openAttr(k)}><summary>${st(glyph[status])}<span class="tn">${esc(b.name)}</span><span class="ts">${esc(argSummary(b.name, b.arguments, a))}</span><span class="tt">${status === 'failed' ? '失败 · ' : ''}${time}</span></summary>${body}</details>${tail}`;
  }

  function memberNote(sid) {
    const s = C.slots[sid]; if (!s) return '';
    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i]; if (it.role !== 'assistant') continue;
      for (let j = it.content.length - 1; j >= 0; j--) {
        const b = it.content[j]; if (!b) continue;
        if (b.type === 'toolCall' && b.name === 'agent_report') { const a = parse(b.arguments); return a?.summary ? `报告：${a.summary}` : '提交报告…'; }
        if (b.type === 'toolCall') { const t = s.tools[b.id]; return `${t?.status === 'running' ? '正在 ' : ''}${b.name} ${argSummary(b.name, b.arguments, parse(b.arguments))}`; }
        if (b.type === 'text' && b.text) return b.text.split('\n')[0].replace(/[*`#>|]/g, '').slice(0, 60);
        if (b.type === 'thinking') return '思考中…';
      }
    }
    return '已派发';
  }
  const actWord = (m) => (m.activity === 'processing' ? st('run', '运行中') : m.activity === 'waiting_user' ? st('decide', '等你回答')
    : m.last === 'completed' ? st('done', '已结束') : m.last === 'failed' ? st('block', '未通过') : m.last === 'stopped' ? st('paused', '已暂停') : st('idle', '空闲'));
  const memberRow = (m) => `<button class="mrow" data-act="c-drawer:${m.sessionId}">${actWord(m)}<span class="ml">${esc(m.label)}</span><span class="mn ell">${esc(memberNote(m.sessionId))}</span><span class="mo">跟随 ›</span></button>`;

  function taskTool(sid, b, t, status) {
    const a = parse(b.arguments) || {};
    const op = a.op || field(b.arguments, 'op');
    const task = C.srv.tasks[C.slot(sid).taskId];
    if (op === 'update' && a.phase && status === 'ok') return `<div class="ev">进入 ${PH[a.phase]}${a.summary ? ` · <span class="f3">${esc(a.summary)}</span>` : ''}</div>`;
    if (op === 'create' && status === 'ok') {
      return `<div class="obj"><div class="row">${st('done')}<b>建立任务 ${esc(task?.taskId || '')}</b><span class="f3">修改 · 标准代码 · ${esc(a.requirementId || '')}</span><span class="sp"></span><span class="lnk">plan.md</span></div>
        <div class="obj-b">${md(a.planMarkdown || '')}</div></div>`;
    }
    if (op === 'dispatch') {
      const n = a.sessions?.length || 0;
      const head = a.sessions?.[0]?.sessionId ? `继续 ${label(a.sessions[0].sessionId)}` : `派发 ${n} 名成员`;
      const rows = status === 'running' && task ? task.members.map(memberRow).join('') : '';
      const wait = status === 'running' ? st('run', `等待当前步骤全部成员 · ${secs(Date.now() - t.t0)}`) : status === 'ok' ? st('done', esc(t.result || '')) : st('wait', '准备派发…');
      if (status === 'ok') return `<div class="tline">${st('done')}<span class="tn">${head}</span><span class="ts">${esc(t.result || '')}</span><span class="tt">${t.ms ? secs(t.ms) : ''}</span></div>`;
      return `<div class="obj disp ${status}"><div class="row"><b>${head}</b><span class="sp"></span>${wait}</div>${rows ? `<div class="mlist">${rows}</div>` : ''}</div>`;
    }
    if (op === 'end' && status === 'ok') return `<div class="ev">${st('done', '任务已结束')}</div>`;
    return generic(sid, b, t, status);
  }
  function questionTool(sid, b, t, status) {
    const a = parse(b.arguments) || {};
    const ask = C.srv.asks.find((x) => x.title === a.title);
    const ans = ask && ask.answered ? st('done', `已答复：${esc(ask.echo)}`) : st('decide', '等你回答');
    return `<div class="askline${ask?.answered ? ' ok' : ''}">${st(ask?.answered ? 'done' : 'decide')}<span>提问：<b>${esc(a.title || field(b.arguments, 'title'))}</b></span><span class="sp"></span>${status === 'args' ? '…' : ans}</div>`;
  }
  function reportTool(sid, b, t, status) {
    const a = parse(b.arguments) || {};
    const v = a.verdict;
    const cls = v === 'failed' ? 'block' : v === 'passed' ? 'done' : '';
    return `<div class="rep ${cls}"><div class="row"><b>报告</b>${v ? st(cls, v === 'passed' ? '通过' : '未通过') : ''}<span class="f2">${esc(a.summary || '')}</span><span class="sp"></span><span class="f3">${status === 'ok' ? esc((t.result || '').replace('report saved · ', '')) : '保存中…'}</span></div></div>`;
  }
  function tool(sid, b, item) {
    const t = C.slot(sid).tools[b.id];
    const status = t?.status || (item.streaming ? 'args' : 'pending');
    if (b.name === 'task') return taskTool(sid, b, t, status);
    if (b.name === 'question') return questionTool(sid, b, t, status);
    if (b.name === 'agent_report') return reportTool(sid, b, t, status);
    if (b.name === 'requirement' && status === 'ok' && /saved/.test(t.result || '')) return `<div class="ev ok">${st('done', esc(t.result.replace('saved ', '已保存 ')))}</div>`;
    return generic(sid, b, t, status);
  }

  /* ---------- messages ---------- */
  function item(sid, it) {
    if (it.role === 'user') return `<div class="m user"><div class="who">你<span class="t">${it.t}</span></div><div class="body"><p>${esc(it.text)}</p></div></div>`;
    const blocks = it.content.map((b, i) => {
      if (!b) return '';
      if (b.type === 'thinking') {
        const k = `${sid}:${it.id}:k${i}`;
        return `<details class="think${b.live ? ' live' : ''}" data-k="${k}"${openAttr(k)}><summary>${b.live ? `${st('run', '')}思考中 <span class="f3 ell">${esc(b.thinking.slice(-50))}</span>` : `✻ 思考 · ${b.thinking.length} 字`}</summary><div class="think-b">${esc(b.thinking)}</div></details>`;
      }
      if (b.type === 'text') return `<div class="md">${md(b.text)}${it.streaming && i === it.content.length - 1 ? '<span class="cursor">▍</span>' : ''}</div>`;
      return tool(sid, b, it);
    }).join('');
    if (!blocks && !it.streaming && it.stopReason !== 'aborted') return '';
    const isChief = !C.meta[sid]?.role;
    const stop = it.stopReason === 'aborted' ? `<div class="stopped">■ 已停止 · 已输出的内容保留</div>` : '';
    const who = isChief ? '主管' : label(sid);
    return `<div class="m ${isChief ? 'chief' : 'agent'}"><div class="who">${who}<span class="t">${it.t}</span></div><div class="body">${blocks || (stop ? '' : `<span class="f3">${st('run', '')}</span>`)}${stop}</div></div>`;
  }
  C.transcript = (sid) => {
    const s = C.slot(sid);
    // Group consecutive assistant messages of one turn under one header.
    let html = ''; let prevAssistant = false;
    s.items.forEach((it) => {
      const h = item(sid, it);
      if (!h) return;
      const cont = it.role === 'assistant' && prevAssistant;
      html += cont ? h.replace('<div class="m ', '<div class="m cont ') : h;
      prevAssistant = it.role === 'assistant';
    });
    const running = Object.values(s.tools).some((t) => t.status === 'running');
    const liveNow = s.items.some((x) => x.streaming);
    if (s.busy === 'processing' && !liveNow && !running) html += `<div class="busy">${st('run', '')}${C.meta[sid]?.role ? '正在处理…' : '主管正在处理…'}</div>`;
    return html;
  };

  /* ---------- regions ---------- */
  C.sessGlyph = (sid) => {
    const s = C.slot(sid); const t = C.srv.tasks[s.taskId];
    if (s.pending.some((a) => !a.answered)) return 'decide';
    if (t?.status === 'paused') return 'paused';
    if (t?.status === 'waiting' && t.note) return 'decide';
    if (t?.status === 'completed') return 'done';
    if (s.busy !== 'idle' || (t && t.status === 'active')) return 'run';
    return t ? 'idle' : sid === 's4' || sid === 's3' ? 'done' : 'idle';
  };
  function taskState(sid, t) {
    const s = C.slot(sid);
    const run = t.members.filter((m) => m.activity === 'processing').length;
    if (t.status === 'completed') return st('done', '已完成');
    if (t.status === 'pausing') return st('wait', '暂停请求已收到 · 等待成员停稳');
    if (t.status === 'paused') return st('paused', '已暂停 · 已有成果保留');
    if (s.pending.some((a) => !a.answered)) return st('decide', '等你决定');
    if (t.status === 'waiting' && t.note) return st('decide', esc(t.note));
    if (run) return st('run', `正在执行 · ${run} 个 Agent`);
    return st('run', '主管处理中');
  }
  C.strip = (sid) => {
    const t = C.srv.tasks[C.slot(sid).taskId];
    if (!t) return '';
    const cur = t.status === 'completed' ? t.phases.length : t.phases.indexOf(t.phase);
    const ph = t.phases.map((p, i) => `<span class="p ${i < cur ? 'done' : i === cur ? 'cur' : ''}">${i < cur ? '✓ ' : ''}${PH[p]}</span>`).join('<span class="sep">─</span>');
    const ctl = t.status === 'paused' ? `<button class="btn ghost" data-act="c-resume">继续</button>`
      : ['active', 'waiting'].includes(t.status) ? `<button class="btn ghost" data-act="c-pause">暂停</button>` : '';
    const mem = t.members.length ? `<button class="chip-btn" data-act="c-members">成员 ${t.members.length} ${C.ui.members ? '▴' : '▾'}</button>` : '';
    const list = C.ui.members && t.members.length ? `<div class="mlist strip-m">${t.members.map(memberRow).join('')}</div>` : '';
    return `<div class="in"><span class="f3">${t.taskId}</span><span class="phases">${ph}</span>${mem}<span class="sp"></span>${taskState(sid, t)}${ctl}</div>${list}`;
  };
  C.banner = (sid) => {
    const s = C.slot(sid); const out = [];
    if (C.ui.conn === 'reconnecting') out.push(`<div class="bn run">${st('run', '连接已断开，正在重连')}<span class="f2">后台工作不受影响；重连后从快照合并，正在输出的内容不会丢</span></div>`);
    if (s.blocked) out.push(`<div class="bn block">${st('block', esc(s.blocked.code))}<span class="f2">${esc(s.blocked.detail)}</span><span class="sp"></span><button class="btn ghost" data-act="c-unblock">知道了</button></div>`);
    return out.join('');
  };
  C.dock = (sid) => {
    const s = C.slot(sid); const out = [];
    s.queued.forEach((q) => out.push(`<div class="queue">${st('wait', '排队中')}<span class="q ell">${esc(q.text)}</span><span class="f3">当前步骤结束后交给主管</span><button class="btn ghost" data-act="c-withdraw:${q.inputId}">撤回</button></div>`));
    const open = s.pending.filter((a) => !a.answered);
    if (open.length && C.ui.popupHidden) out.push(`<button class="qpill" data-act="c-popup">${st('decide', `${open.length} 个问题等待回答`)}<span class="f3">打开 ›</span></button>`);
    return out.join('');
  };

  /* Question panel: docked directly above the composer (the answer IS the next input),
     no overlay over the transcript. One question at a time; rows are keyboard-selectable. */
  C.askRows = (a) => (a.method === 'select' ? [...a.options.map((o) => ({ t: o })), { t: '输入其他答案…', other: true }]
    : a.method === 'confirm' ? [{ t: '确认', v: true }, { t: '拒绝', v: false }] : []);
  C.popup = (sid) => {
    const s = C.slot(sid);
    const list = s.pending.filter((a) => !a.gone);
    if (!list.length || C.ui.popupHidden) return '';
    const a = list.find((x) => !x.answered) || list[0];
    const idx = list.indexOf(a);
    const task = C.srv.tasks[a.taskId];
    const from = a.sourceSessionId === sid ? '主管' : label(a.sourceSessionId);
    const src = `${esc(from)}${task ? ` · ${task.taskId} / ${PH[task.phase]}` : ''}`;
    if (a.answered) {
      return `<div class="ask done" data-iid="${a.interactionId}"><div class="ask-h">${st('done')}<span class="ask-t">${esc(a.title)}</span><span class="sp"></span><span class="f3">${src}</span></div>
        <div class="ask-echo">答复已收到：<b>${esc(a.echo)}</b><span class="f3">已交给 ${esc(from)}，执行结果会单独报告</span></div></div>`;
    }
    const rows = C.askRows(a);
    const sel = Math.min(C.ui.sel ?? 0, Math.max(rows.length - 1, 0));
    const row = (r, i) => {
      const on = i === sel;
      if (r.other && C.ui.other) {
        return `<div class="ao on other"><span class="k">${i + 1}</span><input class="ao-in" id="c-ask-in" data-iid="${a.interactionId}" placeholder="输入你的答案，Enter 提交 · Esc 返回选项" aria-label="其他答案"></div>`;
      }
      return `<button class="ao${on ? ' on' : ''}${r.other ? ' other' : ''}" data-act="c-pick:${a.interactionId}:${i}"><span class="k">${i + 1}</span><span class="ao-t">${esc(r.t)}</span></button>`;
    };
    const body = a.method === 'input'
      ? `<div class="ao on other"><span class="k">›</span><input class="ao-in" id="c-ask-in" data-iid="${a.interactionId}" placeholder="${esc(a.placeholder || '输入内容…')}，Enter 提交" aria-label="${esc(a.title)}"></div>`
      : rows.map(row).join('');
    const keys = a.method === 'input' ? 'Enter 提交 · 留空使用默认 · Esc 稍后回答' : `↑↓ 选择 · Enter 确认 · 1-${rows.length} 直选 · Esc 稍后回答`;
    const prev = list.filter((x) => x.answered && x !== a).pop();
    return `<div class="ask" data-iid="${a.interactionId}" tabindex="-1" role="group" aria-label="等你回答：${esc(a.title)}">
      ${prev ? `<div class="ask-prev">${st('done')}<span class="f3 ell">${esc(prev.title)}</span><b>${esc(prev.echo)}</b><span class="f3">已收到</span></div>` : ''}
      <div class="ask-h">${st('decide')}<span class="ask-t">${esc(a.title)}</span><span class="sp"></span><span class="f3">${src}</span>${list.length > 1 ? `<span class="ask-n">${idx + 1}/${list.length}</span>` : ''}<button class="ask-x" data-act="c-later" title="稍后回答 (Esc)">稍后</button></div>
      ${a.message ? `<div class="ask-m">${esc(a.message)}</div>` : ''}
      <div class="ask-o">${body}</div>
      <div class="ask-f">${keys}<span class="sp"></span>答复直接回到提问方 · 未答复不视为同意</div>
    </div>`;
  };

  C.drawer = () => {
    const sid = C.ui.drawer; if (!sid) return '';
    const s = C.slot(sid);
    const busy = s.busy === 'processing' ? st('run', '运行中') : st('idle', '空闲');
    return `<div class="drawer-scrim" data-act="c-drawer-close"></div><aside class="drawer md-drawer" role="dialog" aria-label="成员会话">
      <div class="dh"><div><div class="f3">${sid} · 专业 Session</div><h2>${esc(label(sid))}</h2></div><span class="sp"></span>${busy}<button class="btn ghost" data-act="c-drawer-close">Esc</button></div>
      <div class="db scroll" id="c-dtx"><div class="tx-in drawer-tx">${C.transcript(sid) || '<span class="f3">还没有输出</span>'}</div></div>
      <div class="df f3">只读跟随 · 输入请回主管会话</div></aside>`;
  };
})();
