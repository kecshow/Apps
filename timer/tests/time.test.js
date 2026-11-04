// node tests/time.test.js
const assert = require('assert');
const T = require('../js/time.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL', name); throw e; }
}
const MIN = T.MIN, SEC = T.SEC;

test('keypad fills from the right as HHMMSS', () => {
  let e = '';
  for (const d of ['1', '3', '0']) e = T.pushDigits(e, d);
  assert.strictEqual(e, '130');
  assert.deepStrictEqual(T.entryParts(e), { h: 0, m: 1, s: 30 });
  assert.strictEqual(T.entryMs(e), 90 * SEC);
  assert.strictEqual(T.entryMs(T.pushDigits('1', '00')), MIN);          // 1, 00 -> 1 min
  assert.strictEqual(T.entryMs('10000'), 3600 * SEC);                    // 1 h
});
test('keypad ignores leading zeros, stops at 6 digits, deletes', () => {
  assert.strictEqual(T.pushDigits('', '0'), '');
  assert.strictEqual(T.pushDigits('', '00'), '');
  assert.strictEqual(T.pushDigits('12345', '00'), '123450');
  assert.strictEqual(T.pushDigits('123456', '7'), '123456');
  assert.strictEqual(T.popDigit('130'), '13');
  assert.strictEqual(T.popDigit(''), '');
});
test('"90" seconds means 1:30, 99:99:99 is the maximum', () => {
  assert.strictEqual(T.entryMs('90'), 90 * SEC);
  assert.strictEqual(T.entryMs('999999'), (99 * 3600 + 99 * 60 + 99) * SEC);
});
test('presets turn into keypad digits', () => {
  assert.strictEqual(T.msToEntry(5 * MIN), '500');
  assert.strictEqual(T.msToEntry(45 * MIN), '4500');
  assert.strictEqual(T.msToEntry(60 * MIN), '10000');
  assert.strictEqual(T.msToEntry(90 * MIN), '13000');
  for (const m of [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 125]) assert.strictEqual(T.entryMs(T.msToEntry(m * MIN)), m * MIN);
});
test('timer text rounds up and never shows 0:00 early', () => {
  assert.strictEqual(T.timerText(5 * MIN), '5:00');
  assert.strictEqual(T.timerText(5 * MIN - 1), '5:00');
  assert.strictEqual(T.timerText(4 * MIN + 59 * SEC), '4:59');
  assert.strictEqual(T.timerText(1), '0:01');
  assert.strictEqual(T.timerText(0), '0:00');
  assert.strictEqual(T.timerText(-500), '0:00');
  assert.strictEqual(T.timerText(3600 * SEC), '1:00:00');
  assert.strictEqual(T.timerText(3723 * SEC), '1:02:03');
});
test('overtime text', () => {
  assert.strictEqual(T.overText(0), '−0:00');
  assert.strictEqual(T.overText(12999), '−0:12');
  assert.strictEqual(T.overText(61 * MIN), '−1:01:00');
});
test('stopwatch text', () => {
  assert.strictEqual(T.stopwatchText(0), '00:00.00');
  assert.strictEqual(T.stopwatchText(83456), '01:23.45');
  assert.strictEqual(T.stopwatchText(59999), '00:59.99');
  assert.strictEqual(T.stopwatchText(3723450), '1:02:03.45');
  assert.deepStrictEqual(T.stopwatchParts(1234), { main: '00:01', frac: '.23' });
});
test('duration words name unlabelled timers', () => {
  assert.strictEqual(T.durationWords(5 * MIN), '5 min');
  assert.strictEqual(T.durationWords(90 * SEC), '1 min 30 s');
  assert.strictEqual(T.durationWords(45 * SEC), '45 s');
  assert.strictEqual(T.durationWords(90 * MIN), '1 h 30 min');
  assert.strictEqual(T.durationWords(0), '0 s');
});

test('a timer runs, pauses, resumes and goes off on time', () => {
  const now = 1_000_000;
  let t = T.createTimer('a', 5 * MIN, 'Tea', now);
  assert.strictEqual(t.state, 'running');
  assert.strictEqual(T.remainingMs(t, now + MIN), 4 * MIN);
  assert.strictEqual(T.progress(t, now + MIN), 0.8);
  t = T.pause(t, now + MIN);
  assert.strictEqual(t.state, 'paused');
  assert.strictEqual(T.remainingMs(t, now + 10 * MIN), 4 * MIN);   // paused time doesn't count
  assert.ok(!T.isIdle(t));
  t = T.resume(t, now + 10 * MIN);
  assert.strictEqual(t.endAt, now + 14 * MIN);
  assert.ok(!T.isDue(t, now + 14 * MIN - 1));
  assert.ok(T.isDue(t, now + 14 * MIN));
});
test('pause/resume do nothing in the wrong state', () => {
  const t = T.createTimer('a', MIN, '', 0);
  assert.strictEqual(T.resume(t, 5), t);
  const p = T.pause(t, 10);
  assert.strictEqual(T.pause(p, 20), p);
});
test('pausing after the end leaves zero, not a negative time', () => {
  const t = T.pause(T.createTimer('a', MIN, '', 0), 2 * MIN);
  assert.strictEqual(t.remaining, 0);
});
test('+1:00 on a running, paused and finished timer', () => {
  const now = 0;
  let t = T.createTimer('a', 5 * MIN, '', now);
  const r = T.addMinute(t, now + MIN);
  assert.strictEqual(r.endAt, 6 * MIN);
  assert.strictEqual(r.duration, 6 * MIN);
  assert.ok(T.progress(r, now + MIN) <= 1);
  const p = T.addMinute(T.pause(t, MIN), MIN);
  assert.strictEqual(p.remaining, 5 * MIN);
  const done = { ...t, state: 'done', quiet: true, ringAt: 5 * MIN };
  const again = T.addMinute(done, 6 * MIN);
  assert.strictEqual(again.state, 'running');
  assert.strictEqual(again.endAt, 7 * MIN);
  assert.strictEqual(again.quiet, false);
  assert.strictEqual(again.base, 5 * MIN);                           // reset still goes back to 5 min
});
test('reset goes back to the time the timer was set to', () => {
  let t = T.createTimer('a', 5 * MIN, '', 0);
  t = T.addMinute(T.addMinute(t, 0), 0);
  t = T.reset({ ...t, state: 'done', quiet: true, ringAt: 1 });
  assert.strictEqual(t.state, 'paused');
  assert.strictEqual(t.duration, 5 * MIN);
  assert.strictEqual(t.remaining, 5 * MIN);
  assert.strictEqual(t.endAt, null);
  assert.ok(T.isIdle(t));
  assert.strictEqual(T.progress(t, 123), 1);
});
test('a finished timer has no ring left', () => {
  const t = { ...T.createTimer('a', MIN, '', 0), state: 'done' };
  assert.strictEqual(T.progress(t, 2 * MIN), 0);
  assert.strictEqual(T.remainingMs(t, 2 * MIN), -MIN);
});

test('stopwatch counts only while running and records laps', () => {
  let sw = T.swReset();
  assert.strictEqual(T.swElapsed(sw, 999), 0);
  sw = T.swStart(sw, 1000);
  assert.strictEqual(T.swElapsed(sw, 4000), 3000);
  sw = T.swLap(sw, 4000);
  sw = T.swPause(sw, 6000);
  assert.strictEqual(T.swElapsed(sw, 60000), 5000);
  sw = T.swStart(sw, 10000);
  assert.strictEqual(T.swStart(sw, 12000), sw);                      // start twice = no change
  sw = T.swLap(sw, 12000);
  assert.deepStrictEqual(sw.laps, [3000, 7000]);
  assert.strictEqual(T.swElapsed(sw, 12000), 7000);
  assert.deepStrictEqual(T.swReset(), { running: false, startAt: 0, acc: 0, laps: [] });
});
test('lap stats mark the fastest and slowest lap', () => {
  assert.deepStrictEqual(T.lapStats([]), { splits: [], fastest: -1, slowest: -1 });
  assert.deepStrictEqual(T.lapStats([5000]), { splits: [5000], fastest: -1, slowest: -1 });
  assert.deepStrictEqual(T.lapStats([1000, 3000, 4500]), { splits: [1000, 2000, 1500], fastest: 0, slowest: 1 });
  assert.deepStrictEqual(T.lapStats([2000, 4000]), { splits: [2000, 2000], fastest: -1, slowest: -1 }); // all equal
  assert.deepStrictEqual(T.lapStats([3000, 4000, 7000]).fastest, 1);
});

// ---- workouts
const cfg = (o) => ({ prepare: 10 * SEC, work: 45 * SEC, rest: 15 * SEC, rounds: 3, cycles: 2, cycleRest: MIN, ...o });
const kinds = (ph) => ph.map((p) => p.kind + (p.kind === 'prepare' ? '' : p.round + '/' + p.cycle)).join(' ');

test('workout order: rounds with rests, cycles with a cycle rest, nothing after the last round', () => {
  const ph = T.workoutPhases(cfg());
  assert.strictEqual(kinds(ph), 'prepare work1/1 rest1/1 work2/1 rest2/1 work3/1 cycleRest3/1 work1/2 rest1/2 work2/2 rest2/2 work3/2');
  assert.strictEqual(T.workoutTotal(ph), 10 * SEC + 6 * 45 * SEC + 4 * 15 * SEC + MIN);
  let t = 0;
  for (const p of ph) { assert.strictEqual(p.start, t); t += p.dur; }
});
test('workout: phases set to 0:00 are left out; no cycle rest falls back to the normal rest', () => {
  assert.strictEqual(kinds(T.workoutPhases(cfg({ prepare: 0, rest: 0, cycleRest: 0 }))), 'work1/1 work2/1 work3/1 work1/2 work2/2 work3/2');
  assert.strictEqual(kinds(T.workoutPhases(cfg({ prepare: 0, cycleRest: 0, cycles: 2, rounds: 2 }))), 'work1/1 rest1/1 work2/1 rest2/1 work1/2 rest1/2 work2/2');
  assert.strictEqual(kinds(T.workoutPhases(cfg({ prepare: 0, rounds: 1, cycles: 1 }))), 'work1/1');
});
test('Tabata is 4 minutes after get ready', () => {
  const ph = T.workoutPhases({ prepare: 10 * SEC, work: 20 * SEC, rest: 10 * SEC, rounds: 8, cycles: 1, cycleRest: MIN });
  assert.strictEqual(ph.length, 1 + 8 + 7);
  assert.strictEqual(T.workoutTotal(ph), 10 * SEC + 8 * 20 * SEC + 7 * 10 * SEC);
});
test('workoutAt finds the phase and the time left', () => {
  const ph = T.workoutPhases(cfg());
  assert.deepStrictEqual([T.workoutAt(ph, 0).i, T.workoutAt(ph, 0).left], [0, 10 * SEC]);
  const a = T.workoutAt(ph, 10 * SEC);
  assert.strictEqual(a.phase.kind, 'work'); assert.strictEqual(a.left, 45 * SEC);
  const b = T.workoutAt(ph, 10 * SEC + 45 * SEC + 3 * SEC);
  assert.strictEqual(b.phase.kind, 'rest'); assert.strictEqual(b.left, 12 * SEC);
  assert.ok(T.workoutAt(ph, T.workoutTotal(ph)).done);
  assert.ok(!T.workoutAt(ph, T.workoutTotal(ph) - 1).done);
});
test('workout skip and back', () => {
  const ph = T.workoutPhases(cfg());
  let run = T.swStart(T.swReset(), 0);
  run = T.workoutSkip(ph, run, 3000);                            // skip get ready
  assert.strictEqual(T.swElapsed(run, 3000), 10 * SEC);
  assert.strictEqual(T.workoutAt(ph, T.swElapsed(run, 8000)).phase.kind, 'work');
  run = T.workoutBack(ph, run, 8000);                            // 5 s into the round: back to its start
  assert.strictEqual(T.swElapsed(run, 8000), 10 * SEC);
  run = T.workoutBack(ph, run, 9000);                            // 1 s in: back to get ready
  assert.strictEqual(T.swElapsed(run, 9000), 0);
  run = T.workoutBack(ph, run, 9500);                            // already at the first phase
  assert.strictEqual(T.swElapsed(run, 9500), 0);
  const paused = T.swPause(run, 10000);
  const sk = T.workoutSkip(ph, paused, 20000);                   // skipping while paused stays paused
  assert.strictEqual(sk.running, false);
  assert.strictEqual(T.swElapsed(sk, 99999), 10 * SEC);
  const end = T.workoutSeek(run, T.workoutTotal(ph), 0);
  assert.strictEqual(T.workoutSkip(ph, end, 0), end);            // nothing after the end
  assert.strictEqual(T.swElapsed(T.workoutBack(ph, end, 0), 0), ph[ph.length - 1].start);
});
test('duration steppers', () => {
  const up = (s) => T.stepDuration(s * SEC, 1, 0, 99 * MIN) / SEC;
  const down = (s) => T.stepDuration(s * SEC, -1, 0, 99 * MIN) / SEC;
  assert.deepStrictEqual([up(0), up(45), up(47), up(55), up(60), up(285), up(300), up(1200)], [5, 50, 50, 60, 75, 300, 330, 1260]);
  assert.deepStrictEqual([down(5), down(47), down(60), down(75), down(300), down(330), down(1260)], [0, 45, 55, 60, 285, 300, 1200]);
  assert.strictEqual(T.stepDuration(5 * SEC, -1, 5 * SEC, MIN), 5 * SEC);   // limits
  assert.strictEqual(T.stepDuration(MIN, 1, 0, MIN), MIN);
});

console.log(`all ${passed} tests passed`);
