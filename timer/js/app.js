// Timer app UI. The time math is in time.js (window.TimeMath).
//
// On Android the native wrapper adds window.TimerBridge. Every running timer gets a system alarm there, so a
// timer still rings (as a notification with the phone's alarm sound) when the app is closed or the screen is
// off. While the app is open, the page rings itself through the bridge. In a plain browser, Web Audio beeps.
(function () {
  'use strict';
  const T = window.TimeMath;
  const B = window.TimerBridge || null;
  const KEY = 'timer-app-v1';
  const MAX_TIMERS = 12;
  const RING_FOR = 3 * 60 * 1000;          // the in-app sound stops by itself after 3 minutes
  const LATE = B ? 3000 : 3 * 60 * 1000;   // noticed this late = it went off while the app was away
  const PRESETS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60]; // minutes
  const C = 2 * Math.PI * 100;             // ring circumference (r = 100 in a 220 x 220 viewBox)

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const call = (fn, fallback) => { try { return fn(); } catch (e) { return fallback; } };
  const ICON = {
    play: '<svg viewBox="0 0 24 24" class="ic fill"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" class="ic fill"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
    stop: '<svg viewBox="0 0 24 24" class="ic fill"><rect x="6.5" y="6.5" width="11" height="11" rx="2"/></svg>',
    reset: '<svg viewBox="0 0 24 24" class="ic"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></svg>',
    close: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    bell: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  };

  // ------------------------------------------------------------------ state
  const blank = () => ({ tab: 'timer', timers: [], sw: T.swReset(), askedNotify: false });
  let S = load();
  let entry = '';            // keypad digits
  let kpOpen = false;        // keypad shown on top of existing timers
  let away = document.hidden;
  let ringing = false;

  function load() {
    const s = call(() => JSON.parse(localStorage.getItem(KEY)), null);
    if (s && Array.isArray(s.timers) && s.sw && Array.isArray(s.sw.laps)) return { ...blank(), ...s };
    return blank();
  }
  function save() { call(() => localStorage.setItem(KEY, JSON.stringify(S))); }
  function commit() { save(); updateSound(Date.now()); render(); kick(); }

  const name = (t) => t.label || T.durationWords(t.base || t.duration) + ' timer';
  const shortName = (t) => t.label || T.durationWords(t.base || t.duration);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const endClock = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const canNotify = () => !B || call(() => B.canNotify(), true);

  // ------------------------------------------------------------------ system alarms (Android)
  function schedule(t) { if (B) call(() => B.schedule(t.id, String(t.endAt), name(t))); }
  function unschedule(t) { if (B) call(() => B.cancel(t.id)); }   // also removes its notification
  function syncAlarm(t) {
    if (t.state === 'running') schedule(t);
    else if (t.state === 'paused') unschedule(t);
  }
  // Timers stopped with the notification's Stop button while the app was in the background
  function takeDismissed() {
    if (!B) return;
    const ids = String(call(() => B.takeDismissed(), '') || '').split(',').filter(Boolean);
    if (!ids.length) return;
    const now = Date.now();
    S.timers = S.timers.map((t) => ids.includes(t.id) && (t.state === 'done' || T.isDue(t, now)) ? T.reset(t) : t);
    save();
  }

  // ------------------------------------------------------------------ sound
  const Sound = (() => {
    let ctx = null, iv = 0;
    function unlock() {
      if (B) return;
      if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = call(() => new AC(), null); }
      if (ctx && ctx.state === 'suspended') call(() => ctx.resume());
    }
    function beep(at, freq) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.45, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      o.connect(g); g.connect(ctx.destination);
      o.start(at); o.stop(at + 0.2);
    }
    function burst() {
      if (ctx) { const t = ctx.currentTime + 0.03; [0, 0.21, 0.42, 0.63].forEach((d, i) => beep(t + d, i % 2 ? 1175 : 880)); }
      call(() => navigator.vibrate && navigator.vibrate([180, 60, 180, 60, 180]));
    }
    return {
      unlock,
      start() {
        if (B) return call(() => B.ring(true));
        unlock(); burst(); clearInterval(iv); iv = setInterval(burst, 1600);
      },
      stop() {
        if (B) return call(() => B.ring(false));
        clearInterval(iv); iv = 0; call(() => navigator.vibrate && navigator.vibrate(0));
      },
    };
  })();

  function updateSound(now) {
    const want = !(B && away) && S.timers.some((t) => t.state === 'done' && !t.quiet && now - t.ringAt < RING_FOR);
    if (want === ringing) return;
    ringing = want;
    want ? Sound.start() : Sound.stop();
  }

  // ------------------------------------------------------------------ timer actions
  function startNew() {
    const ms = T.entryMs(entry);
    if (ms <= 0 || S.timers.length >= MAX_TIMERS) return;
    const label = $('labelInput').value.trim();
    const t = T.createTimer(newId(), ms, label, Date.now());
    S.timers.push(t);
    schedule(t);
    entry = ''; $('labelInput').value = ''; $('labelInput').blur();
    kpOpen = false;
    if (B && !S.askedNotify && !canNotify()) { S.askedNotify = true; call(() => B.askNotify()); }
    commit();
  }
  function change(id, fn) {
    const now = Date.now();
    S.timers = S.timers.map((t) => (t.id === id ? fn(t, now) : t));
    const t = S.timers.find((x) => x.id === id);
    if (t) syncAlarm(t);
    commit();
  }
  const ACT = {
    toggle: (id) => change(id, (t, now) => t.state === 'running' ? T.pause(t, now) : t.state === 'paused' ? T.resume(t, now) : T.reset(t)),
    plus: (id) => change(id, (t, now) => T.addMinute(t, now)),
    reset: (id) => change(id, (t) => T.reset(t)),
    del: (id) => {
      const t = S.timers.find((x) => x.id === id);
      if (t) unschedule(t);
      S.timers = S.timers.filter((x) => x.id !== id);
      commit();
    },
  };

  // Due timers go off. One the page notices late (the app was closed or asleep) has already rung as a
  // notification, so it waits on the Time's up screen without ringing again.
  function check(now) {
    let changed = false;
    S.timers = S.timers.map((t) => {
      if (!T.isDue(t, now)) return t;
      changed = true;
      const quiet = (B && away) || now - t.endAt > LATE;
      if (!quiet) unschedule(t);   // ringing here, so no notification
      return { ...t, state: 'done', quiet: !!quiet, ringAt: now };
    });
    if (changed) commit();
    updateSound(now);
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    renderTabs();
    renderTimerView();
    renderStopwatch();
    renderAlarm();
  }

  function renderTabs() {
    document.querySelectorAll('.tabbtn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === S.tab);
      b.classList.toggle('busy', b.dataset.tab === 'timer' ? S.timers.some((t) => t.state === 'running') : S.sw.running);
    });
    $('view-timer').classList.toggle('active', S.tab === 'timer');
    $('view-sw').classList.toggle('active', S.tab === 'sw');
  }

  function renderTimerView() {
    const n = S.timers.length;
    const showKp = kpOpen || n === 0;
    $('timerList').hidden = showKp;
    $('newTimer').hidden = !showKp;
    $('kpClose').hidden = n === 0;
    $('addBtn').hidden = n >= MAX_TIMERS;
    $('notifyHint').hidden = !(B && n && !canNotify());
    renderEntry();
    renderCards();
  }

  function renderEntry() {
    const p = entry.padStart(6, '0');
    const first = 6 - entry.length;   // digits from here on have been typed
    const on = (i) => (i >= first ? 'on' : '');
    const grp = (i, unit) => `<span class="grp"><b class="${on(i)}">${p[i]}</b><b class="${on(i + 1)}">${p[i + 1]}</b><i class="${on(i + 1)}">${unit}</i></span>`;
    $('entry').innerHTML = grp(0, 'h') + grp(2, 'm') + grp(4, 's');
    $('kpStart').disabled = T.entryMs(entry) <= 0;
  }

  const ringOffset = (t, now) => (C * (1 - T.progress(t, now))).toFixed(2);
  // The ring starts at its current position, so re-rendering doesn't animate it from full.
  const ringSvg = (t) => `<svg viewBox="0 0 220 220" class="ring"><circle class="track" cx="110" cy="110" r="100"/><circle class="prog" cx="110" cy="110" r="100" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${ringOffset(t, Date.now())}"/></svg>`;
  const stateClass = (t) => t.state + (T.isIdle(t) ? ' idle' : '');
  const toggleIcon = (t) => (t.state === 'running' ? ICON.pause : t.state === 'done' ? ICON.stop : ICON.play);
  const toggleLabel = (t) => (t.state === 'running' ? 'Pause' : t.state === 'done' ? 'Stop' : 'Start');

  function bigCard(t) {
    return `<article class="tcard big ${stateClass(t)}" data-id="${t.id}">
      <div class="tc-head"><span class="tc-label">${esc(name(t))}</span>
        <button class="icon-btn" data-act="del" aria-label="Delete timer">${ICON.close}</button></div>
      <div class="dial">${ringSvg(t)}<div class="dial-center"><div class="tc-time"></div><div class="tc-sub"></div></div></div>
      <div class="tc-controls">
        <button class="round ghost" data-act="reset" aria-label="Reset"${T.isIdle(t) ? ' disabled' : ''}>${ICON.reset}</button>
        <button class="round primary xl" data-act="toggle" aria-label="${toggleLabel(t)}">${toggleIcon(t)}</button>
        <button class="round ghost" data-act="plus" aria-label="Add one minute">+1:00</button>
      </div>
    </article>`;
  }
  function smallCard(t) {
    return `<article class="tcard small ${stateClass(t)}" data-id="${t.id}">
      <button class="mini-dial" data-act="toggle" aria-label="${toggleLabel(t)}">${ringSvg(t)}<span class="mini-icon">${toggleIcon(t)}</span></button>
      <div class="tc-info"><div class="tc-time"></div><div class="tc-meta"><span class="tc-label">${esc(shortName(t))}</span><span class="tc-sub"></span></div></div>
      <div class="tc-actions">
        <button class="pill" data-act="plus" aria-label="Add one minute">+1:00</button>
        <div class="row">
          <button class="icon-btn" data-act="reset" aria-label="Reset"${T.isIdle(t) ? ' disabled' : ''}>${ICON.reset}</button>
          <button class="icon-btn" data-act="del" aria-label="Delete timer">${ICON.close}</button>
        </div>
      </div>
    </article>`;
  }

  let cardRefs = [];
  function renderCards() {
    const box = $('cards');
    const big = S.timers.length === 1;
    box.innerHTML = S.timers.map((t) => (big ? bigCard(t) : smallCard(t))).join('');
    cardRefs = [...box.querySelectorAll('.tcard')].map((el) => ({
      el, id: el.dataset.id, time: el.querySelector('.tc-time'), sub: el.querySelector('.tc-sub'), prog: el.querySelector('.prog'), last: {},
    }));
    paintCards(Date.now());
  }
  function set(ref, key, value, apply) { if (ref.last[key] !== value) { ref.last[key] = value; apply(value); } }
  function paintCards(now) {
    for (const r of cardRefs) {
      const t = S.timers.find((x) => x.id === r.id);
      if (!t) continue;
      const time = t.state === 'done' ? T.overText(now - t.endAt) : T.timerText(T.remainingMs(t, now));
      const sub = t.state === 'running' ? `${ICON.bell}${endClock(t.endAt)}`
        : t.state === 'done' ? "Time's up"
        : T.isIdle(t) ? 'Ready' : 'Paused';
      const off = ringOffset(t, now);
      set(r, 'time', time, (v) => { r.time.textContent = v; });
      set(r, 'sub', sub, (v) => { r.sub.innerHTML = v; });
      set(r, 'off', off, (v) => { r.prog.setAttribute('stroke-dashoffset', v); r.prog.style.opacity = t.state === 'done' || +v >= C - 0.5 ? 0 : 1; });
    }
  }

  // ---- stopwatch
  function renderStopwatch() {
    const sw = S.sw, now = Date.now(), el = T.swElapsed(sw, now);
    const left = $('swLeft'), right = $('swRight');
    left.textContent = !sw.running && el > 0 ? 'Reset' : 'Lap';
    left.disabled = !sw.running && el === 0;
    right.textContent = sw.running ? 'Pause' : el > 0 ? 'Resume' : 'Start';
    right.className = 'round ' + (sw.running ? 'stop' : 'primary');
    $('view-sw').classList.toggle('has-laps', sw.laps.length > 0);
    const { splits, fastest, slowest } = T.lapStats(sw.laps);
    let html = '';
    if (sw.laps.length) {
      html += `<li class="live"><span>Lap ${sw.laps.length + 1}</span><span id="lapLive"></span><span id="lapLiveTotal"></span></li>`;
    }
    for (let i = splits.length - 1; i >= 0; i--) {
      const cls = i === fastest ? 'fast' : i === slowest ? 'slow' : '';
      html += `<li class="${cls}"><span>Lap ${i + 1}</span><span>${T.stopwatchText(splits[i])}</span><span>${T.stopwatchText(sw.laps[i])}</span></li>`;
    }
    $('laps').innerHTML = html;
    swLast = {};
    paintStopwatch(now);
  }
  let swLast = {};
  function paintStopwatch(now) {
    const sw = S.sw, el = T.swElapsed(sw, now);
    const p = T.stopwatchParts(el);
    if (swLast.main !== p.main) $('swMain').textContent = swLast.main = p.main;
    if (swLast.frac !== p.frac) $('swFrac').textContent = swLast.frac = p.frac;
    const f = (el % 60000) / 60000;
    const arc = $('swArc'), dot = $('swDot');
    arc.setAttribute('stroke-dasharray', C.toFixed(2));
    arc.setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(2));
    arc.style.opacity = el > 0 ? 1 : 0;
    const a = f * 2 * Math.PI;
    dot.setAttribute('cx', (110 + 100 * Math.cos(a)).toFixed(2));
    dot.setAttribute('cy', (110 + 100 * Math.sin(a)).toFixed(2));
    dot.style.opacity = el > 0 ? 1 : 0;
    if (sw.laps.length) {
      const live = T.stopwatchText(el - sw.laps[sw.laps.length - 1]), total = T.stopwatchText(el);
      const a1 = $('lapLive'), a2 = $('lapLiveTotal');
      if (a1 && swLast.live !== live) a1.textContent = swLast.live = live;
      if (a2 && swLast.total !== total) a2.textContent = swLast.total = total;
    }
  }

  // ---- Time's up
  const doneTimers = () => S.timers.filter((t) => t.state === 'done').sort((a, b) => a.endAt - b.endAt);
  function renderAlarm() {
    const d = doneTimers();
    $('alarm').hidden = !d.length;
    if (!d.length) return;
    $('alarm').dataset.id = d[0].id;
    $('alarmLabel').textContent = name(d[0]);
    $('alarmMore').textContent = d.length > 1 ? `${d.length - 1} more timer${d.length > 2 ? 's' : ''} done` : '';
    paintAlarm(Date.now());
  }
  function paintAlarm(now) {
    const t = S.timers.find((x) => x.id === $('alarm').dataset.id && x.state === 'done');
    if (t) { const v = T.overText(now - t.endAt); if ($('alarmOver').textContent !== v) $('alarmOver').textContent = v; }
  }

  // ------------------------------------------------------------------ main loop
  // 60 fps only while the stopwatch is running on screen; timers need a few updates a second.
  let raf = 0, timeout = 0;
  function tick() {
    raf = 0; timeout = 0;
    const now = Date.now();
    check(now);
    if (!away) {
      if (S.tab === 'timer') paintCards(now);
      if (S.tab === 'sw') paintStopwatch(now);
      if (!$('alarm').hidden) paintAlarm(now);
    }
    plan(now);
  }
  function plan(now) {
    if (raf || timeout) return;
    const running = S.timers.filter((t) => t.state === 'running');
    if (away) {   // just wake up for the next timer
      if (running.length) timeout = setTimeout(tick, Math.max(0, Math.min(...running.map((t) => t.endAt)) - now) + 20);
      if (ringing) timeout = timeout || setTimeout(tick, 1000);
      return;
    }
    if (S.sw.running && S.tab === 'sw') { raf = requestAnimationFrame(tick); return; }
    if (running.length || S.timers.some((t) => t.state === 'done')) {
      // wake just after the next whole second of any timer, at least 4 times a second
      let d = 250;
      for (const t of running) d = Math.min(d, (((t.endAt - now) % 1000) + 1000) % 1000 + 8);
      timeout = setTimeout(tick, Math.max(16, d));
    }
  }
  function kick() {
    cancelAnimationFrame(raf); clearTimeout(timeout); raf = 0; timeout = 0;
    plan(Date.now());
  }

  // ------------------------------------------------------------------ app visibility
  function onAway() {
    if (away) return;
    away = true;
    // On Android, leaving the app silences a ringing timer (the screen stays on while it rings).
    if (B) S.timers = S.timers.map((t) => (t.state === 'done' && !t.quiet ? { ...t, quiet: true } : t));
    updateSound(Date.now());
    save(); kick();
  }
  function onReturn() {
    away = false;
    takeDismissed();
    check(Date.now());
    render(); kick();
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? onAway() : onReturn()));
  window.appPaused = onAway;
  window.appResumed = onReturn;
  // Android Back: close the keypad, then go to the Timer tab, then leave the app.
  window.appBack = () => {
    if ($('alarm').hidden && S.tab === 'timer' && kpOpen && S.timers.length) { kpOpen = false; render(); return; }
    if ($('alarm').hidden && S.tab === 'sw') { setTab('timer'); return; }
    if (B) call(() => B.exitApp());
  };

  // ------------------------------------------------------------------ events
  function setTab(tab) { S.tab = tab; commit(); }
  document.querySelectorAll('.tabbtn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  document.addEventListener('pointerdown', Sound.unlock, { passive: true });

  $('cards').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    const card = e.target.closest('.tcard');
    if (btn && card && !btn.disabled) ACT[btn.dataset.act](card.dataset.id);
  });
  $('addBtn').addEventListener('click', () => { kpOpen = true; entry = ''; render(); });
  $('kpClose').addEventListener('click', () => { kpOpen = false; render(); });
  $('kpStart').addEventListener('click', startNew);
  $('notifyAllow').addEventListener('click', () => { if (B) call(() => B.askNotify()); });

  function press(d) {
    entry = d === 'del' ? T.popDigit(entry) : T.pushDigits(entry, d);
    renderEntry();
  }
  let holdTimer = 0;
  $('keys').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) press(b.dataset.d); });
  // Hold the delete key to clear
  $('keys').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.del');
    if (b) holdTimer = setTimeout(() => { entry = ''; renderEntry(); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $('keys').addEventListener(ev, () => clearTimeout(holdTimer)));

  $('presets').innerHTML = PRESETS.map((m) => `<button class="pill" data-min="${m}">${m < 60 ? m + ' min' : m / 60 + ' h'}</button>`).join('');
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]');
    if (b) { entry = T.msToEntry(+b.dataset.min * T.MIN); renderEntry(); }
  });
  $('labelInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  // Typing on a hardware keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target === $('labelInput') || S.tab !== 'timer' || $('newTimer').hidden || !$('alarm').hidden) return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') startNew();
  });

  $('swRight').addEventListener('click', () => {
    const now = Date.now();
    S.sw = S.sw.running ? T.swPause(S.sw, now) : T.swStart(S.sw, now);
    commit();
  });
  $('swLeft').addEventListener('click', () => {
    const now = Date.now();
    S.sw = S.sw.running ? T.swLap(S.sw, now) : T.swReset();
    commit();
  });

  $('alarmStop').addEventListener('click', () => ACT.reset($('alarm').dataset.id));
  $('alarmPlus').addEventListener('click', () => ACT.plus($('alarm').dataset.id));

  // ------------------------------------------------------------------ start
  takeDismissed();
  // Re-arm the system alarms (they don't survive a reboot or a force stop)
  S.timers.filter((t) => t.state === 'running' && t.endAt > Date.now()).forEach(schedule);
  check(Date.now());
  render();
  kick();
})();
