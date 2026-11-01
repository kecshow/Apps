/*
 * Blackjack: you vs the dealer on a green table.
 * 6-deck shoe, fair crypto shuffle, cut card, dealer stands on all 17s, blackjack pays 3 to 2,
 * double on any first two cards, split up to 4 hands (split aces get one card each).
 */
(function () {
  'use strict';
  const E = window.Engine;
  const DECKS = 6, START = 1000, MIN_BET = 10, KEY = 'bluefelt-bj-v1';
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => '$' + n.toLocaleString('en-US');
  const speed = () => (window.App ? window.App.speed : 1);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * speed()));

  const B = {
    bank: START, bet: 0, lastBet: 50, shoe: [], cutLeft: 0, dealer: [], hands: [], active: -1,
    phase: 'betting', holeHidden: true, seen: new Set(), acting: false, pendingLeave: null, msg: '',
  };

  // ---------------------------------------------------------------------------
  // Cards & hand values
  // ---------------------------------------------------------------------------
  const cardVal = (c) => (c.r === 14 ? 11 : c.r >= 10 ? 10 : c.r);
  function value(cards) {
    let t = 0, aces = 0;
    for (const c of cards) { t += cardVal(c); if (c.r === 14) aces++; }
    while (t > 21 && aces > 0) { t -= 10; aces--; }
    return { total: t, soft: aces > 0 };
  }
  const isBJ = (cards) => cards.length === 2 && value(cards).total === 21;

  function newShoe() {
    let cards = [];
    for (let d = 0; d < DECKS; d++) cards = cards.concat(E.newDeck().map((c) => ({ r: c.r, s: c.s, id: c.id + '-' + d })));
    B.shoe = E.shuffle(cards);
    // Cut card goes in 1 to 1.5 decks from the back, like a real dealer would place it.
    B.cutLeft = 52 + E.randomInt(27);
  }
  function draw() {
    if (!B.shoe.length) newShoe();
    return B.shoe.pop();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ bank: B.bank, lastBet: B.lastBet })); } catch (e) { /* ignore */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------
  // Round flow
  // ---------------------------------------------------------------------------
  function toBetting() {
    B.phase = 'betting';
    B.dealer = [];
    B.hands = [];
    B.active = -1;
    B.seen.clear();
    B.bet = Math.min(B.lastBet, Math.floor(B.bank / 10) * 10);
    if (B.bet < MIN_BET) B.bet = 0;
    setMsg('Place your bet, then tap Deal');
    render();
  }

  async function deal() {
    if (B.phase !== 'betting' || B.bet < MIN_BET || B.bet > B.bank) return;
    B.phase = 'dealing';
    if (B.shoe.length < B.cutLeft) {
      setMsg('Cut card reached: shuffling a fresh 6-deck shoe…');
      newShoe();
      render();
      await sleep(1100);
    }
    B.bank -= B.bet;
    B.lastBet = B.bet;
    B.hands = [newHand(B.bet)];
    B.dealer = [];
    B.holeHidden = true;
    B.seen.clear();
    setMsg('Dealing…');
    render();
    for (let k = 0; k < 2; k++) {
      await sleep(300);
      B.hands[0].cards.push(draw());
      render();
      await sleep(300);
      B.dealer.push(draw());
      render();
    }
    const up = B.dealer[0];
    const peek = up.r === 14 || cardVal(up) === 10;
    if (peek) {
      setMsg('Dealer checks for Blackjack…');
      await sleep(800);
    }
    if ((peek && isBJ(B.dealer)) || isBJ(B.hands[0].cards)) {
      B.holeHidden = false;
      render();
      await sleep(600);
      settle();
      return;
    }
    B.phase = 'playing';
    B.active = 0;
    setMsg('Your move');
    render();
  }

  function newHand(bet) {
    return { cards: [], bet, done: false, doubled: false, splitAces: false, fromSplit: false, result: null, net: 0, text: '' };
  }

  const canDouble = (h) => h && h.cards.length === 2 && !h.splitAces && B.bank >= h.bet;
  const canSplit = (h) => h && h.cards.length === 2 && !h.splitAces && cardVal(h.cards[0]) === cardVal(h.cards[1])
    && B.hands.length < 4 && B.bank >= h.bet;

  async function act(type) {
    if (B.phase !== 'playing' || B.acting) return;
    const h = B.hands[B.active];
    if (!h) return;
    B.acting = true;
    render();
    if (type === 'hit') {
      h.cards.push(draw());
      if (value(h.cards).total >= 21) h.done = true;
      setMsg(value(h.cards).total > 21 ? `Bust with ${value(h.cards).total}` : 'Hit');
    } else if (type === 'stand') {
      h.done = true;
      setMsg(`Stand on ${value(h.cards).total}`);
    } else if (type === 'double' && canDouble(h)) {
      B.bank -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(draw());
      h.done = true;
      setMsg(`Double down: one card, bet now ${fmt(h.bet)}`);
    } else if (type === 'split' && canSplit(h)) {
      B.bank -= h.bet;
      const second = h.cards.pop();
      const nh = newHand(h.bet);
      nh.cards.push(second);
      h.fromSplit = nh.fromSplit = true;
      B.hands.splice(B.active + 1, 0, nh);
      render();
      await sleep(300);
      h.cards.push(draw());
      render();
      await sleep(300);
      nh.cards.push(draw());
      if (second.r === 14) {
        h.splitAces = nh.splitAces = true;
        h.done = nh.done = true; // split aces: one card each
        setMsg('Split aces get one card each');
      } else {
        setMsg('Split into two hands');
      }
    }
    render();
    await sleep(350);
    await advance();
    B.acting = false;
    render();
  }

  async function advance() {
    while (B.active < B.hands.length && (B.hands[B.active].done || value(B.hands[B.active].cards).total >= 21)) {
      B.hands[B.active].done = true;
      B.active++;
    }
    if (B.active >= B.hands.length) await dealerPlay();
    else if (B.hands.length > 1) setMsg(`Hand ${B.active + 1} of ${B.hands.length}: your move`);
  }

  async function dealerPlay() {
    B.phase = 'dealer';
    B.active = -1;
    B.holeHidden = false;
    setMsg('Dealer reveals the hidden card');
    render();
    await sleep(750);
    const anyAlive = B.hands.some((h) => value(h.cards).total <= 21);
    if (anyAlive) {
      while (value(B.dealer).total < 17) {
        setMsg(`Dealer has ${value(B.dealer).total}: must draw`);
        B.dealer.push(draw());
        render();
        await sleep(750);
      }
      const d = value(B.dealer).total;
      setMsg(d > 21 ? `Dealer busts with ${d}!` : `Dealer stands on ${d}`);
    }
    await sleep(400);
    settle();
  }

  function settle() {
    const dv = value(B.dealer).total;
    const dBJ = isBJ(B.dealer);
    let totalNet = 0;
    for (const h of B.hands) {
      const v = value(h.cards).total;
      const bj = isBJ(h.cards) && !h.fromSplit;
      let payout = 0;
      if (bj && dBJ) { h.result = 'push'; payout = h.bet; h.text = 'You and the dealer both have Blackjack: push, your bet comes back.'; }
      else if (bj) { h.result = 'bj'; payout = h.bet + h.bet * 1.5; h.text = 'Blackjack! An Ace plus a 10-value card on the first two cards pays 3 to 2.'; }
      else if (dBJ) { h.result = 'lose'; h.text = `Dealer has Blackjack (${E.RANK_NAME[B.dealer[0].r]} + ${E.RANK_NAME[B.dealer[1].r]}), which beats everything except another Blackjack.`; }
      else if (v > 21) { h.result = 'lose'; h.text = `Bust: your ${v} is over 21, so you lose no matter what the dealer gets.`; }
      else if (dv > 21) { h.result = 'win'; payout = h.bet * 2; h.text = `Dealer busts with ${dv} (over 21). Your ${v} wins.`; }
      else if (v > dv) { h.result = 'win'; payout = h.bet * 2; h.text = `Your ${v} is closer to 21 than the dealer's ${dv}.`; }
      else if (v < dv) { h.result = 'lose'; h.text = `Dealer's ${dv} is closer to 21 than your ${v}.`; }
      else { h.result = 'push'; payout = h.bet; h.text = `You both have ${v}: push, your bet comes back.`; }
      if (bj && !dBJ && h.fromSplit) h.text += ' (21 after a split counts as 21, not Blackjack.)';
      if (!bj && h.fromSplit && v === 21 && h.cards.length === 2 && h.result === 'win') h.text += ' 21 after a split pays 1 to 1, not 3 to 2.';
      h.net = payout - h.bet;
      totalNet += h.net;
      B.bank += payout;
    }
    B.phase = 'done';
    B.holeHidden = false;
    B.totalNet = totalNet;
    setMsg(totalNet > 0 ? `You win ${fmt(totalNet)}!` : totalNet < 0 ? `You lose ${fmt(-totalNet)}` : 'Push: no money changes hands');
    save();
    render();
  }

  async function nextRound() {
    if (B.phase !== 'done') return;
    if (B.pendingLeave) {
      const cb = B.pendingLeave;
      B.pendingLeave = null;
      toBetting();
      cb();
      return;
    }
    if (B.bank < MIN_BET) {
      await window.App.notice('💸', 'Out of chips!', 'You ran out of chips, so blackjack starts over with $1,000.');
      B.bank = START;
      B.lastBet = 50;
      save();
    }
    toBetting();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function setMsg(t) { B.msg = t; const el = $('#bjMsg'); if (el) el.textContent = t; }

  function anim(key, cls) {
    if (B.seen.has(key)) return '';
    B.seen.add(key);
    return ' ' + cls;
  }

  function totalLabel(cards) {
    const v = value(cards);
    if (v.total > 21) return `Bust ${v.total}`;
    if (isBJ(cards)) return 'Blackjack';
    return v.soft && v.total < 21 ? `Soft ${v.total}` : String(v.total);
  }

  function render() {
    const card = window.CardUI.cardHTML;
    // Dealer
    $('#bjDealerCards').innerHTML = B.dealer.map((c, i) => (i === 1 && B.holeHidden)
      ? card(null, anim('dh' + c.id, 'deal'))
      : card(c, anim('d' + c.id, i === 1 ? 'flip' : 'deal'))).join('');
    const dt = $('#bjDealerTotal');
    if (!B.dealer.length) dt.textContent = '';
    else if (B.holeHidden) dt.textContent = `${cardVal(B.dealer[0])} + ?`;
    else dt.textContent = totalLabel(B.dealer);
    dt.className = 'bj-total' + (B.dealer.length && !B.holeHidden && value(B.dealer).total > 21 ? ' bust' : '');

    // Player hands
    const n = B.hands.length;
    const handsEl = $('#bjHands');
    handsEl.className = 'bj-hands n' + Math.max(1, n);
    if (!n) {
      handsEl.innerHTML = B.bet > 0
        ? `<div class="bj-spot"><div class="bj-chip big">${fmt(B.bet)}</div></div>`
        : '<div class="bj-spot empty">Tap chips below to bet</div>';
    } else {
      handsEl.innerHTML = B.hands.map((h, i) => {
        const res = h.result ? resultBadge(h) : '';
        return `<div class="bj-hand${i === B.active && B.phase === 'playing' ? ' active' : ''}${h.result ? ' r-' + h.result : ''}">
          ${res}
          <div class="bj-cards stack">${h.cards.map((c) => card(c, anim('p' + c.id, 'deal'))).join('')}</div>
          <div class="bj-meta"><span class="bj-total${value(h.cards).total > 21 ? ' bust' : ''}">${h.cards.length ? totalLabel(h.cards) : ''}</span>
          <span class="bj-chip">${fmt(h.bet)}${h.doubled ? ' ×2' : ''}</span></div>
        </div>`;
      }).join('');
    }

    // Shoe & bankroll
    $('#bjShoe').textContent = B.shoe.length ? `Shoe: ${B.shoe.length} cards` : 'New shoe';
    $('#bjBank').textContent = fmt(B.bank);
    $('#bjBetAmt').textContent = fmt(B.phase === 'betting' ? B.bet : B.hands.reduce((s, h) => s + h.bet, 0));

    // Controls
    $('#bjBetUI').hidden = B.phase !== 'betting';
    $('#bjPlayUI').hidden = !(B.phase === 'playing' || B.phase === 'dealing' || B.phase === 'dealer');
    $('#bjDoneUI').hidden = B.phase !== 'done';
    const h = B.hands[B.active];
    const playing = B.phase === 'playing' && !B.acting;
    $('#bjHit').disabled = !playing;
    $('#bjStand').disabled = !playing;
    $('#bjDouble').disabled = !playing || !canDouble(h);
    $('#bjSplit').disabled = !playing || !canSplit(h);
    $('#bjDeal').disabled = B.bet < MIN_BET;
    $('#bjDeal').textContent = B.bet >= MIN_BET ? `Deal (${fmt(B.bet)})` : `Min bet ${fmt(MIN_BET)}`;
    document.querySelectorAll('.bj-chipbtn').forEach((b) => { b.disabled = B.bet + +b.dataset.v > B.bank; });

    if (B.phase === 'done') {
      const dealerLine = isBJ(B.dealer) ? 'Dealer: Blackjack' : `Dealer: ${value(B.dealer).total > 21 ? 'bust with ' + value(B.dealer).total : value(B.dealer).total}`;
      $('#bjSummary').innerHTML = `<div class="bj-sum-head">${dealerLine}</div>` + B.hands.map((x, i) => `
        <div class="bj-sum-row r-${x.result}">
          <span class="badge ${badgeCls(x)}">${badgeText(x)}</span>
          <span class="bj-sum-txt">${B.hands.length > 1 ? `<b>Hand ${i + 1}:</b> ` : ''}${x.text}</span>
        </div>`).join('');
      $('#bjNext').textContent = B.pendingLeave ? 'Continue' : 'Next round';
    }
  }

  const badgeCls = (h) => ({ win: 'win', bj: 'split', push: 'fold', lose: 'lose' }[h.result]);
  function badgeText(h) {
    if (h.result === 'push') return 'PUSH';
    if (h.result === 'bj') return `BLACKJACK +${fmt(h.net)}`;
    if (h.result === 'win') return `WIN +${fmt(h.net)}`;
    return `LOSE −${fmt(-h.net)}`;
  }
  function resultBadge(h) {
    return `<div class="bj-res badge ${badgeCls(h)}">${badgeText(h)}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Public API (used by the app shell in game.js)
  // ---------------------------------------------------------------------------
  function wire() {
    document.querySelectorAll('.bj-chipbtn').forEach((b) => b.addEventListener('click', () => {
      if (B.phase !== 'betting') return;
      const v = +b.dataset.v;
      if (B.bet + v <= B.bank) { B.bet += v; render(); }
    }));
    $('#bjClear').addEventListener('click', () => { if (B.phase === 'betting') { B.bet = 0; render(); } });
    $('#bjDeal').addEventListener('click', deal);
    $('#bjHit').addEventListener('click', () => act('hit'));
    $('#bjStand').addEventListener('click', () => act('stand'));
    $('#bjDouble').addEventListener('click', () => act('double'));
    $('#bjSplit').addEventListener('click', () => act('split'));
    $('#bjNext').addEventListener('click', nextRound);
  }

  const BJ = {
    init() { wire(); const s = load(); if (s) { B.bank = s.bank; B.lastBet = s.lastBet || 50; } },
    /** Start or resume. fresh = new game with $1,000. */
    enter(fresh) {
      if (fresh) { B.bank = START; B.lastBet = 50; save(); }
      if (!B.shoe.length) newShoe();
      if (B.bank < MIN_BET) { B.bank = START; save(); }
      if (B.phase === 'betting' || B.phase === 'done' || !B.hands.length) toBetting();
      else render();
    },
    /** Run cb once no round is in progress (immediately if idle). */
    leave(cb) {
      if (B.phase === 'betting') { cb(); return true; }
      B.pendingLeave = cb;
      if (B.phase === 'done') render();
      return false;
    },
    restart() {
      if (B.phase !== 'betting' && B.phase !== 'done') { setMsg('Finish this round first, then restart'); return; }
      B.bank = START; B.lastBet = 50; newShoe(); save(); toBetting();
    },
    get bank() { return B.bank; },
    savedBank() { const s = load(); return s ? s.bank : null; },
    // exposed for tests
    _value: value, _isBJ: isBJ,
  };
  window.BJ = BJ;
})();
