// Run with: node tests/engine.test.js
'use strict';
const assert = require('assert');
const E = require('../js/engine.js');
const AI = require('../js/ai.js');

const c = (s) => {
  const r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[s[0]] || +s[0];
  return { r, s: { s: 0, h: 1, d: 2, c: 3 }[s[1]], id: s };
};
const H = (str) => str.split(' ').map(c);

// 1) Evaluate every possible 5-card hand and compare category counts to the known totals.
{
  const deck = E.newDeck();
  const counts = new Array(9).fill(0);
  let royals = 0;
  for (let a = 0; a < 48; a++) for (let b = a + 1; b < 49; b++) for (let d = b + 1; d < 50; d++)
    for (let e = d + 1; e < 51; e++) for (let f = e + 1; f < 52; f++) {
      const h = E.eval5([deck[a], deck[b], deck[d], deck[e], deck[f]]);
      counts[h.cat]++;
      if (h.name === 'Royal Flush') royals++;
    }
  const expected = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
  assert.deepStrictEqual(counts, expected);
  assert.strictEqual(royals, 4);
  console.log('✓ all 2,598,960 five-card hands classified correctly');
}

// 2) Tie-breaks and explanations.
{
  const better = (x, y) => E.bestHand(H(x)).score > E.bestHand(H(y)).score;
  assert(better('As Ah Kd 7c 3s', 'Ks Kh Ad Qc Js'));          // higher pair
  assert(better('As Ah Kd 7c 3s', 'Ad Ac Qd Jc Ts'));          // kicker
  assert(better('Ks Kh 2d 2c 3s', 'Qs Qh Jd Jc As'));          // top pair of two pair
  assert(better('6s 5h 4d 3c 2s', 'As 2h 3d 4c 5s'));          // 6-high straight beats wheel
  assert(better('2s 2h 2d 3c 3s', 'As Kh Qd Jc 9s') === true); // full house beats nothing
  assert(better('As Ks Qs Js Ts', '9s 8s 7s 6s 5s'));          // royal beats straight flush
  const w = E.eval5(H('Ad Ac Kd Jc Ts')), l = E.eval5(H('As Ah Qd Jc Ts'));
  const ex = E.explainLoss(w, l);
  assert(/kicker/i.test(ex.text) && ex.wRank === 13 && ex.lRank === 12, ex.text);
  assert(/Flush beats a Straight/.test(E.explainLoss(E.eval5(H('2h 5h 8h Th Kh')), E.eval5(H('9s Th Jd Qc Ks'))).text));
  assert(/split/.test(E.explainLoss(E.eval5(H('As Ah Kd 7c 3s')), E.eval5(H('Ad Ac Kh 7d 3h'))).text));
  // Hold'em: best 5 of 7
  const b = E.bestHand(H('Ah Kh Qh Jh 2c 3d Th'));
  assert.strictEqual(b.name, 'Royal Flush');
  console.log('✓ tie-breaks, best-of-7 and explanations');
}

// 3) Shuffle fairness: each card should land in each position equally often (chi-square).
{
  const N = 200000;
  const pos = Array.from({ length: 52 }, () => new Array(52).fill(0));
  for (let t = 0; t < N; t++) {
    const d = E.shuffle(E.newDeck());
    for (let i = 0; i < 52; i++) pos[(d[i].r - 2) + d[i].s * 13][i]++;
  }
  const exp = N / 52;
  let chi = 0;
  for (const row of pos) for (const v of row) chi += ((v - exp) ** 2) / exp;
  // 51*51 = 2601 degrees of freedom; mean 2601, sd ~72. Allow a wide margin.
  assert(chi > 2601 - 6 * 72 && chi < 2601 + 6 * 72, 'chi-square out of range: ' + chi);
  console.log(`✓ shuffle uniform (chi² = ${chi.toFixed(0)}, expected ≈ 2601)`);

  // randomInt has no modulo bias for small n
  const k = new Array(7).fill(0);
  for (let t = 0; t < 70000; t++) k[E.randomInt(7)]++;
  k.forEach((v) => assert(Math.abs(v - 10000) < 600));
  console.log('✓ randomInt uniform');
}

// 4) AI sanity
{
  assert.deepStrictEqual(AI.chooseDiscards(H('As Ks Qs Js Ts')), []);
  assert.strictEqual(AI.chooseDiscards(H('8s 8h Kd 7c 3s')).length, 3);
  assert.deepStrictEqual(AI.chooseDiscards(H('2h 5h 8h Th Kc')), [4]);
  const strong = AI.equityHoldem(H('As Ah'), [], 3, 400);
  const weak = AI.equityHoldem(H('7c 2d'), [], 3, 400);
  assert(strong > 0.5 && weak < 0.2, `${strong} ${weak}`);
  console.log(`✓ AI (AA equity ${strong.toFixed(2)}, 72o ${weak.toFixed(2)} vs 3 players)`);
}
// 5) Opponent names
{
  const Names = require('../js/names.js');
  const names = Names.ALL.map((o) => o.name);
  ['Kádár J.', 'Rákosi M.', 'Horthy M.', 'F. Roosevelt', 'H. Truman', 'M. Gorbachev', 'N. Hrushchov', 'R. Reagan',
   'G. H. W. Bush', 'G. W. Bush', 'B. Clinton', 'J. Fangio', 'M. Schumacher', 'L. Hamilton', 'M. Verstappen', 'L. Norris']
    .forEach((n) => assert(names.includes(n), 'missing ' + n));
  assert.strictEqual(new Set(names).size, names.length, 'duplicate names');
  assert.strictEqual(Names.ALL.length, 11 + 35);
  for (let t = 0; t < 200; t++) {
    const p = Names.pick(3, E.randomInt);
    assert.strictEqual(new Set(p.map((o) => o.name)).size, 3);
  }
  console.log(`✓ ${Names.ALL.length} opponents, Hungarian names surname-first, 3 distinct picks per game`);
}
console.log('All tests passed.');
