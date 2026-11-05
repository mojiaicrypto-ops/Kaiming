/* Chat core: Pi-frame reducer, mock server state, markdown.
   Mirrors kaiming/webapp state/slot.ts: per-session slots fed by Pi frames
   (message_start/update/end, tool_execution_*, agent_start/end) plus business
   invalidate frames (task / interaction / input). Mock only — no server. */
window.Chat = (() => {
  const C = {};
  const empty = () => ({ items: [], busy: 'idle', tools: {}, pending: [], queued: [], taskId: null, blocked: null });

  C.init = () => {
    C.slots = {};
    C.meta = {};                                   // sessionId -> { label, role }
    C.srv = { tasks: {}, asks: [], answers: {} };  // what task.get / pending reads would return
    C.ui = { open: new Set(), members: false, drawer: null, popupHidden: false, conn: 'ok', echo: null };
  };
  C.slot = (id) => (C.slots[id] ||= empty());
  C.listeners = [];
  C.emit = (sid) => C.listeners.forEach((l) => l(sid));

  const hhmm = () => new Date().toTimeString().slice(0, 5);
  const textOf = (c) => (Array.isArray(c) ? c.map((b) => b.text || '').join('') : String(c ?? ''));
  const live = (s) => { for (let i = s.items.length - 1; i >= 0; i--) if (s.items[i].streaming) return s.items[i]; return null; };
  C.textOf = textOf;

  C.apply = (sid, f) => { reduce(C.slot(sid), f, sid); C.emit(sid); };

  function reduce(s, f, sid) {
    if (f.type === 'invalidate') {
      if (f.entity === 'task') s.taskId = f.id;
      // The frame carries no payload: re-read the authoritative pending list (webapp refreshPending).
      if (f.entity === 'interaction') s.pending = C.srv.asks.filter((a) => a.chief === sid && !a.gone);
      return;
    }
    if (f.type === 'blocked') { s.blocked = { code: f.code, detail: f.detail }; return; }
    const e = f.event;
    if (!e) return;
    switch (e.type) {
      case 'agent_start': s.busy = 'processing'; s.blocked = null; break;
      case 'agent_end': s.busy = 'idle'; break;
      case 'message_start':
        if (e.message.role === 'assistant') {
          s.items.push({ id: `live-${f.seq}`, role: 'assistant', content: [], streaming: true, t: e.t || hhmm() });
        }
        break;
      case 'message_update': {
        const it = live(s); if (!it) break;
        const d = e.assistantMessageEvent; const i = d.contentIndex;
        if (d.type === 'thinking_start') it.content[i] = { type: 'thinking', thinking: '', live: true };
        else if (d.type === 'text_start') it.content[i] = { type: 'text', text: '' };
        else if (d.type === 'toolcall_start') it.content[i] = { type: 'toolCall', id: d.id, name: d.name, arguments: '' };
        else if (d.type === 'thinking_delta') it.content[i].thinking += d.delta;
        else if (d.type === 'text_delta') it.content[i].text += d.delta;
        else if (d.type === 'toolcall_delta') it.content[i].arguments += d.delta;
        else if (d.type === 'thinking_end') it.content[i].live = false;
        break;
      }
      case 'message_end': {
        const m = e.message;
        if (m.role === 'user') {
          s.items.push({ id: `u-${f.seq}`, role: 'user', text: textOf(m.content), t: e.t || hhmm(), inputId: f.inputId });
          s.queued = s.queued.filter((q) => q.inputId !== f.inputId);
        } else if (m.role === 'toolResult') {
          const t = (s.tools[m.toolCallId] ||= {});
          t.result = textOf(m.content);
          t.status = m.isError ? 'failed' : 'ok';
        } else {
          const it = live(s);
          if (it) { it.streaming = false; it.stopReason = m.stopReason || 'stop'; it.content.forEach((b) => { if (b) b.live = false; }); }
          else if (m.stopReason === 'aborted') s.items.push({ id: `stop-${f.seq}`, role: 'assistant', content: [], streaming: false, stopReason: 'aborted', t: hhmm() });
        }
        break;
      }
      case 'tool_execution_start':
        s.tools[e.toolCallId] = { status: 'running', name: e.toolName, out: '', t0: Date.now() };
        break;
      case 'tool_execution_update': {
        const t = s.tools[e.toolCallId]; if (t) t.out = e.partialResult;
        break;
      }
      case 'tool_execution_end': {
        const t = s.tools[e.toolCallId]; if (!t) break;
        t.status = e.isError ? 'failed' : 'ok';
        if (e.result !== undefined) t.out = e.result;
        t.ms = e.ms ?? (Date.now() - t.t0);
        break;
      }
      default: break;
    }
  }

  /* ---------- markdown (small, streaming-safe subset) ---------- */
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  C.esc = esc;
  const inline = (t) => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\b((?:REQ|PRO)-\d{4})\b/g, '<span class="lnk" data-act="req:$1">$1</span>');

  C.md = (src) => {
    const lines = String(src).split('\n');
    const out = []; let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (l.startsWith('```')) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
        i++; out.push(`<pre class="md-code">${esc(buf.join('\n'))}</pre>`); continue;
      }
      if (/^\|.*\|\s*$/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.trim().slice(1, -1).split('|').map((c) => c.trim());
        const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r.trim()));
        out.push(`<table class="md-table">${body.map((r, n) => `<tr>${cells(r).map((c) => (n === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('')}</table>`);
        continue;
      }
      if (/^#{1,4} /.test(l)) { out.push(`<div class="md-h">${inline(l.replace(/^#+ /, ''))}</div>`); i++; continue; }
      if (/^\s*([-*]|\d+\.) /.test(l)) {
        const ord = /^\s*\d+\./.test(l); const buf = [];
        while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) buf.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
        out.push(`<${ord ? 'ol' : 'ul'} class="md-list">${buf.map((x) => `<li>${inline(x)}</li>`).join('')}</${ord ? 'ol' : 'ul'}>`);
        continue;
      }
      if (l.startsWith('> ')) { out.push(`<div class="md-quote">${inline(l.slice(2))}</div>`); i++; continue; }
      if (l.trim() === '') { i++; continue; }
      const buf = [];
      // Always consume at least one line: a half-streamed table row ("| a | b") matches no
      // other rule yet, and must not stall the parser.
      buf.push(lines[i++]);
      while (i < lines.length && lines[i].trim() !== '' && !/^(```|#{1,4} |\s*([-*]|\d+\.) |> |\|)/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }
    return out.join('');
  };

  C.init();
  return C;
})();
