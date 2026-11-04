// Time math for the timers and the stopwatch. No DOM: the page uses it as window.TimeMath and
// tests/time.test.js loads it with require().
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimeMath = factory();
})(this, function () {
  'use strict';
  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN;
  const pad2 = (n) => String(n).padStart(2, '0');

  // ---- Keypad entry ----
  // The keypad fills up to 6 digits from the right, read as HHMMSS: typing 1, 3, 0 gives 00h 01m 30s.
  function pushDigits(entry, digits) {
    return (entry + digits).replace(/^0+/, '').slice(0, 6);
  }
  function popDigit(entry) { return entry.slice(0, -1); }
  function entryParts(entry) {
    const p = entry.padStart(6, '0');
    return { h: +p.slice(0, 2), m: +p.slice(2, 4), s: +p.slice(4, 6) };
  }
  // "90" seconds is allowed and simply means 1:30, the same as on most phone clocks.
  function entryMs(entry) {
    const { h, m, s } = entryParts(entry);
    return (h * 3600 + m * 60 + s) * SEC;
  }
  // The reverse, for presets: 5 minutes -> "500", 90 minutes -> "13000".
  function msToEntry(ms) {
    let t = Math.round(ms / SEC);
    const h = Math.min(99, Math.floor(t / 3600)); t -= h * 3600;
    const m = Math.min(99, Math.floor(t / 60)); t -= m * 60;
    const s = Math.min(99, t);
    return (pad2(h) + pad2(m) + pad2(s)).replace(/^0+/, '');
  }

  // ---- Formatting ----
  function clock(totalSec) {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }
  // Time left on a timer rounds up, so it reads 0:01 until the very end and never shows 0:00 early.
  function timerText(ms) { return clock(Math.max(0, Math.ceil(ms / SEC))); }
  // Time since a timer went off, shown as −0:12 (with a real minus sign).
  function overText(ms) { return '\u2212' + clock(Math.max(0, Math.floor(ms / SEC))); }
  // Stopwatch: { main: "1:02:03" or "02:03", frac: ".45" } (hundredths, rounded down).
  function stopwatchParts(ms) {
    ms = Math.max(0, Math.floor(ms));
    const cs = Math.floor((ms % SEC) / 10);
    const total = Math.floor(ms / SEC);
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const main = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
    return { main, frac: '.' + pad2(cs) };
  }
  function stopwatchText(ms) { const p = stopwatchParts(ms); return p.main + p.frac; }
  // "1 h 30 min", "5 min", "45 s", "2 min 30 s": used to name timers that have no label.
  function durationWords(ms) {
    const t = Math.round(ms / SEC);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const out = [];
    if (h) out.push(h + ' h');
    if (m) out.push(m + ' min');
    if (s || !out.length) out.push(s + ' s');
    return out.join(' ');
  }

  // ---- Timers ----
  // A timer is { id, label, base, duration, state, endAt, remaining }. base is the time it was set to;
  // duration grows with +1:00 so the ring stays in proportion.
  //   state 'running': endAt is the wall-clock time (ms) it goes off
  //   state 'paused' : remaining is the time left; remaining === duration means it hasn't started
  //   state 'done'   : it went off at endAt and is waiting to be stopped
  // Everything works from timestamps, so the time stays right even when the app is asleep.
  function createTimer(id, duration, label, now) {
    return { id, label: label || '', base: duration, duration, state: 'running', endAt: now + duration, remaining: duration };
  }
  function remainingMs(t, now) {
    return t.state === 'paused' ? t.remaining : t.endAt - now;
  }
  function isIdle(t) { return t.state === 'paused' && t.remaining >= t.duration; }
  function progress(t, now) {
    if (t.state === 'done') return 0;
    return Math.min(1, Math.max(0, remainingMs(t, now) / t.duration));
  }
  function pause(t, now) {
    if (t.state !== 'running') return t;
    return { ...t, state: 'paused', remaining: Math.max(0, t.endAt - now), endAt: null };
  }
  function resume(t, now) {
    if (t.state !== 'paused') return t;
    return { ...t, state: 'running', endAt: now + t.remaining };
  }
  // Back to the time it was set to, not running. Stopping a timer that has gone off does the same.
  function reset(t) {
    const d = t.base || t.duration;
    return { ...t, state: 'paused', duration: d, remaining: d, endAt: null, quiet: false, ringAt: null };
  }
  // +1:00. A timer that already went off starts again with one minute.
  function addMinute(t, now) {
    if (t.state === 'running') return { ...t, endAt: t.endAt + MIN, duration: t.duration + MIN };
    if (t.state === 'paused') return { ...t, remaining: t.remaining + MIN, duration: t.duration + MIN };
    return { ...t, state: 'running', duration: MIN, endAt: now + MIN, remaining: MIN, quiet: false, ringAt: null };
  }
  function isDue(t, now) { return t.state === 'running' && t.endAt <= now; }

  // ---- Stopwatch ----
  // { running, startAt, acc, laps } where laps holds the total time at each lap press.
  function swElapsed(sw, now) { return sw.acc + (sw.running ? now - sw.startAt : 0); }
  function swStart(sw, now) { return sw.running ? sw : { ...sw, running: true, startAt: now }; }
  function swPause(sw, now) { return sw.running ? { ...sw, running: false, acc: swElapsed(sw, now), startAt: 0 } : sw; }
  function swLap(sw, now) { return { ...sw, laps: sw.laps.concat(swElapsed(sw, now)) }; }
  function swReset() { return { running: false, startAt: 0, acc: 0, laps: [] }; }
  // Split times between laps, plus the fastest and slowest lap (only marked once there are 2+ laps).
  function lapStats(laps) {
    const splits = laps.map((total, i) => total - (i ? laps[i - 1] : 0));
    let fastest = -1, slowest = -1;
    if (splits.length >= 2) {
      fastest = 0; slowest = 0;
      splits.forEach((v, i) => {
        if (v < splits[fastest]) fastest = i;
        if (v > splits[slowest]) slowest = i;
      });
      if (splits[fastest] === splits[slowest]) { fastest = -1; slowest = -1; }
    }
    return { splits, fastest, slowest };
  }

  return {
    SEC, MIN, HOUR,
    pushDigits, popDigit, entryParts, entryMs, msToEntry,
    clock, timerText, overText, stopwatchParts, stopwatchText, durationWords,
    createTimer, remainingMs, isIdle, progress, pause, resume, reset, addMinute, isDue,
    swElapsed, swStart, swPause, swLap, swReset, lapStats,
  };
});
