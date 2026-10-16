'use strict';
const { SUITS, suitOf, rankOf, legalCards, trickWinner, beats, shelemPoints } = require('./cards');

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function suitGroups(hand) {
  const g = { S: [], H: [], D: [], C: [] };
  for (const c of hand) g[suitOf(c)].push(c);
  for (const s of SUITS) g[s].sort((a, b) => rankOf(a) - rankOf(b));
  return g;
}

/* ---------------- انتخاب حکم ---------------- */
function chooseTrump(hand, level = 'medium') {
  const g = suitGroups(hand);
  if (level === 'easy') return SUITS.slice().sort((a, b) => g[b].length - g[a].length)[0];
  let best = SUITS[0], bs = -1;
  for (const s of SUITS) {
    let sc = g[s].length * 4;
    for (const c of g[s]) { const r = rankOf(c); if (r >= 11) sc += (r - 10) * 1.5; }
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

/* ---------------- حافظه کارت (سطح سخت) ---------------- */
function knownCards(game, seat) {
  const k = new Set(game.played.concat(game.hands[seat]));
  if (game.type === 'shelem' && game.hakem === seat && game.khak) game.khak.forEach((c) => k.add(c));
  return k;
}
function unseenHigher(game, seat, card) {
  const s = suitOf(card), r = rankOf(card), k = knownCards(game, seat);
  let n = 0;
  for (let x = r + 1; x <= 14; x++) if (!k.has(s + x)) n++;
  return n;
}
function isBoss(game, seat, card, level) {
  if (level === 'hard') return unseenHigher(game, seat, card) === 0;
  return rankOf(card) === 14;
}
function opponentsMayHaveTrump(game, seat) {
  const k = knownCards(game, seat);
  let unseen = 0;
  for (let r = 2; r <= 14; r++) if (!k.has(game.trump + r)) unseen++;
  return unseen > 0 && [(seat + 1) % 4, (seat + 3) % 4].some((o) => !game.voids[o][game.trump]);
}

/* ---------------- انتخاب کارت ---------------- */
function chooseCard(game, seat, level = 'medium') {
  const hand = game.hands[seat], trick = game.trick, trump = game.trump;
  const legal = legalCards(hand, trick);
  if (legal.length === 1) return legal[0];
  if (level === 'easy' && Math.random() < 0.7) return pick(legal);

  const isShelem = game.type === 'shelem';
  const pts = (c) => (isShelem ? shelemPoints(c) : 0);
  const cost = (c) => rankOf(c) + (suitOf(c) === trump ? 15 : 0) + pts(c) * 2;
  const byCost = (arr) => arr.slice().sort((a, b) => cost(a) - cost(b));
  const lowest = (arr) => byCost(arr)[0];
  const partner = (seat + 2) % 4;

  if (!trick.length) return chooseLead(game, seat, level, hand, trump, pts);

  const leadSuit = suitOf(trick[0].card);
  const win = trickWinner(trick, trump);
  const partnerWinning = win.seat === partner;
  const winners = legal.filter((c) => beats(c, win.card, trump));
  const last = trick.length === 3;
  const trickPts = trick.reduce((s, x) => s + pts(x.card), 0);

  if (partnerWinning) {
    const nextOpp = (seat + 1) % 4;
    const safe = last || (isBoss(game, seat, win.card, level) &&
      (suitOf(win.card) === trump || !(level === 'hard' && game.voids[nextOpp][leadSuit] && !game.voids[nextOpp][trump])));
    if (safe) {
      if (isShelem) {
        const nonTrump = legal.filter((c) => suitOf(c) !== trump);
        const pool = nonTrump.length ? nonTrump : legal;
        const feed = pool.slice().sort((a, b) => pts(b) - pts(a) || rankOf(a) - rankOf(b));
        if (pts(feed[0]) > 0) return feed[0];
      }
      return lowest(legal);
    }
  }

  if (winners.length && !partnerWinning) {
    if (last) return lowest(winners);
    const cutting = suitOf(winners[0]) !== leadSuit;
    if (cutting) return lowest(winners);
    const bosses = winners.filter((c) => isBoss(game, seat, c, level));
    if (bosses.length) return lowest(bosses);
    if (trick.length === 1) {
      if (isShelem && trickPts >= 10) return winners.sort((a, b) => rankOf(b) - rankOf(a))[0];
      const nonPts = legal.filter((c) => !pts(c) && !winners.includes(c));
      return nonPts.length ? lowest(nonPts) : lowest(legal);
    }
    return winners.sort((a, b) => rankOf(b) - rankOf(a))[0];
  }

  // نمی‌توانیم ببریم: کم‌ارزش‌ترین کارت را بینداز
  if (isShelem) {
    return legal.slice().sort((a, b) => pts(a) - pts(b) || (suitOf(a) === trump) - (suitOf(b) === trump) || rankOf(a) - rankOf(b))[0];
  }
  return lowest(legal);
}

function chooseLead(game, seat, level, hand, trump, pts) {
  const g = suitGroups(hand);
  const partner = (seat + 2) % 4;
  const opps = [(seat + 1) % 4, (seat + 3) % 4];
  const myTeamHakem = game.hakem % 2 === seat % 2;
  const trumps = g[trump] || [];

  if (level === 'hard' && myTeamHakem && trumps.length >= 4) {
    const top = trumps[trumps.length - 1];
    if (isBoss(game, seat, top, level) && opponentsMayHaveTrump(game, seat)) return top;
  }

  const nonTrump = hand.filter((c) => suitOf(c) !== trump);
  const bosses = nonTrump.filter((c) => isBoss(game, seat, c, level) &&
    !(level === 'hard' && opps.some((o) => game.voids[o][suitOf(c)] && !game.voids[o][trump])));
  if (bosses.length) return bosses.sort((a, b) => pts(b) - pts(a) || rankOf(b) - rankOf(a))[0];

  if (level === 'hard') {
    for (const s of SUITS) {
      if (s !== trump && g[s].length && game.voids[partner][s] && !game.voids[partner][trump] && !opps.some((o) => game.voids[o][s])) return g[s][0];
    }
  }

  let cands = nonTrump.length ? nonTrump : hand.slice();
  const np = cands.filter((c) => !pts(c) && rankOf(c) < 13);
  if (np.length) cands = np;
  const gg = suitGroups(cands);
  let bestS = null;
  for (const s of SUITS) if (gg[s].length && (!bestS || gg[s].length > gg[bestS].length)) bestS = s;
  return gg[bestS][0];
}

/* ---------------- شلم: بید ---------------- */
function evaluateShelem(hand) {
  const g = suitGroups(hand);
  let est = 55, maxLen = 0;
  for (const s of SUITS) {
    const rs = g[s].map(rankOf), len = rs.length;
    maxLen = Math.max(maxLen, len);
    const A = rs.includes(14), K = rs.includes(13), T = rs.includes(10);
    if (A) est += 14;
    if (K) est += A ? 6 : 2;
    if (T) est += A ? 7 : len >= 3 ? 3 : 0;
    if (len >= 5) est += (len - 4) * 6;
    if (len === 0) est += 4;
  }
  return est + Math.max(0, maxLen - 3) * 4;
}

function shelemBid(game, seat, level = 'medium') {
  let est = evaluateShelem(game.hands[seat]);
  const partner = (seat + 2) % 4, pb = game.bids[partner];
  if (level !== 'easy') { if (typeof pb === 'number') est += 8; else if (pb === 'pass') est -= 5; }
  if (level === 'easy') est += Math.round((Math.random() - 0.5) * 30) - 5;
  if (level === 'hard') est += 5;
  const maxBid = Math.min(165, Math.floor(est / 5) * 5);
  const min = game.minBid();
  const othersPassed = game.passed.filter((p, i) => p && i !== seat).length;
  if (game.highBidder < 0 && othersPassed === 3) return est >= 85 ? 100 : 'pass';
  if (game.highBidder === partner && min > maxBid - 10) return 'pass';
  return min <= maxBid ? min : 'pass';
}

/* ---------------- شلم: دور ریختن + حکم ---------------- */
function shelemDiscard(game, seat, level = 'medium') {
  const hand = game.hands[seat];
  const suit = chooseTrump(hand, level === 'easy' ? 'easy' : 'medium');
  const g = suitGroups(hand);
  const nonTrump = hand.filter((c) => suitOf(c) !== suit && rankOf(c) !== 14);
  let chosen;
  if (level === 'easy') {
    chosen = nonTrump.slice().sort(() => Math.random() - 0.5).slice(0, 4);
  } else {
    const score = (c) => {
      const s = suitOf(c), len = g[s].length, hasAce = g[s].some((x) => rankOf(x) === 14);
      let sc = (8 - len) * 3 + (14 - rankOf(c));
      if (shelemPoints(c) > 0 && !hasAce) sc += 8;
      if (rankOf(c) === 13 && hasAce) sc -= 10;
      return sc;
    };
    chosen = nonTrump.slice().sort((a, b) => score(b) - score(a)).slice(0, 4);
  }
  if (chosen.length < 4) {
    const rest = hand.filter((c) => !chosen.includes(c)).sort((a, b) => rankOf(a) - rankOf(b) || shelemPoints(a) - shelemPoints(b));
    chosen = chosen.concat(rest.slice(0, 4 - chosen.length));
  }
  return { cards: chosen, suit };
}

module.exports = { chooseTrump, chooseCard, shelemBid, shelemDiscard, evaluateShelem };
