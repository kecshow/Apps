/* Blue Felt Poker: game flow + UI */
(function () {
  'use strict';
  const E = window.Engine;
  const AI = window.AI;

  const SB = 10, BB = 20, START = 1000;
  const SAVE_KEY = 'bluefelt-poker-v1';
  const ABORT = { abort: true };
  const VS = '︎'; // force text (not emoji) style suit glyphs on iOS

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n) => '$' + n.toLocaleString('en-US');

  const G = {
    mode: 'holdem', pendingMode: null, players: [], dealer: -1, deck: [], board: [],
    street: '', currentBet: 0, minRaise: BB, turn: -1, speed: 1, handNo: 0,
    revealed: false, seen: new Set(), drawSel: new Set(), gen: 0,
    humanDone: null, drawDone: null, nextDone: null, noticeDone: null,
    humanUI: null, lastResult: null,
    app: 'poker', pendingApp: null, pokerOn: false,
  };
  const LAST_KEY = 'bluefelt-last-game';
  const SPEED_KEY = 'bluefelt-speed';

  // ---------------------------------------------------------------------------
  // Abortable waiting (so "Restart" can cancel a hand in progress)
  // ---------------------------------------------------------------------------
  let pendings = [];
  function waitFor(setup) {
    const g = G.gen;
    return new Promise((res, rej) => {
      const entry = { rej };
      pendings.push(entry);
      setup((v) => {
        pendings = pendings.filter((e) => e !== entry);
        if (g !== G.gen) rej(ABORT); else res(v);
      });
    });
  }
  const sleep = (ms) => waitFor((done) => setTimeout(done, ms * G.speed));
  function abortAll() {
    G.gen++;
    const ps = pendings;
    pendings = [];
    ps.forEach((e) => e.rej(ABORT));
    G.humanDone = G.drawDone = G.nextDone = G.noticeDone = null;
  }

  // ---------------------------------------------------------------------------
  // Players & persistence
  // ---------------------------------------------------------------------------
  /** Three random opponents from the pool, each with a random playing style. `saved` restores a previous seating. */
  function makePlayers(saved) {
    const opps = saved || window.Names.pick(3, E.randomInt);
    const styles = E.shuffle(AI.PROFILES.slice());
    const list = [{ id: 0, name: 'You', avatar: '😎', isHuman: true }].concat(
      opps.map((o, i) => ({ id: i + 1, name: o.name, avatar: o.flag, tag: o.tag, prof: styles[i] }))
    );
    return list.map((p) => Object.assign(p, {
      chips: START, out: false, hand: [], folded: false, allIn: false, bet: 0, contributed: 0,
      lastAction: '', foldedAt: null, best: null, won: 0,
    }));
  }
  const opponentsOf = (players) => players.slice(1).map((p) => ({ name: p.name, flag: p.avatar, tag: p.tag }));

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        mode: G.pendingMode || G.mode, dealer: G.dealer, speed: G.speed,
        chips: G.players.map((p) => p.chips), out: G.players.map((p) => p.out),
        opponents: opponentsOf(G.players),
      }));
    } catch (e) { /* private mode etc. */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
  }

  const live = () => G.players.filter((p) => !p.out);
  const contenders = () => G.players.filter((p) => !p.out && !p.folded);
  function nextSeat(i) {
    for (let k = 1; k <= 4; k++) {
      const j = (i + k + 4) % 4;
      if (!G.players[j].out) return j;
    }
    return i;
  }
  const potTotal = () => G.players.reduce((s, p) => s + p.contributed, 0);

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------
  function startGame(mode, saved) {
    abortAll();
    G.app = 'poker';
    G.pokerOn = true;
    G.pendingApp = null;
    setLast(mode);
    showTable();
    G.mode = mode;
    G.pendingMode = null;
    G.players = makePlayers(saved && saved.opponents);
    G.dealer = E.randomInt(4);
    G.handNo = 0;
    if (saved && saved.chips) {
      G.players.forEach((p, i) => { p.chips = saved.chips[i]; p.out = !!saved.out[i] || (!p.isHuman && p.chips <= 0); });
      G.dealer = saved.dealer >= 0 ? saved.dealer : G.dealer;
    }
    $$('.overlay').forEach((o) => o.classList.remove('show'));
    updateFelt();
    render();
    save();
    gameLoop();
  }

  async function gameLoop() {
    try {
      for (;;) {
        if (G.pendingApp === 'blackjack') { enterBlackjack(false); return; }
        await playHand();
        await afterHand();
      }
    } catch (e) {
      if (e !== ABORT) { console.error(e); setMsg('Something went wrong: ' + e.message); }
    }
  }

  /** New game: everyone back to $1,000 and three new random opponents sit down. */
  function resetChips() {
    G.players = makePlayers();
    G.dealer = E.randomInt(4);
    G.handNo = 0;
  }

  async function playHand() {
    if (G.pendingMode) { G.mode = G.pendingMode; G.pendingMode = null; }
    updateFelt();
    G.handNo++;
    G.seen.clear();
    G.drawSel.clear();
    G.board = [];
    G.revealed = false;
    G.lastResult = null;
    for (const p of G.players) {
      Object.assign(p, { hand: [], folded: p.out, allIn: false, bet: 0, contributed: 0, lastAction: '', foldedAt: null, best: null, won: 0 });
    }

    G.dealer = nextSeat(G.dealer);
    const players = live();
    let sbI, bbI;
    if (players.length === 2) { sbI = G.dealer; bbI = nextSeat(sbI); }
    else { sbI = nextSeat(G.dealer); bbI = nextSeat(sbI); }

    // Fresh 52-card deck, fair shuffle, every hand.
    G.deck = E.shuffle(E.newDeck());
    G.street = G.mode === 'holdem' ? 'preflop' : 'before the draw';
    G.currentBet = BB;
    G.minRaise = BB;
    postBlind(G.players[sbI], SB, 'SB');
    postBlind(G.players[bbI], BB, 'BB');

    setMsg(`Hand #${G.handNo} · ${G.mode === 'holdem' ? "Texas Hold'em" : 'Five Card Draw'}`);
    render();
    await sleep(450);

    const n = G.mode === 'holdem' ? 2 : 5;
    for (let k = 0; k < n; k++) {
      let i = G.dealer;
      for (let c = 0; c < players.length; c++) {
        i = nextSeat(i);
        G.players[i].hand.push(G.deck.pop());
        render();
        await sleep(110);
      }
    }
    if (G.mode === 'draw') sortHand(G.players[0]);
    render();
    await sleep(300);

    if (G.mode === 'holdem') {
      await bettingRound(nextSeat(bbI));
      const streets = [['flop', 3], ['turn', 1], ['river', 1]];
      for (const [st, cnt] of streets) {
        if (contenders().length < 2) break;
        newStreet(st);
        render();
        await sleep(500);
        G.deck.pop(); // burn card, like a real dealer
        for (let c = 0; c < cnt; c++) G.board.push(G.deck.pop());
        setMsg(st === 'flop' ? 'The flop' : st === 'turn' ? 'The turn' : 'The river');
        render();
        await sleep(650);
        await bettingRound(nextSeat(G.dealer));
      }
    } else {
      await bettingRound(nextSeat(bbI));
      if (contenders().length > 1) {
        await drawPhase();
        newStreet('after the draw');
        render();
        await bettingRound(nextSeat(G.dealer));
      }
    }
    await finishHand();
  }

  function postBlind(p, amt, label) {
    const put = Math.min(amt, p.chips);
    putChips(p, put);
    p.lastAction = `${label} ${fmt(put)}`;
  }

  function putChips(p, amt) {
    p.chips -= amt;
    p.bet += amt;
    p.contributed += amt;
    if (p.chips === 0) p.allIn = true;
  }

  function newStreet(st) {
    G.street = st;
    G.currentBet = 0;
    G.minRaise = BB;
    for (const p of G.players) {
      p.bet = 0;
      if (!p.folded && !p.allIn) p.lastAction = '';
    }
  }

  function sortHand(p) {
    p.hand.sort((a, b) => b.r - a.r || a.s - b.s);
  }

  async function bettingRound(start) {
    if (contenders().length < 2) return;
    const canAct = G.players.filter((p) => !p.folded && !p.allIn);
    if (canAct.length === 0) return;
    if (canAct.length === 1 && canAct[0].bet >= G.currentBet) return;

    const need = new Set(canAct.map((p) => p.id));
    let i = start;
    while (need.size > 0 && contenders().length > 1) {
      const p = G.players[i];
      if (need.has(p.id)) {
        need.delete(p.id);
        if (!p.folded && !p.allIn) {
          G.turn = i;
          render();
          const a = p.isHuman ? await humanAction(p) : await aiAction(p);
          const prev = G.currentBet;
          applyAction(p, a);
          if (G.currentBet > prev) {
            for (const q of G.players) if (q !== p && !q.folded && !q.allIn) need.add(q.id);
          }
          G.turn = -1;
          render();
          await sleep(280);
        }
      }
      i = (i + 1) % 4;
    }
  }

  function applyAction(p, a) {
    const toCall = G.currentBet - p.bet;
    if (a.type === 'fold') {
      p.folded = true;
      p.foldedAt = G.street;
      p.lastAction = 'Fold';
      setMsg(`${p.name} ${p.isHuman ? 'fold' : 'folds'}`);
      return;
    }
    if (a.type === 'check' && toCall <= 0) {
      p.lastAction = 'Check';
      setMsg(`${p.name} ${p.isHuman ? 'check' : 'checks'}`);
      return;
    }
    let to = a.type === 'raise' ? Math.min(a.to, p.bet + p.chips) : 0;
    if (a.type !== 'raise' || to <= G.currentBet) {
      const amt = Math.min(toCall, p.chips);
      putChips(p, amt);
      p.lastAction = p.allIn ? 'All-in' : `Call ${fmt(amt)}`;
      setMsg(`${p.name} ${p.isHuman ? 'call' : 'calls'} ${fmt(amt)}${p.allIn ? ' (all-in)' : ''}`);
      return;
    }
    const wasBet = G.currentBet === 0;
    const raiseBy = to - G.currentBet;
    if (raiseBy >= G.minRaise) G.minRaise = raiseBy;
    putChips(p, to - p.bet);
    G.currentBet = to;
    const verb = wasBet ? (p.isHuman ? 'bet' : 'bets') : (p.isHuman ? 'raise to' : 'raises to');
    p.lastAction = p.allIn ? 'All-in' : `${wasBet ? 'Bet' : 'Raise'} ${fmt(to)}`;
    setMsg(`${p.name} ${verb} ${fmt(to)}${p.allIn ? ' (all-in)' : ''}`);
  }

  async function aiAction(p) {
    setMsg(`${p.name} is thinking…`);
    await sleep(550 + Math.random() * 600);
    const view = {
      mode: G.mode, hand: p.hand, board: G.board, street: G.street,
      pot: potTotal(), toCall: G.currentBet - p.bet, currentBet: G.currentBet,
      minRaise: G.minRaise, bet: p.bet, chips: p.chips, numOpp: contenders().length - 1, bb: BB,
    };
    return AI.decide(view, p.prof);
  }

  function humanAction(p) {
    setMsg('Your turn');
    setupBetUI(p);
    return waitFor((done) => { G.humanDone = done; }).then((a) => {
      G.humanUI = null;
      $('#actions').classList.add('off');
      return a;
    });
  }

  function resolveHuman(a) {
    if (!G.humanDone) return;
    const d = G.humanDone;
    G.humanDone = null;
    d(a);
  }

  // ---------------------------------------------------------------------------
  // Five card draw: the draw
  // ---------------------------------------------------------------------------
  async function drawPhase() {
    newStreet('draw');
    G.street = 'draw';
    setMsg('The draw: swap up to 3 cards');
    render();
    await sleep(400);
    for (let k = 1; k <= 4; k++) {
      const i = (G.dealer + k) % 4;
      const p = G.players[i];
      if (p.out || p.folded) continue;
      G.turn = i;
      render();
      let idxs;
      if (p.isHuman) {
        setMsg('Tap the cards you want to swap');
        G.drawSel.clear();
        renderDrawUI();
        idxs = await waitFor((done) => { G.drawDone = done; });
        $('#drawRow').hidden = true;
        $('#btnRow').hidden = false;
      } else {
        setMsg(`${p.name} is choosing cards…`);
        await sleep(700 + Math.random() * 400);
        idxs = AI.chooseDiscards(p.hand);
      }
      for (const ix of idxs) p.hand[ix] = G.deck.pop();
      p.lastAction = idxs.length ? `Drew ${idxs.length}` : 'Stands pat';
      setMsg(`${p.name} ${p.isHuman ? (idxs.length ? 'draw ' + idxs.length : 'stand pat') : (idxs.length ? 'draws ' + idxs.length : 'stands pat')}`);
      if (p.isHuman) { sortHand(p); G.drawSel.clear(); }
      G.turn = -1;
      render();
      await sleep(450);
    }
  }

  function drawValid() {
    const me = G.players[0];
    const n = G.drawSel.size;
    if (n <= 3) return true;
    if (n === 4) {
      const kept = me.hand.find((_, i) => !G.drawSel.has(i));
      return kept && kept.r === 14;
    }
    return false;
  }

  function renderDrawUI() {
    const btn = $('#btnDraw');
    const n = G.drawSel.size;
    $('#actions').classList.add('off');
    $('#btnRow').hidden = true;
    $('#drawRow').hidden = false;
    if (!drawValid()) {
      btn.disabled = true;
      btn.textContent = 'Max 3 cards (4 if you keep an Ace)';
    } else {
      btn.disabled = false;
      btn.textContent = n === 0 ? 'Stand pat (keep all 5)' : `Swap ${n} card${n > 1 ? 's' : ''}`;
    }
  }

  // ---------------------------------------------------------------------------
  // End of hand: pots, winners, explanation
  // ---------------------------------------------------------------------------
  function buildPots() {
    const levels = [...new Set(contenders().map((p) => p.contributed))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      for (const p of G.players) amount += Math.max(0, Math.min(p.contributed, L) - prev);
      const eligible = contenders().filter((p) => p.contributed >= L);
      if (amount > 0) pots.push({ amount, eligible });
      prev = L;
    }
    const counted = pots.reduce((s, p) => s + p.amount, 0);
    const extra = potTotal() - counted;
    if (extra > 0 && pots.length) pots[pots.length - 1].amount += extra;
    return pots;
  }

  function orderFromDealer(list) {
    const ids = new Set(list.map((p) => p.id));
    const out = [];
    for (let k = 1; k <= 4; k++) {
      const p = G.players[(G.dealer + k) % 4];
      if (ids.has(p.id)) out.push(p);
    }
    return out;
  }

  async function finishHand() {
    G.turn = -1;
    const cont = contenders();
    const showdown = cont.length > 1;
    if (showdown) {
      G.street = 'showdown';
      for (const p of cont) p.best = E.bestHand(G.mode === 'holdem' ? p.hand.concat(G.board) : p.hand);
      G.revealed = true;
      setMsg('Showdown!');
      render();
      await sleep(1500);
    }
    const pots = buildPots();
    for (const pot of pots) {
      let winners;
      if (pot.eligible.length === 1) winners = pot.eligible;
      else {
        const top = Math.max(...pot.eligible.map((p) => p.best.score));
        winners = pot.eligible.filter((p) => p.best.score === top);
      }
      pot.winners = winners;
      const ordered = orderFromDealer(winners);
      const share = Math.floor(pot.amount / ordered.length);
      let rem = pot.amount - share * ordered.length;
      for (const w of ordered) { w.won += share + (rem > 0 ? 1 : 0); rem--; }
    }
    for (const p of G.players) {
      if (p.won > 0) { p.chips += p.won; p.lastAction = 'Winner'; }
      p.bet = 0;
    }
    G.lastResult = { pots, showdown, pot: potTotal() };
    render();
    if (!showdown) {
      setMsg(`${cont[0].name} ${cont[0].isHuman ? 'win' : 'wins'} ${fmt(cont[0].won)}`);
      await sleep(700);
    }
    save();
    showResult(G.lastResult);
  }

  async function afterHand() {
    await waitFor((done) => { G.nextDone = done; });
    $('#result').classList.remove('show');
    const me = G.players[0];
    if (me.chips <= 0) {
      await notice('💸', 'Out of chips!', 'You ran out of chips, so the game starts over: everyone is back to $1,000 and 3 new opponents sit down.');
      resetChips();
    } else {
      const busted = G.players.filter((p) => !p.isHuman && !p.out && p.chips <= 0);
      busted.forEach((p) => { p.out = true; });
      if (G.players.every((p) => p.isHuman || p.out)) {
        await notice('🏆', 'You cleaned out the table!', 'All 3 opponents are broke. A new game starts with 3 new opponents, everyone back to $1,000.');
        resetChips();
      } else if (busted.length) {
        const names = busted.map((p) => p.name).join(' and ');
        await notice('👋', `${names} busted`, `${names} ran out of chips and left the table. Keep going!`);
      }
    }
    for (const p of G.players) { p.lastAction = ''; p.hand = []; p.folded = p.out; p.contributed = 0; p.bet = 0; }
    G.board = [];
    render();
    save();
  }

  function notice(icon, title, text) {
    $('#noticeIcon').textContent = icon;
    $('#noticeTitle').textContent = title;
    $('#noticeText').textContent = text;
    $('#notice').classList.add('show');
    return waitFor((done) => { G.noticeDone = done; }).then(() => $('#notice').classList.remove('show'));
  }

  const FOLD_TEXT = {
    preflop: 'before the flop', flop: 'on the flop', turn: 'on the turn', river: 'on the river',
    'before the draw': 'before the draw', draw: 'during the draw', 'after the draw': 'after the draw',
  };

  /** Cards that actually form the combination (pair cards, trips, …). The rest are kickers. */
  function coreCards(h) {
    const by = (r) => h.cards.filter((c) => c.r === r);
    switch (h.cat) {
      case 7: case 3: case 1: return by(h.tb[0]);
      case 2: return by(h.tb[0]).concat(by(h.tb[1]));
      case 0: return [h.cards[0]];
      default: return h.cards.slice();
    }
  }

  function showResult(res) {
    const { pots, showdown } = res;
    const main = pots[0];
    const mainWinners = main.winners;
    const W = mainWinners[0];
    const total = res.pot;
    let html = '';

    // ----- Header
    if (!showdown) {
      html += `<div class="r-head"><div class="r-trophy">${W.isHuman ? '🎉' : '🏆'}</div>
        <div class="r-title">${W.isHuman ? 'You win' : W.name + ' wins'} ${fmt(total)}</div>
        <div class="r-sub">Everyone else folded, so no cards had to be shown.</div></div>`;
    } else if (mainWinners.length > 1) {
      html += `<div class="r-head"><div class="r-trophy">🤝</div>
        <div class="r-title">Split pot!</div>
        <div class="r-sub">${mainWinners.map((p) => p.name).join(' & ')} tie with <b>${W.best.name}</b></div></div>`;
    } else {
      html += `<div class="r-head"><div class="r-trophy">${W.isHuman ? '🎉' : '🏆'}</div>
        <div class="r-title">${W.isHuman ? 'You win' : W.name + ' wins'} ${fmt(W.won)}</div>
        <div class="r-sub">with <b>${W.best.name}</b></div></div>`;
    }

    // ----- Board (Hold'em)
    if (G.mode === 'holdem' && G.board.length) {
      const used = showdown ? new Set(W.best.cards.map((c) => c.id)) : new Set();
      html += `<div class="r-board"><div class="lbl">BOARD (SHARED CARDS)</div><div class="cards">${
        G.board.map((c) => cardHTML(c, showdown ? (used.has(c.id) ? 'hl' : 'dim') : '')).join('')}</div></div>`;
    }

    // ----- Player rows
    const rows = G.players.filter((p) => !p.out || p.contributed > 0);
    const rank = (p) => (p.won > 0 && mainWinners.includes(p) ? 0 : p.won > 0 ? 1 : !p.folded ? 2 : 3);
    rows.sort((a, b) => rank(a) - rank(b) || (b.best ? b.best.score : 0) - (a.best ? a.best.score : 0));

    for (const p of rows) {
      const isMainWin = mainWinners.includes(p);
      const split = isMainWin && mainWinners.length > 1;
      let badge, rowCls = '', cards = '', handName = '', why = '';
      const sidePotTxt = !isMainWin && p.won > 0 ? ` Still won a side pot of <b>${fmt(p.won)}</b>.` : '';

      if (p.folded) {
        badge = '<span class="badge fold">FOLDED</span>';
        why = `Folded ${FOLD_TEXT[p.foldedAt] || ''}, so ${p.isHuman ? 'you' : 'they'} gave up any claim to the pot.`;
        if (p.isHuman && p.hand.length) {
          cards = `<div class="r-cards"><div class="grp"><div class="lbl">YOUR CARDS</div><div class="cards">${p.hand.map((c) => cardHTML(c, 'dim')).join('')}</div></div></div>`;
        }
      } else if (!showdown) {
        badge = '<span class="badge win">WIN</span>';
        rowCls = 'win';
        why = `Last player left in the hand. ${p.isHuman ? 'You' : p.name} won without showing.`;
        if (p.isHuman) cards = `<div class="r-cards"><div class="grp"><div class="lbl">YOUR CARDS</div><div class="cards">${p.hand.map((c) => cardHTML(c)).join('')}</div></div></div>`;
      } else {
        const h = p.best;
        handName = h.name;
        const core = new Set(coreCards(h).map((c) => c.id));
        let loseRank = null;
        if (split) {
          badge = '<span class="badge split">SPLIT</span>'; rowCls = 'split';
          const others = mainWinners.filter((q) => q !== p).map((q) => q.name).join(' & ');
          why = `Tied with ${others}: exactly the same hand strength, so the pot is split.`;
        } else if (isMainWin) {
          badge = '<span class="badge win">WIN</span>'; rowCls = 'win';
          const beaten = contenders().filter((q) => q !== p);
          const list = beaten.map((q) => `${q.isHuman ? 'you' : q.name} (${q.best.name})`);
          const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0];
          why = `Best hand at the table. <b>${h.name}</b> beats ${joined}.`;
        } else {
          const ex = E.explainLoss(W.best, h);
          loseRank = ex.lRank;
          badge = p.won > 0 ? '<span class="badge split">SIDE POT</span>' : '<span class="badge lose">LOST</span>';
          if (p.won > 0) rowCls = 'split';
          why = `<b>Lost to ${W.isHuman ? 'you' : W.name}.</b> ${ex.text}${sidePotTxt}`;
        }
        const deciderMark = (c) => (loseRank && c.r === loseRank && !core.has(c.id) ? ' decider lose' : '');
        const deciderMarkAny = (c) => (loseRank && c.r === loseRank ? ' decider lose' : '');
        if (G.mode === 'holdem') {
          const holeIds = new Set(p.hand.map((c) => c.id));
          cards = `<div class="r-cards">
            <div class="grp"><div class="lbl">${p.isHuman ? 'YOUR CARDS' : 'CARDS'}</div><div class="cards">${p.hand.map((c) => cardHTML(c)).join('')}</div></div>
            <div class="grp"><div class="lbl">BEST 5</div><div class="cards">${h.cards.map((c) =>
              cardHTML(c, (core.has(c.id) ? 'hl' : '') + (holeIds.has(c.id) ? ' hole' : '') + (core.has(c.id) ? deciderMarkAny(c) : deciderMark(c)))).join('')}</div></div>
          </div>`;
        } else {
          cards = `<div class="r-cards"><div class="grp"><div class="cards">${h.cards.map((c) =>
            cardHTML(c, (core.has(c.id) ? 'hl' : '') + (core.has(c.id) ? deciderMarkAny(c) : deciderMark(c)))).join('')}</div></div></div>`;
        }
      }
      const delta = p.won - p.contributed;
      const deltaTxt = p.contributed || p.won ? `<small>${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta))} this hand · ${fmt(p.chips)} total</small>` : `<small>${fmt(p.chips)} total</small>`;
      html += `<div class="r-row ${rowCls}">
        <div class="r-top"><span class="av">${p.avatar}</span><span class="who">${p.name}${deltaTxt}</span>${badge}</div>
        ${cards}
        ${handName ? `<div class="r-hand">${handName}</div>` : ''}
        <div class="r-why">${why}</div>
      </div>`;
    }

    if (pots.filter((pt) => pt.eligible.length > 1).length > 1) {
      html += `<div class="r-legend">There were side pots because someone was all-in. Each player can only win from each opponent as much as they put in themselves.</div>`;
    }
    if (showdown) {
      html += `<div class="r-legend"><i style="background:var(--gold)"></i>makes the hand${
        G.mode === 'holdem' ? '<i style="background:#7fd0ff"></i>own (hole) card' : ''}<i style="background:var(--red)"></i>card that lost the tie-break</div>`;
    }

    $('#resultBody').innerHTML = html;
    $('#result').classList.add('show');
    $('#result .sheet').scrollTop = 0;
  }

  // ---------------------------------------------------------------------------
  // Betting UI
  // ---------------------------------------------------------------------------
  function setupBetUI(p) {
    const toCall = G.currentBet - p.bet;
    const maxTo = p.bet + p.chips;
    const othersCanAct = G.players.some((q) => q !== p && !q.folded && !q.allIn);
    const canRaise = maxTo > G.currentBet && othersCanAct;
    const minTo = Math.min(maxTo, G.currentBet + G.minRaise);
    G.humanUI = { toCall, maxTo, minTo, canRaise, value: minTo };

    const callBtn = $('#btnCall');
    if (toCall <= 0) callBtn.textContent = 'Check';
    else if (toCall >= p.chips) callBtn.textContent = `All-in ${fmt(p.chips)}`;
    else callBtn.textContent = `Call ${fmt(toCall)}`;

    $('#btnRaise').disabled = !canRaise;
    $('#raiseSlider').disabled = !canRaise || minTo >= maxTo;
    $$('.preset').forEach((b) => { b.disabled = !canRaise; });
    $('#raiseSlider').value = 0;
    updateRaiseLabel();
    $('#btnRow').hidden = false;
    $('#drawRow').hidden = true;
    $('#actions').classList.remove('off');
  }

  function setRaiseValue(v) {
    const u = G.humanUI;
    if (!u) return;
    let val = Math.round(v / 10) * 10;
    if (v >= u.maxTo) val = u.maxTo;
    val = Math.max(u.minTo, Math.min(u.maxTo, val));
    u.value = val;
    const span = u.maxTo - u.minTo;
    $('#raiseSlider').value = span > 0 ? Math.round(((val - u.minTo) / span) * 100) : 100;
    updateRaiseLabel();
  }

  function updateRaiseLabel() {
    const u = G.humanUI;
    if (!u) return;
    const btn = $('#btnRaise');
    if (!u.canRaise) { btn.textContent = 'Raise'; return; }
    if (u.value >= u.maxTo) btn.textContent = `All-in ${fmt(u.maxTo)}`;
    else btn.textContent = `${G.currentBet === 0 ? 'Bet' : 'Raise to'} ${fmt(u.value)}`;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function cardHTML(c, cls) {
    cls = cls || '';
    if (!c) return `<div class="card back ${cls}"></div>`;
    const red = c.s === 1 || c.s === 2;
    const R = E.RANK_LABEL[c.r];
    const S = E.SUITS[c.s] + VS;
    return `<div class="card ${red ? 'red' : ''} ${cls}" data-id="${c.id}"><div class="tl"><span>${R}</span><span class="s">${S}</span></div><div class="mid">${S}</div><div class="br"><span>${R}</span><span class="s">${S}</span></div></div>`;
  }

  /** Adds a one-time animation class the first time a given card appears in a given spot. */
  function anim(key, cls) {
    if (G.seen.has(key)) return '';
    G.seen.add(key);
    return ' ' + cls;
  }

  function statusHTML(p) {
    if (!p.lastAction) return '';
    const a = p.lastAction;
    let cls = '';
    if (a === 'Fold') cls = 'fold';
    else if (a === 'All-in') cls = 'allin';
    else if (a.startsWith('Raise') || a.startsWith('Bet')) cls = 'raise';
    else if (a === 'Winner') cls = 'win';
    return `<div class="status ${cls}">${a}</div>`;
  }

  function render() {
    const n = G.players.length;
    for (let i = 0; i < n; i++) {
      const p = G.players[i];
      const el = $('#seat-' + i);
      el.className = 'seat' + (p.out ? ' out' : '') + (p.folded && !p.out ? ' folded' : '') + (G.turn === i ? ' turn' : '');
      let cards = '';
      if (!p.isHuman && !p.out && !p.folded && p.hand.length) {
        const showFaces = G.revealed;
        cards = p.hand.map((c) => showFaces
          ? cardHTML(c, 'small-face' + anim('r' + c.id, 'flip'))
          : cardHTML(null, anim(p.id + '-' + c.id, 'deal'))).join('');
      }
      el.innerHTML = `
        <div class="avatar">${p.avatar}${G.dealer === i ? '<div class="dealer-btn">D</div>' : ''}${p.out ? '<div class="status fold">Busted</div>' : statusHTML(p)}</div>
        <div class="plate"><div class="nm">${p.name}</div><div class="ch">${fmt(p.chips)}</div></div>
        <div class="seat-cards">${cards}</div>`;

      const bet = $('#bet-' + i);
      if (p.bet > 0) {
        bet.innerHTML = `<span class="chip-ico"></span>${fmt(p.bet)}`;
        bet.classList.add('show');
      } else {
        bet.classList.remove('show');
      }
    }

    // Pot & board
    const pot = potTotal();
    $('#potAmt').textContent = 'Pot ' + fmt(pot);
    $('#pot').classList.toggle('empty', pot === 0);
    const board = $('#board');
    if (G.mode === 'holdem') {
      let h = '';
      for (let k = 0; k < 5; k++) {
        const c = G.board[k];
        h += c ? cardHTML(c, anim('b' + c.id, 'flip')) : '<div class="slot"></div>';
      }
      board.innerHTML = h;
    } else {
      board.innerHTML = '';
    }

    // My cards
    const me = G.players[0];
    const my = $('#myCards');
    my.classList.toggle('two', G.mode === 'holdem');
    const drawing = G.street === 'draw' && G.turn === 0;
    my.innerHTML = me.hand.map((c, idx) => cardHTML(c,
      (me.folded ? 'dim' : '') + (drawing && G.drawSel.has(idx) ? ' sel' : '') + anim('m' + c.id, 'deal'))).join('');
    $('#myHandName').textContent = myHandName(me);
  }

  function myHandName(me) {
    if (!me.hand.length) return '';
    if (me.out) return '';
    if (me.folded) return 'You folded';
    if (G.mode === 'draw') return me.hand.length === 5 ? E.eval5(me.hand).name : '';
    if (G.board.length >= 3) return E.bestHand(me.hand.concat(G.board)).name;
    if (me.hand.length === 2) {
      const [a, b] = me.hand;
      if (a.r === b.r) return `Pocket pair: ${E.RANK_NAME[a.r]}s`.replace('Sixs', 'Sixes');
      const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
      return `${E.RANK_NAME[hi]}-${E.RANK_NAME[lo]}${a.s === b.s ? ' suited' : ''}`;
    }
    return '';
  }

  function setMsg(t) { $('#msg').textContent = t; }

  function updateFelt() {
    $('#feltTitle').textContent = G.mode === 'holdem' ? "TEXAS HOLD'EM" : 'FIVE CARD DRAW';
    $('#feltSmall').textContent = G.mode === 'holdem'
      ? 'DEALER BURNS ONE CARD BEFORE EACH ROUND'
      : 'DRAW UP TO 3 CARDS · 4 WITH AN ACE';
  }

  // ---------------------------------------------------------------------------
  // Hands tab
  // ---------------------------------------------------------------------------
  function buildHandsTab() {
    const c = (s) => {
      const r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[s[0]] || +s[0];
      const su = { s: 0, h: 1, d: 2, c: 3 }[s[1]];
      return { r, s: su, id: s };
    };
    const list = [
      ['Royal Flush', 'A, K, Q, J, 10, all the same suit. The best possible hand.', 'As Ks Qs Js Ts', 5, '0.00015%', '0.003%'],
      ['Straight Flush', 'Five cards in a row, all the same suit.', '9h 8h 7h 6h 5h', 5, '0.0014%', '0.03%'],
      ['Four of a Kind', 'Four cards of the same rank.', 'Kc Kd Kh Ks 3d', 4, '0.024%', '0.17%'],
      ['Full House', 'Three of a kind plus a pair.', 'Qs Qh Qd 7c 7s', 5, '0.14%', '2.6%'],
      ['Flush', 'Any five cards of the same suit, not in a row.', 'Ad Jd 8d 6d 2d', 5, '0.20%', '3.0%'],
      ['Straight', 'Five cards in a row, mixed suits.', 'Tc 9d 8s 7h 6c', 5, '0.39%', '4.6%'],
      ['Three of a Kind', 'Three cards of the same rank.', '8s 8h 8d Kc 4s', 3, '2.1%', '4.8%'],
      ['Two Pair', 'Two different pairs.', 'Jh Jc 4s 4d Ah', 4, '4.8%', '23.5%'],
      ['One Pair', 'Two cards of the same rank.', 'Ts Th Kd 7c 3s', 2, '42.3%', '43.8%'],
      ['High Card', 'None of the above. Your highest card plays.', 'Ac Qd 9s 6h 3c', 1, '50.1%', '17.4%'],
    ];
    $('#handsList').innerHTML = list.map(([name, desc, cards, core, p5, p7], i) => {
      const cs = cards.split(' ').map(c);
      return `<div class="hand-item"><div class="rank">${i + 1}</div><div class="body">
        <div class="title">${name}</div><div class="desc">${desc}</div>
        <div class="ex">${cs.map((cc, k) => cardHTML(cc, k < core ? '' : 'dim')).join('')}</div>
        <div class="odds">Chance: ${p5} in Five Card Draw (before drawing) · ${p7} in Hold'em (by the river)</div>
      </div></div>`;
    }).join('');
  }

  /** Blackjack card values + worked examples on the Rules tab. */
  function buildBjRules() {
    const c = (t) => {
      const r = { A: 14, K: 13, Q: 12, J: 11, T: 10 }[t[0]] || +t[0];
      return { r, s: { s: 0, h: 1, d: 2, c: 3 }[t[1]], id: 'bj' + t };
    };
    const item = ([title, cards, desc, badge]) => `<div class="hand-item"><div class="body">
        <div class="title">${title}${badge ? ` <span class="bj-total">${badge}</span>` : ''}</div>
        <div class="ex">${cards.split(' ').map((t) => cardHTML(c(t))).join('')}</div>
        <div class="desc" style="margin:7px 0 0">${desc}</div></div></div>`;
    $('#bjValues').innerHTML = [
      ['Number cards', '2c 5d 9s', 'Count as their number: 2 to 9 (and 10 counts 10).'],
      ['10 and picture cards', 'Th Js Qd Kc', 'All count as 10.'],
      ['Ace', 'As', 'Counts as 11, or as 1 when 11 would take you over 21. It switches on its own.'],
    ].map(item).join('');
    $('#bjExamples').innerHTML = [
      ['Blackjack', 'As Kh', 'An Ace plus a 10-value card as your first two cards. Pays 3 to 2 and beats a normal 21.', 'Blackjack'],
      ['Hard 17', 'Td 7c', 'No Ace, so it can only be 17. Any card of 5 or more would bust you.', '17'],
      ['Soft 17', 'Ah 6s', 'The Ace counts as 11, so it is 17. It can\'t bust on the next card: the Ace drops to 1 if it needs to.', 'Soft 17'],
      ['Ace switching to 1', 'Ac 6d 9h', '11 + 6 + 9 would be 26, so the Ace counts as 1 instead: 1 + 6 + 9 = 16.', '16'],
      ['Bust', 'Ks 6h 9c', '10 + 6 + 9 = 25. Over 21, so the hand loses straight away.', 'Bust 25'],
      ['You can split', '8c 8d', 'Two cards of the same value can be split into two hands, each with its own bet.', '16'],
      ['Dealer must hit', 'Ts 6d', 'The dealer has 16, so they must take another card. They have no choice.', '16'],
      ['Dealer must stand', 'Ad 6c', 'Soft 17 is still 17. At this table the dealer stands on all 17s.', 'Soft 17'],
    ].map(item).join('');
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------
  function wire() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      showTable();
    }));

    $('#btnFold').addEventListener('click', () => resolveHuman({ type: 'fold' }));
    $('#btnCall').addEventListener('click', () => {
      const u = G.humanUI;
      if (!u) return;
      resolveHuman(u.toCall <= 0 ? { type: 'check' } : { type: 'call' });
    });
    $('#btnRaise').addEventListener('click', () => {
      const u = G.humanUI;
      if (!u || !u.canRaise) return;
      resolveHuman({ type: 'raise', to: u.value });
    });
    $('#raiseSlider').addEventListener('input', (e) => {
      const u = G.humanUI;
      if (!u) return;
      const f = +e.target.value / 100;
      setRaiseValue(f >= 1 ? u.maxTo : u.minTo + (u.maxTo - u.minTo) * f);
    });
    $$('.preset').forEach((b) => b.addEventListener('click', () => {
      const u = G.humanUI;
      if (!u) return;
      const potAfterCall = potTotal() + u.toCall;
      const v = { min: u.minTo, half: G.currentBet + potAfterCall / 2, pot: G.currentBet + potAfterCall, allin: u.maxTo }[b.dataset.preset];
      setRaiseValue(v);
    }));

    $('#myCards').addEventListener('click', (e) => {
      if (!(G.street === 'draw' && G.turn === 0 && G.drawDone)) return;
      const cardEl = e.target.closest('.card');
      if (!cardEl) return;
      const idx = Array.from($('#myCards').children).indexOf(cardEl);
      if (G.drawSel.has(idx)) G.drawSel.delete(idx); else G.drawSel.add(idx);
      cardEl.classList.toggle('sel', G.drawSel.has(idx));
      renderDrawUI();
    });
    $('#btnDraw').addEventListener('click', () => {
      if (!G.drawDone || !drawValid()) return;
      const d = G.drawDone;
      G.drawDone = null;
      d([...G.drawSel].sort((a, b) => a - b));
    });

    $('#btnNext').addEventListener('click', () => { if (G.nextDone) { const d = G.nextDone; G.nextDone = null; d(); } });
    $('#btnNotice').addEventListener('click', () => { if (G.noticeDone) { const d = G.noticeDone; G.noticeDone = null; d(); } });

    // Main menu
    $$('.mode-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.mode === 'blackjack') { enterBlackjack(false); return; }
      const s = load();
      startGame(b.dataset.mode, s && s.chips && s.chips[0] > 0 ? s : null);
    }));
    $('#menuBtn').addEventListener('click', goToMenu);
    $$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
      G.speed = +b.dataset.speed;
      try { localStorage.setItem(SPEED_KEY, String(G.speed)); } catch (e) { /* ignore */ }
      syncMenu();
    }));
    let armed = null;
    const resetLabel = 'Reset all chips to $1,000';
    $('#btnRestart').addEventListener('click', () => {
      const btn = $('#btnRestart');
      if (!armed) {
        btn.textContent = 'Tap again to reset ALL chips';
        armed = setTimeout(() => { armed = null; btn.textContent = resetLabel; }, 3000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
      window.BJ.resetBank();
      btn.textContent = 'Chips reset ✓';
      setTimeout(() => { btn.textContent = resetLabel; }, 2000);
      refreshMenu();
    });
  }

  // ---------------------------------------------------------------------------
  // Switching between poker and blackjack
  // ---------------------------------------------------------------------------
  function setLast(m) { try { localStorage.setItem(LAST_KEY, m); } catch (e) { /* ignore */ } }
  function getLast() { try { return localStorage.getItem(LAST_KEY); } catch (e) { return null; } }

  /** True while cards are out in a poker hand (chips would be lost by leaving). */
  function pokerHandInProgress() {
    return G.pokerOn && G.players.some((p) => p.hand.length) && !G.lastResult;
  }

  function showTable() {
    const active = $('.tab.active');
    const tab = active ? active.dataset.tab : 'table';
    const id = tab === 'hands' ? 'view-hands' : G.app === 'blackjack' ? 'view-bj' : 'view-table';
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    const bj = G.app === 'blackjack';
    $('#rules-poker').hidden = bj;
    $('#rules-bj').hidden = !bj;
    $('#rulesTab').textContent = bj ? '📖 Rules' : '📖 Hands';
  }

  function enterBlackjack(fresh) {
    abortAll(); // poker is between hands here; chips were saved when the last hand ended
    G.pokerOn = false;
    G.pendingApp = null;
    G.app = 'blackjack';
    setLast('blackjack');
    $$('.overlay').forEach((o) => o.classList.remove('show'));
    showTable();
    window.BJ.enter(fresh);
  }

  /** Menu button: leave the current game and go back to the main menu.
   *  An unfinished poker hand or blackjack round is cancelled (chips go back to where they were before it). */
  function goToMenu() {
    if (G.app === 'poker' && G.pokerOn) {
      abortAll();
      G.pokerOn = false;
      G.humanUI = null;
      $('#actions').classList.add('off');
    }
    if (G.app === 'blackjack') window.BJ.abandon();
    $$('.overlay').forEach((o) => o.classList.remove('show'));
    refreshMenu();
    $('#startScreen').classList.add('show');
  }

  function refreshMenu() {
    const s = load();
    const chips = s && s.chips && s.chips[0] > 0 ? s.chips[0] : null;
    const opps = chips && s.opponents ? s.opponents.filter((o, i) => !(s.out && s.out[i + 1])).map((o) => o.name) : [];
    const pokerSub = chips ? `Your chips: ${fmt(chips)}${opps.length ? ' · vs ' + opps.join(', ') : ''}` : null;
    $('[data-sub="holdem"]').textContent = pokerSub || '2 private cards + 5 shared';
    $('[data-sub="draw"]').textContent = pokerSub || '5 private cards, swap up to 3';
    const bank = window.BJ.savedBank();
    $('[data-sub="blackjack"]').textContent = bank ? `Your chips: ${fmt(bank)} · green table` : 'You vs the dealer on a green table';
    syncMenu();
  }

  function appNotice(icon, title, text) {
    $('#noticeIcon').textContent = icon;
    $('#noticeTitle').textContent = title;
    $('#noticeText').textContent = text;
    $('#notice').classList.add('show');
    return new Promise((res) => { G.noticeDone = () => { $('#notice').classList.remove('show'); res(); }; });
  }

  window.CardUI = { cardHTML: (c, cls) => cardHTML(c, cls) };
  window.App = { get speed() { return G.speed; }, notice: appNotice };

  function syncMenu() {
    $$('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === G.speed));
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function boot() {
    buildHandsTab();
    wire();
    window.BJ.init();
    G.players = makePlayers();
    $('#actions').classList.add('off');
    render();
    try { const sp = +localStorage.getItem(SPEED_KEY); if (sp > 0) G.speed = sp; } catch (e) { /* ignore */ }
    buildBjRules();
    refreshMenu();
  }

  boot();
})();
