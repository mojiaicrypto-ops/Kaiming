/* Chat runner: plays scripted steps with real timing and implements the user actions
   the chief channel supports (submit / queue+withdraw / answer / pause / resume / stop). */
(() => {
  const C = window.Chat;

  function run(step) {
    if (step.srv) step.srv();
    if (step.f) C.apply(step.s, typeof step.f === 'function' ? step.f() : step.f);
  }
  const gateOpen = (id) => { const a = C.srv.asks.find((x) => x.interactionId === id); return !a || a.answered; };

  function makePlayer(steps) {
    const P = { steps, i: 0, timer: null, held: false, gate: null, done: false };
    P.tick = () => {
      P.timer = null;
      if (P.held) return;
      while (P.i < P.steps.length) {
        const step = P.steps[P.i];
        if (step.gate) {
          if (!gateOpen(step.gate)) { P.gate = step.gate; C.emit('player'); return; }
          P.gate = null; P.i++; continue;
        }
        if (step.deliver) { P.i++; deliver(P, step.deliver); continue; }
        if (step.branch) { P.i++; P.steps.splice(P.i, 0, ...step.branch()); continue; }   // decided at play time (e.g. by an answer)
        if (step.d && !step.waited) { step.waited = true; P.timer = setTimeout(P.tick, step.d / C.speed); return; }
        run(step); P.i++;
      }
      P.done = true; C.emit('player');
    };
    P.hold = () => { P.held = true; clearTimeout(P.timer); P.timer = null; };
    P.go = () => { P.held = false; if (!P.timer) P.tick(); };
    /* fast-forward without delays until a closed gate (used by the prototype panel) */
    P.skip = () => {
      P.hold();
      while (P.i < P.steps.length) {
        const step = P.steps[P.i];
        if (step.gate && !gateOpen(step.gate)) break;
        if (step.deliver) deliver(P, step.deliver);
        else if (step.branch) { P.steps.splice(P.i + 1, 0, ...step.branch()); }
        else run(step);
        P.i++;
      }
      P.go();
    };
    return P;
  }

  /* Retained inputs: while a Task owns the chief session, user messages wait and are
     handed over at the next safe point (here: when the current dispatch returns). */
  function deliver(P, sid) {
    const s = C.slot(sid);
    if (!s.queued.length) return;
    const add = []; const b = C.builder(add);
    const qs = [...s.queued];
    qs.forEach((q) => b.user(sid, q.text, undefined, q.inputId));
    b.say(sid, { think: '用户补充属于当前任务吗？核对范围后再决定交给谁。', text: `收到 ${qs.length} 条补充，已核对属于当前目标范围，会在下一步交给相关成员；如果是新话题，请新建主管会话。` });
    P.steps.splice(P.i, 0, ...add);
  }

  C.speed = 1;
  C.side = [];

  C.start = () => {
    C.player?.hold(); C.side.forEach((p) => p.hold()); C.side = [];
    C.init();
    C.seed().forEach(run);
    C.player = makePlayer(C.liveScript());
    C.player.go();
    C.emit('all');
  };

  const activeTask = (sid) => { const t = C.srv.tasks[C.slot(sid).taskId]; return t && !['completed', 'cancelled'].includes(t.status) ? t : null; };
  C.activeTask = activeTask;

  C.submit = (sid, text) => {
    const s = C.slot(sid);
    if (activeTask(sid) || s.busy !== 'idle') {
      s.queued.push({ inputId: `in-${Date.now()}`, text });
      C.emit(sid);
      return 'queued';
    }
    const add = []; const b = C.builder(add);
    b.user(sid, text);
    b.start(sid);
    b.say(sid, { think: '原型没有真实模型，这里用固定回复演示流式输出。', text: `收到：「${text}」。\n\n这是原型里的固定回复。真实环境中主管会直接讨论、按需调查项目；只有你明确说“保存”或“实现”，才会产生需求或任务。` });
    b.end(sid);
    const p = makePlayer(add); C.side.push(p); p.go();
    return 'sent';
  };

  C.withdraw = (sid, inputId) => { const s = C.slot(sid); s.queued = s.queued.filter((q) => q.inputId !== inputId); C.emit(sid); };

  C.answer = (iid, value) => {
    const a = C.srv.asks.find((x) => x.interactionId === iid);
    if (!a || a.answered) return 'stale';
    a.answered = true; a.echo = value === true ? '确认' : value === false ? '拒绝' : value === '' ? '（留空，使用默认）' : String(value);
    C.srv.answers[iid] = value;
    const t = C.srv.tasks[a.taskId];
    const m = t?.members.find((x) => x.sessionId === a.sourceSessionId);
    const left = C.srv.asks.some((x) => x.sourceSessionId === a.sourceSessionId && !x.answered);
    if (m && !left) m.activity = 'processing';
    if (t && t.status === 'waiting' && !left) t.status = 'active';
    C.emit(a.chief);
    setTimeout(() => {
      a.gone = true;
      C.apply(a.chief, { type: 'invalidate', entity: 'interaction', id: iid });
      if (C.player.gate === iid && !C.player.held) C.player.tick();
    }, 900);
    return 'ok';
  };

  C.pause = (sid) => {
    const t = activeTask(sid); if (!t || t.status === 'pausing') return;
    t.status = 'pausing'; C.emit(sid);
    setTimeout(() => {
      C.player.hold();
      t.status = 'paused';
      t.members.forEach((m) => { if (m.activity === 'processing') { m.activity = 'idle'; m.last = 'stopped'; m.resume = true; } });
      C.emit(sid);
    }, 900);
  };
  C.resume = (sid) => {
    const t = C.srv.tasks[C.slot(sid).taskId]; if (!t || t.status !== 'paused') return;
    t.status = 'active';
    t.members.forEach((m) => { if (m.resume) { m.activity = 'processing'; m.last = null; m.resume = false; } });
    C.emit(sid); C.player.go();
  };
  /* STOP for a free (non-task) chat turn: abort the live message. */
  C.stopChat = (sid) => {
    C.side.forEach((p) => p.hold());
    C.apply(sid, { type: 'pi', seq: Date.now(), event: { type: 'message_end', message: { role: 'assistant', stopReason: 'aborted' } } });
    C.apply(sid, { type: 'pi', seq: Date.now() + 1, event: { type: 'agent_end' } });
  };

  /* prototype-only simulations */
  C.simDisconnect = () => {
    C.ui.conn = 'reconnecting'; C.player.hold(); C.emit('all');
    setTimeout(() => { C.ui.conn = 'ok'; C.player.go(); C.emit('all'); }, 2600);
  };
  C.simBlocked = (sid) => C.apply(sid, { type: 'blocked', code: 'MODEL_UNAVAILABLE', detail: '主管模型 claude-opus-5-5 返回 529 overloaded；输入已保留，可稍后重试或在设置中更换模型。' });
})();
