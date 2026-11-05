/* Kaiming TUI prototype — three screens: 会话 / 需求 / 设置. Static mock, no server. */
(() => {
  const M = window.MOCK;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const S = {
    view: 'chat', proj: 'pay',
    reqSel: null, setTab: 'providers', scope: 'global', theme: 'dark', overlay: null, protoOpen: false,
  };
  const VIEWS = [['chat', '会话'], ['reqs', '需求'], ['settings', '设置']];

  /* ---------- primitives ---------- */
  const st = (k, t = '') => `<span class="st ${k}">${t}</span>`;
  const btn = (t, act, cls = '', key = '') => `<button class="btn ${cls}" data-act="${act}">${key ? `<kbd>${key}</kbd>` : ''}${t}</button>`;
  const box = (title, body, cls = '', right = '') => `<section class="box ${cls}"><span class="bt">${title}</span>${right ? `<span class="br">${right}</span>` : ''}${body}</section>`;
  const lnk = (t, act) => `<span class="lnk" role="link" tabindex="0" data-act="${act}">${t}</span>`;

  /* ---------- chat: delegated to chat-*.js (Pi-frame driven) ---------- */
  const CH = window.Chat;
  const t42 = () => CH.srv.tasks['t-4f21'];
  function top() {
    const p = M.projects.find((x) => x.id === S.proj);
    const pending = CH.srv.asks.filter((a) => !a.answered && !a.gone).length;
    return `<header class="top">
      <span class="brand">Kaiming</span>
      <button class="proj" data-act="ov:project" title="切换项目"><b>${p.name}</b> <span class="f3">▾</span></button>
      <nav class="nav">${VIEWS.map(([v, n], i) => `<button data-act="view:${v}" ${S.view === v ? 'aria-current="page"' : ''} title="快捷键 ${i + 1}">${n}${v === 'chat' && pending ? `<span class="n" style="color:var(--decide)">◆${pending}</span>` : ''}</button>`).join('')}</nav>
      <span class="sp"></span>
      ${CH.ui.conn === 'ok' ? st('done', '已连接') : st('run', '重连中')}
    </header>`;
  }
  function status() {
    const run = Object.values(CH.srv.tasks).reduce((n, t) => n + t.members.filter((m) => m.activity === 'processing').length, 0);
    return `<footer class="status"><span>${M.projects.find((x) => x.id === S.proj).path}</span><span>⎇ main</span>${run ? st('run', `${run} 个 Agent 运行中`) : ''}<span class="sp"></span><span>1/2/3 切换 · i 输入 · Esc 关闭</span></footer>`;
  }
  /* ---------- requirement board ---------- */
  function reqView(r) {
    if (!r.dynamic) return r;
    const t = t42();
    if (!t) return { ...r, col: 'todo', meta: ['idle', '待实现'] };
    if (t.status === 'completed') return { ...r, col: 'done', meta: ['done', '已完成 · 今天'], summary: '已提交 4c7e19b；审核 2 轮；集成 9/9、E2E 6/6。' };
    const ask = CH.srv.asks.some((a) => a.taskId === 't-4f21' && !a.answered);
    return { ...r, col: 'doing', meta: t.status === 'paused' ? ['paused', '已暂停'] : ask ? ['decide', '等你决定'] : ['run', `${CH.PH[t.phase]}中`] };
  }
  function reqs() {
    const list = M.reqs.map(reqView).filter(Boolean);
    const cols = [['proposal', '提案'], ['todo', '待实现'], ['doing', '进行中'], ['done', '已完成']];
    const board = cols.map(([c, n]) => {
      const items = list.filter((r) => r.col === c);
      return `<div class="colm"><div class="ch">${n}<span class="n">${items.length}</span></div><div class="cards scroll">
        ${items.map((r) => `<button class="rc" data-act="req:${r.id}" ${S.reqSel === r.id ? 'aria-selected="true"' : ''}><span class="id">${r.id}</span><span class="tt">${r.title}</span><span class="mt">${st(r.meta[0], r.meta[1])}</span></button>`).join('') || '<div class="none">暂无</div>'}
      </div></div>`;
    }).join('');
    return `<section class="page">
      <div class="page-h"><h1>需求</h1><span class="f3">提案先设计，实施需求可以直接实现</span></div>
      <div class="notice">${st('block', '')}<span>1 个需求文件无法解析：${M.invalid.path}</span><span class="sp"></span>${lnk('查看', 'req:invalid')}</div>
      <div class="board">${board}</div>
    </section>${S.reqSel ? drawer() : ''}`;
  }
  function drawer() {
    const sec = (h, b) => `<div class="sec"><div class="sh">${h}</div><div>${b}</div></div>`;
    let head, body, foot = '';
    if (S.reqSel === 'invalid') {
      const x = M.invalid;
      head = `<div><div class="f3">${x.path}</div><h2>${st('block', '无法解析')}</h2></div>`;
      body = sec('原因', `第 ${x.line} 行：${x.reason}`) + sec('原文', `<div class="raw">${esc(x.raw)}</div>`) + `<div class="f3">原文保留；修复前不会出现在看板中。</div>`;
      foot = btn('让主管修复', 'toast:已发送给主管：修复 REQ-0046', 'pri');
    } else {
      const r = reqView(M.reqs.find((x) => x.id === S.reqSel));
      head = `<div><div class="f3">${r.id} · ${r.kind}</div><h2>${r.title}</h2></div>`;
      body = sec('状态', st(r.meta[0], r.meta[1]));
      if (r.kind === '提案') {
        body += sec('意图', r.intent) + sec('来源', r.source) + sec('未知', r.unknown);
        foot = r.session ? btn('打开设计会话', `sess:${r.session}`, 'pri') : btn('委托设计', 'toast:已在新会话中发送：设计 ' + r.id + '，不要开发', 'pri');
      } else {
        body += sec('目标', r.goal) + sec('验收', `<ul>${r.accept.map((a) => `<li>${a}</li>`).join('')}</ul>`) + sec('来源', r.source);
        if (r.summary) body += sec('完成摘要', r.summary);
        foot = r.col === 'todo' ? btn('实现', r.dynamic ? 'sess:s1' : 'toast:前置需求 REQ-0041 未完成，主管会说明等待原因', 'pri')
          : btn('打开会话', `sess:${r.session}`, 'pri');
      }
    }
    return `<div class="drawer-scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-label="需求详情">
      <div class="dh">${head}<span class="sp"></span>${btn('Esc', 'close', 'ghost')}</div>
      <div class="db scroll">${body}</div><div class="df">${foot}</div></aside>`;
  }

  /* ---------- settings ---------- */
  function settings() {
    const prov = M.providers.map((p) => `<div class="prov"><span class="nm">${p.name}　${st(p.state[0], p.state[1])}</span><span class="meta">${p.base}</span><span class="meta">${p.models}</span><span class="act">${btn('试连', `toast:${p.name} 试连中…`, 'ghost')}</span></div>`).join('');
    const roles = M.roles.map(([r, g, ov]) => {
      const proj = S.scope === 'project';
      const val = proj && ov ? ov : g;
      const src = proj ? (ov ? '<span class="src ov">本项目覆盖</span>' : '<span class="src">继承全局</span>') : '<span class="src">全局</span>';
      return `<div class="rl"><span>${r}</span><select class="sel" aria-label="${r} 模型">${M.models.map((m) => `<option ${m === val ? 'selected' : ''}>${m}</option>`).join('')}</select>${src}</div>`;
    }).join('');
    const panes = {
      providers: ['模型服务', '可用的模型接入点。密钥只保存在服务端，界面中只显示是否已配置。',
        `${prov}<div style="margin-top:var(--s6)">${btn('＋ 添加服务', 'toast:填写地址与密钥，试连成功后保存')}</div>`],
      roles: ['角色模型', '每个角色使用的模型。修改只影响之后开始的工作；审核、测试始终在独立会话中进行。',
        `<div class="row" style="margin-bottom:var(--s4)"><span class="seg"><button data-act="scope:global" aria-pressed="${S.scope === 'global'}">全局</button><button data-act="scope:project" aria-pressed="${S.scope === 'project'}">本项目</button></span></div>${roles}`],
      look: ['外观', '界面主题。',
        `<div class="row"><span style="width:8em">主题</span><span class="seg"><button data-act="theme:dark" aria-pressed="${S.theme === 'dark'}">深色</button><button data-act="theme:light" aria-pressed="${S.theme === 'light'}">浅色</button></span></div>`],
    };
    const [title, desc, body] = panes[S.setTab];
    return `<div class="settings">
      <aside class="menu"><div class="h">设置</div>
        ${Object.entries(panes).map(([k, p]) => `<button class="s" data-act="set:${k}" ${S.setTab === k ? 'aria-current="true"' : ''}>${p[0]}</button>`).join('')}
      </aside>
      <section class="set-pane scroll"><div class="set-in">
        <h1>${title}</h1><p class="f3">${desc}</p>
        <div class="set-body">${body}</div>
      </div></section></div>`;
  }

  /* ---------- overlay + proto ---------- */
  function overlay() {
    if (S.overlay !== 'project') return '';
    return `<div class="scrim" data-act="close"><div class="dlg" role="dialog" aria-label="项目">
      <h2>切换项目</h2>
      <div class="plist">${M.projects.map((p) => `<button data-act="proj:${p.id}" ${S.proj === p.id ? 'aria-current="true"' : ''}><b>${p.name}</b><span class="f3 ell">${p.path}</span></button>`).join('')}</div>
      <div><div class="f3" style="margin-bottom:var(--s1)">添加项目：工作台主机上的目录</div><input class="inp" placeholder="/home/dev/work/my-service"></div>
      <div class="btns" style="justify-content:flex-end">${btn('取消', 'close', 'ghost')}${btn('添加', 'toast:已接入项目，不会生成代码或改写文件', 'pri')}</div>
    </div></div>`;
  }
  const proto = () => `<div class="proto"><button data-act="proto">原型控制 ▾</button>${S.protoOpen ? `<div class="pp">
      <span class="g">会话「密码重置」实时演示 · ${CH.player?.done ? '已播完' : CH.player?.gate ? '等你回答' : '播放中'}</span>
      <button data-act="p-restart">重新播放</button><button data-act="p-skip">快进到下一个问题</button>
      <span class="g">速度</span>${[1, 2, 4].map((x) => `<button data-act="p-speed:${x}" aria-pressed="${CH.speed === x}">${x}×</button>`).join('')}
      <span class="g">注入</span><button data-act="p-disc">断线重连</button><button data-act="p-block">模型不可用</button>
    </div>` : ''}</div>`;

  /* ---------- render ---------- */
  function render() {
    const top0 = $('.top'); const isChat = !!$('#c-tx');
    if (S.view === 'chat' && isChat) { top0.outerHTML = top(); $('.status').outerHTML = status(); CH.paint(); $('#ov').innerHTML = overlay() + proto(); return; }
    const view = S.view === 'chat' ? CH.page() : { reqs, settings }[S.view]();
    $('#app').innerHTML = top() + `<main style="min-height:0;display:grid">${view}</main>` + status();
    $('#ov').innerHTML = overlay() + proto();
    if (S.view === 'chat') { CH.paint(); const tx = $('#c-tx'); tx.scrollTop = tx.scrollHeight; }
  }
  function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 2800); }

  function act(a) {
    if (CH.act(a)) { if (S.view === 'chat') { $('.top').outerHTML = top(); } return; }
    const [k, ...r] = a.split(':'); const v = r.join(':');
    switch (k) {
      case 'view': S.view = v; S.reqSel = null; break;
      case 'sess': CH.cur = v; CH.ui.drawer = null; CH.ui.members = false; CH.ui.popupHidden = false; S.view = 'chat'; S.reqSel = null; break;
      case 'newsess': toast('原型中不创建新会话；真实环境会新建主管会话并从项目索引接续'); break;
      case 'req': S.reqSel = v; S.view = 'reqs'; break;
      case 'close': S.reqSel = null; S.overlay = null; break;
      case 'ov': S.overlay = v; break;
      case 'proj': S.proj = v; S.overlay = null; break;
      case 'scope': S.scope = v; break;
      case 'set': S.setTab = v; break;
      case 'theme': S.theme = v; document.documentElement.dataset.theme = v; break;
      case 'proto': S.protoOpen = !S.protoOpen; break;
      case 'p-restart': CH.start(); CH.cur = 's1'; S.view = 'chat'; $('#app').innerHTML = ''; break;
      case 'p-skip': CH.player.skip(); break;
      case 'p-speed': CH.speed = +v; break;
      case 'p-disc': CH.simDisconnect(); break;
      case 'p-block': CH.simBlocked(CH.cur); break;
      case 'toast': S.overlay = null; toast(v); break;
    }
    render();
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (el.classList.contains('scrim') && e.target !== el) return;
    e.preventDefault(); act(el.dataset.act);
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target.tagName;
    if (S.view === 'chat' && CH.key(e)) return;
    if (e.key === 'Escape') { if (['TEXTAREA', 'INPUT'].includes(t)) e.target.blur(); act('close'); return; }
    if (t === 'TEXTAREA' && e.target.id === 'composer') {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault(); const x = e.target.value.trim(); if (!x) return;
        e.target.value = ''; CH.send(x);
      }
      return;
    }
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(t) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[123]$/.test(e.key) && !document.querySelector('.ask:not(.done)')) act(`view:${VIEWS[+e.key - 1][0]}`);
    else if (e.key === 'i' && S.view === 'chat') { e.preventDefault(); $('#composer')?.focus(); }
  });

  // braille spinner for running state
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'; let fi = 0;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    setInterval(() => { fi = (fi + 1) % frames.length; document.documentElement.style.setProperty('--spin', `"${frames[fi]}"`); }, 100);
  }

  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('view')) S.view = h.get('view');
  if (h.get('set')) S.setTab = h.get('set');
  if (h.get('theme')) act(`theme:${h.get('theme')}`);
  if (h.get('req')) { S.view = 'reqs'; S.reqSel = h.get('req'); }
  CH.sessions = M.sessions;
  CH.toast = toast;
  CH.onChange = () => { if (S.view === 'chat') { const t = $('.top'); if (t) t.outerHTML = top(); const s = $('.status'); if (s) s.outerHTML = status(); } else if (S.view === 'reqs' && !S.reqSel) render(); };
  if (h.get('speed')) CH.speed = +h.get('speed');
  CH.start();
  render();
})();
