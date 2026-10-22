/* Chat mount: page skeleton, in-place region painting, actions and keys for the chat page. */
(() => {
  const C = window.Chat;
  const st = (k, t = '') => `<span class="st ${k}">${t}</span>`;
  C.sessions = [];   // [{id,title}] provided by app.js
  C.cur = 's1';
  C.toast = () => {};

  C.page = () => `<div class="chat">
    <aside class="sessions" id="c-sess"></aside>
    <section class="conv">
      <div id="c-banner"></div>
      <div class="task-strip" id="c-strip" hidden></div>
      <div class="tx scroll" id="c-tx"><div class="tx-in" id="c-txin"></div></div>
      <div class="dock"><div class="dock-in">
        <button class="jump" id="c-jump" data-act="c-jump" hidden>↓ 回到最新</button>
        <div id="c-pop"></div>
        <div id="c-dock"></div>
        <div class="composer"><span class="pr">❯</span><textarea id="composer" rows="2" aria-label="消息"></textarea></div>
        <div class="hint" id="c-hint"></div>
      </div></div>
      <div id="c-drawer"></div>
    </section></div>`;

  const empty = () => `<div class="empty"><div class="logo">❯ AgentDev</div><h2>和主管聊聊你想做的事</h2>
    <p>先自由讨论，不会自动开发。说“保存”才会记成需求，说“实现”才开始交付。</p>
    <div class="ex">${['看看这个项目现在有哪些能力', '我想给账号加密码重置，先聊聊有没有必要', '先设计支付网关，不要开发'].map((x) => `<button data-act="c-ex:${x}">${x}</button>`).join('')}</div></div>`;

  const set = (sel, html) => { const el = document.querySelector(sel); if (el && el._h !== html) { el.innerHTML = html; el._h = html; } return el; };

  C.paint = () => {
    const tx = document.getElementById('c-tx'); if (!tx) return;
    const sid = C.cur; const s = C.slot(sid);
    set('#c-sess', `<div class="h">主管会话</div>${C.sessions.map((x) => `<button class="s" data-act="sess:${x.id}" ${x.id === sid ? 'aria-current="true"' : ''}>${st(C.sessGlyph(x.id))}<span class="ell">${x.title}</span></button>`).join('')}<button class="new" data-act="newsess">＋ 新建会话</button>`);
    set('#c-banner', C.banner(sid));
    const strip = set('#c-strip', C.strip(sid)); strip.hidden = !strip._h;

    const near = tx.scrollHeight - tx.scrollTop - tx.clientHeight < 90;
    set('#c-txin', s.items.length ? C.transcript(sid) : empty());
    if (near) tx.scrollTop = tx.scrollHeight;
    document.getElementById('c-jump').hidden = near || tx.scrollHeight <= tx.clientHeight;

    set('#c-dock', C.dock(sid));
    const keep = document.getElementById('c-ask-in'); const kv = keep?.value; const kid = keep?.dataset.iid; const kf = document.activeElement === keep;
    const open = s.pending.find((x) => !x.answered && !x.gone);
    if ((open?.interactionId || null) !== C.ui.popId) { C.ui.sel = 0; C.ui.other = false; }   // new question: reset selection
    set('#c-pop', C.popup(sid));
    const nin = document.getElementById('c-ask-in');
    const ask = document.querySelector('.ask:not(.done)');
    const pid = ask ? ask.dataset.iid : null;
    const typing = document.activeElement?.id === 'composer';
    if (pid && pid !== C.ui.popId && !typing) (nin || ask).focus();   // a new question takes focus once
    else if (nin && (kf || C.ui.focusIn)) { nin.focus(); C.ui.focusIn = false; }
    if (nin && kv && nin.dataset.iid === kid) nin.value = kv;   // keep a draft only for the same question
    C.ui.popId = pid;

    const dtx0 = document.getElementById('c-dtx'); const dnear = !dtx0 || dtx0.scrollHeight - dtx0.scrollTop - dtx0.clientHeight < 90;
    set('#c-drawer', C.drawer());
    const dtx = document.getElementById('c-dtx'); if (dtx && dnear) dtx.scrollTop = dtx.scrollHeight;

    const task = C.activeTask(sid);
    const free = !task && s.busy !== 'idle';
    const ta = document.getElementById('composer');
    ta.placeholder = task ? `任务 ${task.taskId} 进行中：消息会排队，作为当前任务的补充；新话题请新建会话` : free ? '主管正在回复…（可以先输入，Enter 后会排队）' : '和主管说说你的想法…';
    set('#c-hint', `<span>Enter 发送</span><span>Shift+Enter 换行</span>${free ? '<span class="sp"></span><button class="btn danger" data-act="c-stop">■ 停止</button>' : ''}`);
  };

  let raf = 0;
  C.listeners.push(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; C.paint(); C.onChange?.(); }); });
  setInterval(() => { if (Object.values(C.slots).some((s) => Object.values(s.tools).some((t) => t.status === 'running'))) C.paint(); }, 1000);
  document.addEventListener('toggle', (e) => { const k = e.target.dataset?.k; if (!k) return; if (e.target.open) C.ui.open.add(k); else C.ui.open.delete(k); }, true);

  function answer(iid, v) {
    const a = C.srv.asks.find((x) => x.interactionId === iid); if (!a) return;
    let val;
    if (v === 'input') {
      val = (document.getElementById('c-ask-in')?.value || '').trim();
      if (a.method === 'select' && !val) return;            // free text for select must not be empty
    } else {
      const r = C.askRows(a)[+v]; if (!r) return;
      if (r.other) { C.ui.sel = +v; C.ui.other = true; C.ui.focusIn = true; return; }
      val = 'v' in r ? r.v : r.t;
    }
    C.ui.other = false;
    if (C.answer(iid, val) === 'stale') C.toast('该问题已被处理，无需再次回答');
  }

  /* returns true when handled */
  C.act = (a) => {
    const [k, ...r] = a.split(':'); const v = r.join(':');
    switch (k) {
      case 'c-pause': C.pause(C.cur); C.toast('暂停请求已收到'); break;
      case 'c-resume': C.resume(C.cur); C.toast('继续：沿原任务接续'); break;
      case 'c-members': C.ui.members = !C.ui.members; break;
      case 'c-drawer': C.ui.drawer = v; break;
      case 'c-drawer-close': C.ui.drawer = null; break;
      case 'c-pick': { const [iid, n] = v.split(':'); C.ui.sel = +n; answer(iid, n); break; }
      case 'c-later': C.ui.popupHidden = true; break;
      case 'c-popup': C.ui.popupHidden = false; break;
      case 'c-withdraw': C.withdraw(C.cur, v); C.toast('已撤回，这条消息没有发给主管'); break;
      case 'c-unblock': C.slot(C.cur).blocked = null; break;
      case 'c-jump': { const tx = document.getElementById('c-tx'); tx.scrollTop = tx.scrollHeight; break; }
      case 'c-stop': C.stopChat(C.cur); C.toast('已停止'); break;
      case 'c-ex': C.send(v); break;
      default: return false;
    }
    C.paint();
    return true;
  };

  C.send = (text) => {
    const r = C.submit(C.cur, text);
    if (r === 'queued') C.toast('已收到 · 排队中，当前步骤结束后交给主管');
  };

  /* keys while the chat page is shown; returns true when handled */
  C.key = (e) => {
    const inAsk = e.target.id === 'c-ask-in';
    const a = C.slot(C.cur).pending.find((x) => !x.answered && !x.gone);
    const shown = !!document.querySelector('.ask:not(.done)');
    if (e.key === 'Escape') {
      if (inAsk && C.ui.other) { C.ui.other = false; C.paint(); document.querySelector('.ask')?.focus(); return true; }
      if (C.ui.drawer) { C.ui.drawer = null; C.paint(); return true; }
      if (shown) { C.ui.popupHidden = true; C.paint(); return true; }
      return false;
    }
    if (inAsk && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); answer(e.target.dataset.iid, 'input'); C.paint(); return true; }
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return false;
    if (!a || !shown || a.method === 'input') return false;
    const rows = C.askRows(a); const sel = C.ui.sel ?? 0;
    if (['ArrowDown', 'j'].includes(e.key)) { e.preventDefault(); C.ui.sel = (sel + 1) % rows.length; C.paint(); return true; }
    if (['ArrowUp', 'k'].includes(e.key)) { e.preventDefault(); C.ui.sel = (sel - 1 + rows.length) % rows.length; C.paint(); return true; }
    if (e.key === 'Enter') { e.preventDefault(); answer(a.interactionId, String(sel)); C.paint(); return true; }
    if (/^[1-9]$/.test(e.key) && +e.key <= rows.length) { e.preventDefault(); C.ui.sel = +e.key - 1; answer(a.interactionId, String(+e.key - 1)); C.paint(); return true; }
    return false;
  };
})();
