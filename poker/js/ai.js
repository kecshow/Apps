/*
 * Computer opponents. They only ever see their own cards plus the public board,
 * never anyone else's cards or the order of the deck.
 * Hand strength is estimated by simulating many random run-outs (Monte Carlo).
 */
(function (root) {
  'use strict';
  const E = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

  // Simulation randomness only affects the AI's *guesswork*, not the real deck.
  function sampleCards(pool, k) {
    const a = pool.slice();
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(Math.random() * (a.length - i));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a.slice(0, k);
  }

  function remainingDeck(known) {
    const ids = new Set(known.map((c) => c.id));
    return E.newDeck().filter((c) => !ids.has(c.id));
  }

  /** Share of the pot this hand would win against `nOpp` random hands. */
  function equityHoldem(hole, board, nOpp, sims) {
    const pool = remainingDeck(hole.concat(board));
    const needBoard = 5 - board.length;
    let total = 0;
    for (let s = 0; s < sims; s++) {
      const draw = sampleCards(pool, needBoard + nOpp * 2);
      const fullBoard = board.concat(draw.slice(0, needBoard));
      const mine = E.bestHand(hole.concat(fullBoard)).score;
      let best = -1, ties = 0, beaten = false;
      for (let o = 0; o < nOpp; o++) {
        const off = needBoard + o * 2;
        const sc = E.bestHand([draw[off], draw[off + 1]].concat(fullBoard)).score;
        if (sc > mine) { beaten = true; break; }
        if (sc === mine) ties++;
        if (sc > best) best = sc;
      }
      if (!beaten) total += 1 / (ties + 1);
    }
    return total / sims;
  }

  /** Equity for five card draw. Before the draw we simulate our own planned draw. */
  function equityDraw(hand, nOpp, beforeDraw, sims) {
    const pool = remainingDeck(hand);
    const discard = beforeDraw ? chooseDiscards(hand) : [];
    const kept = hand.filter((_, i) => !discard.includes(i));
    let total = 0;
    for (let s = 0; s < sims; s++) {
      const draw = sampleCards(pool, discard.length + nOpp * 5);
      const mine = E.eval5(kept.concat(draw.slice(0, discard.length))).score;
      let ties = 0, beaten = false;
      for (let o = 0; o < nOpp; o++) {
        const off = discard.length + o * 5;
        const sc = E.eval5(draw.slice(off, off + 5)).score;
        if (sc > mine) { beaten = true; break; }
        if (sc === mine) ties++;
      }
      if (!beaten) total += 1 / (ties + 1);
    }
    return total / sims;
  }

  /** Which card indices to throw away in five card draw (max 3). */
  function chooseDiscards(hand) {
    const h = E.eval5(hand);
    const idx = (pred) => hand.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
    if (h.cat >= 4) return []; // straight or better: stand pat
    if (h.cat === 3) return idx((c) => c.r !== h.tb[0]);
    if (h.cat === 2) return idx((c) => c.r !== h.tb[0] && c.r !== h.tb[1]);

    // Four to a flush?
    for (let s = 0; s < 4; s++) {
      const off = idx((c) => c.s !== s);
      if (off.length === 1 && h.cat === 0) return off;
    }
    // Four to an open-ended straight?
    if (h.cat === 0) {
      const ranks = [...new Set(hand.map((c) => c.r))];
      for (let lo = 2; lo <= 10; lo++) {
        const want = [lo, lo + 1, lo + 2, lo + 3];
        if (want.every((r) => ranks.includes(r)) && lo + 3 < 14) {
          const keepIds = new Set();
          return hand.map((c, i) => {
            if (want.includes(c.r) && !keepIds.has(c.r)) { keepIds.add(c.r); return -1; }
            return i;
          }).filter((i) => i >= 0);
        }
      }
    }
    if (h.cat === 1) return idx((c) => c.r !== h.tb[0]);
    // Nothing: keep the two highest cards.
    const order = hand.map((c, i) => [c.r, i]).sort((a, b) => b[0] - a[0]);
    return order.slice(2).map((x) => x[1]);
  }

  const PROFILES = [
    { aggr: 0.75, tight: 0.15, style: 'Aggressive' },
    { aggr: 0.35, tight: 0.6, style: 'Careful' },
    { aggr: 0.55, tight: 0.35, style: 'Balanced' },
  ];

  /**
   * v: { mode, hand, board, street, pot, toCall, currentBet, minRaise, bet, chips, numOpp, bb }
   * returns { type: 'fold'|'check'|'call'|'raise', to? }
   */
  function decide(v, prof) {
    const sims = 260;
    let eq;
    if (v.mode === 'holdem') eq = equityHoldem(v.hand, v.board, v.numOpp, sims);
    else eq = equityDraw(v.hand, v.numOpp, v.street === 'before the draw', sims);

    const fair = 1 / (v.numOpp + 1);
    const rel = eq / fair;
    const r = Math.random();
    const maxTo = v.bet + v.chips;
    const raiseTo = (mult) => {
      const size = Math.max(v.minRaise, Math.round((v.pot * mult) / v.bb) * v.bb);
      return Math.min(maxTo, v.currentBet + size);
    };
    const raise = (mult) => {
      const to = raiseTo(mult);
      if (to <= v.currentBet) return v.toCall > 0 ? { type: 'call' } : { type: 'check' };
      return { type: 'raise', to };
    };

    if (v.toCall === 0) {
      if (rel > 1.5 - prof.aggr * 0.3 && r < 0.55 + prof.aggr * 0.4) return raise(0.5 + Math.random() * 0.5);
      if (r < prof.aggr * 0.12) return raise(0.5); // bluff
      return { type: 'check' };
    }

    const potOdds = v.toCall / (v.pot + v.toCall);
    if (rel > 2.0 - prof.aggr * 0.4 && r < 0.4 + prof.aggr * 0.4 && v.chips > v.toCall) {
      return raise(0.7 + Math.random() * 0.5);
    }
    const need = potOdds + prof.tight * 0.06 + (v.toCall >= v.chips * 0.5 ? 0.08 : 0);
    if (eq >= need) return { type: 'call' };
    if (r < prof.aggr * 0.04 && v.chips > v.toCall * 3) return raise(0.8); // rare bluff-raise
    return { type: 'fold' };
  }

  const AI = { decide, chooseDiscards, equityHoldem, equityDraw, PROFILES };
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
  root.AI = AI;
})(typeof window !== 'undefined' ? window : globalThis);
