// Timer app UI: interval workouts, timers and a stopwatch. The time math is in time.js (window.TimeMath).
//
// On Android the native wrapper adds window.TimerBridge. Every running timer gets a system alarm there, so a
// timer still rings (as a notification with the phone's alarm sound) when the app is closed or the screen is
// off, and a running workout announces each new round and rest the same way. While the app is open, the page
// makes the sounds itself through the bridge. In a plain browser, Web Audio beeps.
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
  const SEC = T.SEC, MIN = T.MIN;

  // Workout settings. Colours follow a traffic light: yellow get ready, green go, red rest, blue long rest.
  const W_DEFAULT = {
    prepare: 10 * SEC, work: 45 * SEC, rest: 15 * SEC, rounds: 8, cycles: 3, cycleRest: MIN,
    colors: { prepare: '#facc15', work: '#22c55e', rest: '#ef4444', cycleRest: '#3b82f6' },
  };
  const W_ROWS = [
    { key: 'prepare', label: 'Get ready', sub: 'before round 1', time: true, min: 0 },
    { key: 'work', label: 'Round', sub: 'work time', time: true, min: 5 * SEC },
    { key: 'rest', label: 'Rest', sub: 'between rounds', time: true, min: 0 },
    { key: 'rounds', label: 'Rounds', sub: 'in each cycle', min: 1, max: 99 },
    { key: 'cycles', label: 'Cycles', sub: 'sets of rounds', min: 1, max: 99 },
    { key: 'cycleRest', label: 'Cycle rest', sub: 'between cycles', time: true, min: 0 },
  ];
  const W_PRESETS = [
    { name: 'Tabata', cfg: { prepare: 10 * SEC, work: 20 * SEC, rest: 10 * SEC, rounds: 8, cycles: 1, cycleRest: MIN } },
    { name: 'HIIT 40/20', cfg: { prepare: 10 * SEC, work: 40 * SEC, rest: 20 * SEC, rounds: 8, cycles: 3, cycleRest: MIN } },
    { name: 'Boxing', cfg: { prepare: 10 * SEC, work: 3 * MIN, rest: MIN, rounds: 12, cycles: 1, cycleRest: MIN } },
    { name: 'Circuit', cfg: { prepare: 10 * SEC, work: 45 * SEC, rest: 15 * SEC, rounds: 6, cycles: 4, cycleRest: 2 * MIN } },
  ];
  const PHASE_NAME = { prepare: 'Get ready', work: 'Round', rest: 'Rest', cycleRest: 'Cycle rest' };
  const PALETTE = ['#facc15', '#ff8a3d', '#ef4444', '#ec4899', '#a855f7', '#6366f1',
    '#3b82f6', '#06b6d4', '#14b8a6', '#22c55e', '#a3e635', '#e5e7eb'];

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
    minus: '<svg viewBox="0 0 24 24" class="ic"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" class="ic"><path d="M12 6v12M6 12h12"/></svg>',
    check: '<svg viewBox="0 0 24 24" class="ic"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    rounds: '<svg viewBox="0 0 24 24" class="ic"><path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/></svg>',
    cycles: '<svg viewBox="0 0 24 24" class="ic"><rect x="4" y="4" width="16" height="4.5" rx="1.5"/><rect x="4" y="10" width="16" height="4.5" rx="1.5"/><rect x="4" y="16" width="16" height="4.5" rx="1.5"/></svg>',
  };

  // ------------------------------------------------------------------ state
  const blank = () => ({ tab: 'workout', timers: [], sw: T.swReset(), askedNotify: false,
    wcfg: JSON.parse(JSON.stringify(W_DEFAULT)), wrun: null, wmute: false });
  let S = load();
  let entry = '';            // keypad digits
  let kpOpen = false;        // keypad shown on top of existing timers
  let away = document.hidden;
  let ringing = false;

  function load() {
    const s = call(() => JSON.parse(localStorage.getItem(KEY)), null);
    if (!(s && Array.isArray(s.timers) && s.sw && Array.isArray(s.sw.laps))) return blank();
    const w = s.wcfg || {};
    return { ...blank(), ...s, wcfg: { ...W_DEFAULT, ...w, colors: { ...W_DEFAULT.colors, ...(w.colors || {}) } } };
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
    function beep(at, freq, dur = 0.16) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.45, at + 0.012);
      g.gain.setValueAtTime(0.45, at + Math.max(0.012, dur - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(at); o.stop(at + dur + 0.02);
    }
    // Workout cues: 3-2-1 ticks, a high beep when a round starts, a low one for rest, a rising one at the end.
    // The Android app plays the same sounds natively, at alarm volume.
    const CUES = {
      tick: { notes: [[880, 0, 0.09]], vibe: [30] },
      go: { notes: [[1175, 0, 0.5]], vibe: [350] },
      rest: { notes: [[587, 0, 0.55]], vibe: [150, 100, 150] },
      done: { notes: [[880, 0, 0.16], [1175, 0.2, 0.16], [1568, 0.4, 0.45]], vibe: [200, 100, 200, 100, 500] },
    };
    function cue(kind) {
      if (B) return call(() => B.cue(kind));
      const c = CUES[kind];
      if (!c) return;
      if (ctx && ctx.state === 'running') { const t = ctx.currentTime + 0.02; c.notes.forEach(([f, d, len]) => beep(t + d, f, len)); }
      call(() => navigator.vibrate && navigator.vibrate(c.vibe));
    }
    function burst() {
      if (ctx) { const t = ctx.currentTime + 0.03; [0, 0.21, 0.42, 0.63].forEach((d, i) => beep(t + d, i % 2 ? 1175 : 880)); }
      call(() => navigator.vibrate && navigator.vibrate([180, 60, 180, 60, 180]));
    }
    return {
      unlock,
      cue,
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

  // ------------------------------------------------------------------ workout
  const fmt = (ms) => T.clock(Math.round(ms / SEC));
  const cfgKey = (cfg) => [cfg.prepare, cfg.work, cfg.rest, cfg.rounds, cfg.cycles, cfg.cycleRest].join();
  const phaseCache = new Map();
  function phasesOf(cfg) {
    const key = cfgKey(cfg);
    if (!phaseCache.has(key)) {
      if (phaseCache.size > 8) phaseCache.clear();
      phaseCache.set(key, T.workoutPhases(cfg));
    }
    return phaseCache.get(key);
  }
  // Dark or white text, whichever reads better on the colour (WCAG contrast)
  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return (L + 0.05) / 0.057 >= 1.05 / (L + 0.05) ? ['#0f1216', '15, 18, 22'] : ['#ffffff', '255, 255, 255'];
  }
  const countText = (p, cfg) => {
    if (p.kind === 'prepare') return `${cfg.rounds} round${cfg.rounds > 1 ? 's' : ''}` + (cfg.cycles > 1 ? ` × ${cfg.cycles} cycles` : '');
    if (p.kind === 'cycleRest' || (p.kind === 'rest' && p.round === cfg.rounds)) return `Cycle ${p.cycle} of ${cfg.cycles} done`;
    return `Round ${p.round} of ${cfg.rounds}` + (cfg.cycles > 1 ? ` · Cycle ${p.cycle} of ${cfg.cycles}` : '');
  };
  const stripHtml = (phases, colors) =>
    phases.map((p) => `<i style="flex-grow:${p.dur};background:${colors[p.kind]}"></i>`).join('');

  // Keep the screen on while a workout runs
  let wakeLock = null;
  function stayAwake(on) {
    if (B) return call(() => B.keepAwake(!!on));
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = navigator.wakeLock.request('screen').catch(() => null);
    } else if (!on && wakeLock) {
      wakeLock.then((l) => l && l.release()).catch(() => {});
      wakeLock = null;
    }
  }
  // Android: hand the coming phase changes to the system, so they are announced with the app closed too.
  function syncWorkout() {
    const w = S.wrun;
    const active = !!(w && w.running && !w.finished);
    stayAwake(active && !away);
    if (!B) return;
    if (!active || S.wmute) return call(() => B.setWorkout(''));
    const now = Date.now(), ph = phasesOf(w.cfg), el = T.swElapsed(w, now), total = T.workoutTotal(ph);
    const events = [];
    ph.forEach((p) => {
      if (p.start <= el) return;
      events.push({
        at: now + p.start - el, end: now + p.start + p.dur - el, kind: p.kind === 'work' ? 'go' : 'rest',
        title: `${PHASE_NAME[p.kind]} · ${fmt(p.dur)}`, text: countText(p, w.cfg), color: w.cfg.colors[p.kind],
      });
    });
    events.push({ at: now + total - el, kind: 'done', title: 'Workout complete', text: doneSummary(w.cfg), color: '#ff8a3d' });
    call(() => B.setWorkout(JSON.stringify(events)));
  }
  function doneSummary(cfg) {
    const ph = phasesOf(cfg);
    const rounds = cfg.rounds * cfg.cycles;
    return `${fmt(T.workoutTotal(ph))} · ${rounds} round${rounds > 1 ? 's' : ''}` + (cfg.cycles > 1 ? ` in ${cfg.cycles} cycles` : '');
  }

  // Sounds at each phase change and 3-2-1 before it. Sounds that are already late (the app was away) are skipped.
  function workoutTick(now) {
    const w = S.wrun;
    if (!w || w.finished) return;
    const ph = phasesOf(w.cfg), el = T.swElapsed(w, now), at = T.workoutAt(ph, el);
    const quiet = (B && away) || S.wmute;
    if (at.done) {
      w.finished = true;
      w.running = false;
      if (!quiet && el - T.workoutTotal(ph) < 2000) Sound.cue('done');
      if (B && away) stayAwake(false);   // the system's own alarm announces the end
      else syncWorkout();
      commit();
      return;
    }
    if (at.i !== w.lastI) {
      const fresh = el - at.phase.start < 1500;
      w.lastI = at.i; w.lastTick = 0;
      if (fresh && !quiet && at.phase.kind !== 'prepare') Sound.cue(at.phase.kind === 'work' ? 'go' : 'rest');
      save();
      renderWorkoutRun();
    }
    const secs = Math.ceil(at.left / SEC);
    if (w.running && secs >= 1 && secs <= 3 && w.lastTick !== secs) {
      w.lastTick = secs;
      if (!quiet && secs * SEC - at.left < 500) Sound.cue('tick');
    }
  }

  const W = {
    start() {
      Sound.unlock();
      const cfg = JSON.parse(JSON.stringify(S.wcfg));
      S.wrun = { ...T.swStart(T.swReset(), Date.now()), cfg, lastI: -1, lastTick: 0, finished: false };
      delete S.wrun.laps;
      if (B && !S.askedNotify && !canNotify()) { S.askedNotify = true; call(() => B.askNotify()); }
      syncWorkout(); commit();
      workoutTick(Date.now());
    },
    toggle() {
      const w = S.wrun;
      if (!w || w.finished) return;
      Sound.unlock();
      const now = Date.now();
      S.wrun = w.running ? { ...w, ...T.swPause(w, now) } : { ...w, ...T.swStart(w, now) };
      syncWorkout(); commit();
    },
    jump(fn) {
      const w = S.wrun;
      if (!w || w.finished) return;
      S.wrun = { ...fn(phasesOf(w.cfg), w, Date.now()), lastTick: 0 };
      syncWorkout(); commit();
      workoutTick(Date.now());
    },
    end() { S.wrun = null; $('wConfirm').hidden = true; syncWorkout(); commit(); },
  };

  // ---- workout setup
  function setW(key, value) {
    S.wcfg = { ...S.wcfg, [key]: value };
    save(); renderWorkoutSetup();
  }
  function stepW(key, dir) {
    const row = W_ROWS.find((r) => r.key === key);
    const v = S.wcfg[key];
    const next = row.time ? T.stepDuration(v, dir, row.min, 99 * MIN) : Math.min(row.max, Math.max(row.min, v + dir));
    if (next !== v) setW(key, next);
  }
  function renderWorkoutSetup() {
    const cfg = S.wcfg, ph = phasesOf(cfg);
    $('wTotal').textContent = fmt(T.workoutTotal(ph));
    $('wShape').textContent = `${cfg.rounds} round${cfg.rounds > 1 ? 's' : ''} × ${cfg.cycles} cycle${cfg.cycles > 1 ? 's' : ''}` +
      ` · ${fmt(cfg.work)} on, ${cfg.rest ? fmt(cfg.rest) + ' rest' : 'no rest'}`;
    const strip = $('wStrip');
    strip.innerHTML = stripHtml(ph, cfg.colors);
    strip.classList.toggle('dense', ph.length > 40);
    $('wRows').innerHTML = W_ROWS.map((r) => {
      const v = cfg[r.key];
      const off = (r.time && v === 0) || (r.key === 'cycleRest' && cfg.cycles === 1);
      const lead = r.time
        ? `<button class="swatch" data-color="${r.key}" style="--c:${cfg.colors[r.key]}" aria-label="${r.label} colour"></button>`
        : `<span class="w-glyph">${ICON[r.key]}</span>`;
      const max = r.time ? 99 * MIN : r.max;
      return `<div class="w-row${off ? ' off' : ''}" data-key="${r.key}">${lead}
        <div class="w-name"><b>${r.label}</b><small>${r.sub}</small></div>
        <div class="stepper">
          <button data-step="-1" aria-label="Less"${v <= r.min ? ' disabled' : ''}>${ICON.minus}</button>
          <output>${r.time ? (v ? fmt(v) : 'Off') : v}</output>
          <button data-step="1" aria-label="More"${v >= max ? ' disabled' : ''}>${ICON.plus}</button>
        </div></div>`;
    }).join('');
    $('wPresets').innerHTML = W_PRESETS.map((p, i) => {
      const on = Object.keys(p.cfg).every((k) => p.cfg[k] === cfg[k]);
      return `<button class="pill${on ? ' on' : ''}" data-preset="${i}">${p.name}</button>`;
    }).join('');
  }

  // ---- workout running
  function renderWorkoutRun() {
    const w = S.wrun, box = $('wRun');
    box.hidden = !w;
    if (!w) return;
    const ph = phasesOf(w.cfg);
    $('wDone').hidden = !w.finished;
    box.classList.toggle('muted', !!S.wmute);
    $('wMute').setAttribute('aria-label', S.wmute ? 'Sound off' : 'Sound on');
    if (w.finished) {
      $('wDoneSummary').textContent = doneSummary(w.cfg);
      return;
    }
    box.classList.toggle('paused', !w.running);
    $('wToggle').innerHTML = w.running ? ICON.pause : ICON.play;
    $('wToggle').setAttribute('aria-label', w.running ? 'Pause' : 'Resume');
    const at = T.workoutAt(ph, T.swElapsed(w, Date.now()));
    const p = at.phase || ph[ph.length - 1];
    const color = w.cfg.colors[p.kind];
    const [ink, inkRgb] = inkFor(color);
    box.style.setProperty('--c', color);
    box.style.setProperty('--ink', ink);
    box.style.setProperty('--ink-rgb', inkRgb);
    $('wPhase').textContent = PHASE_NAME[p.kind];
    $('wCount').textContent = countText(p, w.cfg);
    const next = ph[at.i + 1];
    $('wNext').textContent = next ? `Next: ${PHASE_NAME[next.kind]} ${fmt(next.dur)}` : p.kind === 'work' ? 'Last round!' : 'Next: finish';
    const strip = $('wRunStrip');
    const stripKey = cfgKey(w.cfg) + JSON.stringify(w.cfg.colors);
    if (strip.dataset.key !== stripKey) {
      strip.dataset.key = stripKey;
      strip.innerHTML = stripHtml(ph, w.cfg.colors);
      strip.classList.toggle('dense', ph.length > 40);
    }
    $('wArc').setAttribute('stroke-dasharray', C.toFixed(2));
    wLast = {};
    paintWorkout(Date.now());
  }
  let wLast = {};
  function paintWorkout(now) {
    const w = S.wrun;
    if (!w || w.finished) return;
    const ph = phasesOf(w.cfg), el = T.swElapsed(w, now), at = T.workoutAt(ph, el), total = T.workoutTotal(ph);
    if (at.done) return;
    const time = T.timerText(at.left);
    if (wLast.time !== time) $('wTime').textContent = wLast.time = time;
    const left = T.timerText(total - el);
    if (wLast.left !== left) $('wLeft').textContent = wLast.left = left;
    const off = (C * (1 - at.left / at.phase.dur)).toFixed(1);
    if (wLast.off !== off) $('wArc').setAttribute('stroke-dashoffset', wLast.off = off);
    const pct = ((el / total) * 100).toFixed(2) + '%';
    if (wLast.pct !== pct) {
      wLast.pct = pct;
      $('wMarker').style.left = `calc(3px + (100% - 6px) * ${el / total})`;
      $('wDoneShade').style.width = `calc((100% - 6px) * ${el / total})`;
    }
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    renderTabs();
    renderWorkoutSetup();
    renderWorkoutRun();
    renderTimerView();
    renderStopwatch();
    renderAlarm();
  }

  function renderTabs() {
    const busy = {
      workout: !!(S.wrun && S.wrun.running),
      timer: S.timers.some((t) => t.state === 'running'),
      sw: S.sw.running,
    };
    document.querySelectorAll('.tabbtn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === S.tab);
      b.classList.toggle('busy', busy[b.dataset.tab]);
    });
    $('view-workout').classList.toggle('active', S.tab === 'workout');
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
    workoutTick(now);
    if (!away) {
      if (S.wrun) paintWorkout(now);
      if (S.tab === 'timer') paintCards(now);
      if (S.tab === 'sw') paintStopwatch(now);
      if (!$('alarm').hidden) paintAlarm(now);
    }
    plan(now);
  }
  function plan(now) {
    if (raf || timeout) return;
    const running = S.timers.filter((t) => t.state === 'running');
    // a running workout: when its current phase ends
    const w = S.wrun && S.wrun.running && !S.wrun.finished ? S.wrun : null;
    const wAt = w && T.workoutAt(phasesOf(w.cfg), T.swElapsed(w, now));
    if (away) {   // just wake up for the next timer or phase change
      const ends = running.map((t) => t.endAt);
      if (wAt && !wAt.done) ends.push(now + wAt.left);
      if (ends.length) timeout = setTimeout(tick, Math.max(0, Math.min(...ends) - now) + 20);
      if (ringing) timeout = timeout || setTimeout(tick, 1000);
      return;
    }
    if (S.sw.running && S.tab === 'sw' && !S.wrun) { raf = requestAnimationFrame(tick); return; }
    if (running.length || S.timers.some((t) => t.state === 'done') || w) {
      // wake just after the next whole second of any timer or the workout, at least 4 times a second
      let d = 250;
      for (const t of running) d = Math.min(d, (((t.endAt - now) % 1000) + 1000) % 1000 + 8);
      if (wAt && !wAt.done) d = Math.min(d, (wAt.left % 1000) + 8);
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
    stayAwake(false);
    save(); kick();
  }
  function onReturn() {
    away = false;
    takeDismissed();
    check(Date.now());
    workoutTick(Date.now());
    syncWorkout();
    render(); kick();
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? onAway() : onReturn()));
  window.appPaused = onAway;
  window.appResumed = onReturn;
  // Android Back: close a sheet or the keypad, then go to the Workout tab, then leave the app.
  // A running workout keeps going in the background.
  window.appBack = () => {
    if ($('alarm').hidden) {
      if (!$('colorSheet').hidden) { $('colorSheet').hidden = true; return; }
      if (!$('wConfirm').hidden) { $('wConfirm').hidden = true; return; }
      if (S.wrun && S.wrun.finished) { W.end(); return; }
      if (!S.wrun) {
        if (S.tab === 'timer' && kpOpen && S.timers.length) { kpOpen = false; render(); return; }
        if (S.tab !== 'workout') { setTab('workout'); return; }
      }
    }
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

  // ---- workout setup: steppers repeat while held
  let holdT = 0, holdI = 0;
  const stopHold = () => { clearTimeout(holdT); clearInterval(holdI); holdT = holdI = 0; };
  $('wRows').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b || b.disabled) return;
    e.preventDefault();
    const key = b.closest('.w-row').dataset.key, dir = +b.dataset.step;
    stopHold();
    stepW(key, dir);
    holdT = setTimeout(() => { holdI = setInterval(() => stepW(key, dir), 90); }, 420);
  });
  ['pointerup', 'pointercancel'].forEach((ev) => document.addEventListener(ev, stopHold));
  $('wRows').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw) return openColors(sw.dataset.color);
    const b = e.target.closest('[data-step]');   // keyboard (pointer presses are handled above)
    if (b && e.detail === 0 && !b.disabled) stepW(b.closest('.w-row').dataset.key, +b.dataset.step);
  });
  $('wPresets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (b) { S.wcfg = { ...S.wcfg, ...W_PRESETS[+b.dataset.preset].cfg }; save(); renderWorkoutSetup(); }
  });
  let colorKey = '';
  function openColors(key) {
    colorKey = key;
    $('colorTitle').textContent = `${W_ROWS.find((r) => r.key === key).label} colour`;
    $('swatches').innerHTML = PALETTE.map((c) => {
      const on = c === S.wcfg.colors[key];
      return `<button data-c="${c}" class="${on ? 'on' : ''}" style="--c:${c};--ink:${inkFor(c)[0]}" aria-label="${c}">${on ? ICON.check : ''}</button>`;
    }).join('');
    $('colorSheet').hidden = false;
  }
  $('colorSheet').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (b) { S.wcfg = { ...S.wcfg, colors: { ...S.wcfg.colors, [colorKey]: b.dataset.c } }; save(); renderWorkoutSetup(); }
    if (b || e.target === $('colorSheet')) $('colorSheet').hidden = true;
  });
  $('wStart').addEventListener('click', W.start);

  // ---- workout running
  $('wToggle').addEventListener('click', W.toggle);
  $('wSkip').addEventListener('click', () => W.jump(T.workoutSkip));
  $('wBack').addEventListener('click', () => W.jump(T.workoutBack));
  $('wEnd').addEventListener('click', () => { if (S.wrun && S.wrun.finished) W.end(); else $('wConfirm').hidden = false; });
  $('wConfirmNo').addEventListener('click', () => { $('wConfirm').hidden = true; });
  $('wConfirmYes').addEventListener('click', W.end);
  $('wConfirm').addEventListener('click', (e) => { if (e.target === $('wConfirm')) $('wConfirm').hidden = true; });
  $('wMute').addEventListener('click', () => { S.wmute = !S.wmute; syncWorkout(); commit(); });
  $('wAgain').addEventListener('click', () => { S.wcfg = { ...S.wcfg, ...S.wrun.cfg }; W.start(); });
  $('wClose').addEventListener('click', W.end);

  $('alarmStop').addEventListener('click', () => ACT.reset($('alarm').dataset.id));
  $('alarmPlus').addEventListener('click', () => ACT.plus($('alarm').dataset.id));

  // ------------------------------------------------------------------ start
  takeDismissed();
  // Re-arm the system alarms (they don't survive a reboot or a force stop)
  S.timers.filter((t) => t.state === 'running' && t.endAt > Date.now()).forEach(schedule);
  check(Date.now());
  workoutTick(Date.now());
  syncWorkout();
  render();
  kick();
})();
