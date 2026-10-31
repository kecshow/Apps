/*
 * Poker engine: fair deck, shuffle, hand evaluation, and plain-English
 * explanations of why one hand beats another.
 * Works in the browser (window.Engine) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
  const RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RANK_NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const CAT_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

  const plural = (r) => (r === 6 ? 'Sixes' : RANK_NAME[r] + 's');
  const single = (r) => RANK_NAME[r];

  // ---------------------------------------------------------------------------
  // Randomness: cryptographically secure, unbiased. No weighting, no "rigging".
  // ---------------------------------------------------------------------------
  const cryptoApi = root.crypto && root.crypto.getRandomValues ? root.crypto : null;
  const u32 = new Uint32Array(1);

  /** Uniform random integer in [0, n). Uses rejection sampling so there is no modulo bias. */
  function randomInt(n) {
    if (!cryptoApi) return Math.floor(Math.random() * n); // very old browsers only
    const range = 0x100000000;
    const limit = range - (range % n);
    let x;
    do {
      cryptoApi.getRandomValues(u32);
      x = u32[0];
    } while (x >= limit);
    return x % n;
  }

  function newDeck() {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) deck.push({ r, s, id: r + '-' + s });
    return deck;
  }

  /** Fisher–Yates shuffle: every one of the 52! orders is equally likely, like a perfect real shuffle. */
  function shuffle(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    return deck;
  }

  // ---------------------------------------------------------------------------
  // Hand evaluation
  // ---------------------------------------------------------------------------
  /** Evaluate exactly 5 cards. Returns { cat, tb (tie-breakers), score, cards (ordered), name }. */
  function eval5(cards) {
    const rs = cards.map((c) => c.r).sort((a, b) => b - a);
    const s0 = cards[0].s;
    const flush = cards[1].s === s0 && cards[2].s === s0 && cards[3].s === s0 && cards[4].s === s0;
    const cnt = {};
    for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
    const groups = Object.keys(cnt)
      .map((r) => [cnt[r], +r])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);

    let straightHigh = 0;
    if (groups.length === 5) {
      if (rs[0] - rs[4] === 4) straightHigh = rs[0];
      else if (rs[0] === 14 && rs[1] === 5) straightHigh = 5; // A-2-3-4-5 "wheel"
    }

    let cat, tb;
    if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
    else if (groups[0][0] === 4) { cat = 7; tb = [groups[0][1], groups[1][1]]; }
    else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; tb = [groups[0][1], groups[1][1]]; }
    else if (flush) { cat = 5; tb = rs; }
    else if (straightHigh) { cat = 4; tb = [straightHigh]; }
    else if (groups[0][0] === 3) { cat = 3; tb = groups.map((g) => g[1]); }
    else if (groups[0][0] === 2 && groups[1][0] === 2) { cat = 2; tb = groups.map((g) => g[1]); }
    else if (groups[0][0] === 2) { cat = 1; tb = groups.map((g) => g[1]); }
    else { cat = 0; tb = rs; }

    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 16 + (tb[i] || 0);

    const val = (c) => (straightHigh === 5 && c.r === 14 ? 1 : c.r);
    const ordered = cards.slice().sort((a, b) => cnt[b.r] - cnt[a.r] || val(b) - val(a));

    return { cat, tb, score, cards: ordered, name: describe(cat, tb) };
  }

  /** Best 5-card hand out of 5, 6 or 7 cards. */
  function bestHand(cards) {
    if (cards.length === 5) return eval5(cards);
    let best = null;
    const n = cards.length;
    for (let a = 0; a < n - 4; a++)
      for (let b = a + 1; b < n - 3; b++)
        for (let c = b + 1; c < n - 2; c++)
          for (let d = c + 1; d < n - 1; d++)
            for (let e = d + 1; e < n; e++) {
              const h = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || h.score > best.score) best = h;
            }
    return best;
  }

  function catLabel(h) {
    return h.cat === 8 && h.tb[0] === 14 ? 'Royal Flush' : CAT_NAMES[h.cat];
  }

  function describe(cat, tb) {
    switch (cat) {
      case 8: return tb[0] === 14 ? 'Royal Flush' : `Straight Flush, ${single(tb[0])}-high`;
      case 7: return `Four of a Kind, ${plural(tb[0])}`;
      case 6: return `Full House, ${plural(tb[0])} full of ${plural(tb[1])}`;
      case 5: return `Flush, ${single(tb[0])}-high`;
      case 4: return `Straight, ${single(tb[0])}-high`;
      case 3: return `Three of a Kind, ${plural(tb[0])}`;
      case 2: return `Two Pair, ${plural(tb[0])} and ${plural(tb[1])}`;
      case 1: return `Pair of ${plural(tb[0])}`;
      default: return `High Card, ${single(tb[0])}`;
    }
  }

  const ORD = ['highest', '2nd-highest', '3rd-highest', '4th-highest', '5th-highest'];
  const withArticle = (s) => (/^[AEIOU]/.test(s) ? 'an ' : 'a ') + s;

  /**
   * Explain why `loser` lost to `winner`.
   * Returns { text, wRank, lRank } — the ranks that decided it (for highlighting), if any.
   */
  function explainLoss(winner, loser) {
    if (winner.score === loser.score) {
      return { text: 'Exactly the same hand strength — the pot is split.', wRank: null, lRank: null };
    }
    if (winner.cat !== loser.cat || (winner.cat === 8 && catLabel(winner) !== catLabel(loser))) {
      const w = catLabel(winner), l = catLabel(loser);
      return {
        text: `${withArticle(w)[0].toUpperCase() + withArticle(w).slice(1)} beats ${withArticle(l)}. ${w} ranks higher on the hand chart.`,
        wRank: null, lRank: null,
      };
    }
    let i = 0;
    while (winner.tb[i] === loser.tb[i]) i++;
    const a = winner.tb[i], b = loser.tb[i];
    let text;
    switch (winner.cat) {
      case 8:
      case 4:
        text = `Both made ${withArticle(CAT_NAMES[winner.cat])}, but ${single(a)}-high beats ${single(b)}-high.`;
        break;
      case 7:
        text = i === 0
          ? `Both had Four of a Kind. Four ${plural(a)} beat four ${plural(b)}.`
          : `Same Four of a Kind, so the fifth card (kicker) decided it: ${single(a)} beats ${single(b)}.`;
        break;
      case 6:
        text = i === 0
          ? `Both had a Full House. The three-of-a-kind part is compared first: ${plural(a)} full beats ${plural(b)} full.`
          : `Same three of a kind in the Full House, so the pair decided it: ${plural(a)} beat ${plural(b)}.`;
        break;
      case 5:
        text = `Both had a Flush. Flushes are compared card by card. The ${ORD[i]} card decided it: ${single(a)} beats ${single(b)}.`;
        break;
      case 3:
        text = i === 0
          ? `Both had Three of a Kind. Three ${plural(a)} beat three ${plural(b)}.`
          : `Same Three of a Kind, so the kicker decided it: ${single(a)} beats ${single(b)}.`;
        break;
      case 2:
        text = i === 0
          ? `Both had Two Pair. The top pair is compared first: ${plural(a)} beat ${plural(b)}.`
          : i === 1
            ? `Same top pair (${plural(winner.tb[0])}), so the second pair decided it: ${plural(a)} beat ${plural(b)}.`
            : `Same two pairs, so the fifth card (kicker) decided it: ${single(a)} beats ${single(b)}.`;
        break;
      case 1:
        text = i === 0
          ? `Both had One Pair. A pair of ${plural(a)} beats a pair of ${plural(b)}.`
          : `Both had a pair of ${plural(winner.tb[0])}, so the kicker decided it: ${single(a)} beats ${single(b)}.`;
        break;
      default:
        text = `Neither made a pair, so it came down to high cards. The ${ORD[i]} card decided it: ${single(a)} beats ${single(b)}.`;
    }
    return { text, wRank: a, lRank: b };
  }

  function cardLabel(c) {
    return RANK_LABEL[c.r] + SUITS[c.s];
  }

  const Engine = {
    SUITS, SUIT_NAMES, RANK_LABEL, RANK_NAME, CAT_NAMES,
    randomInt, newDeck, shuffle, eval5, bestHand, describe, catLabel, explainLoss, cardLabel,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
