'use strict';
const crypto = require('crypto');

// خال‌ها: S=پیک ♠ | H=دل ♥ | D=خشت ♦ | C=گشنیز ♣  — رنک: 2..14 (14 = آس)
const SUITS = ['S', 'H', 'D', 'C'];

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(s + r);
  return d;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const suitOf = (c) => c[0];
const rankOf = (c) => parseInt(c.slice(1), 10);

/** آیا کارت a کارت b (برنده فعلی دست) را می‌برد؟ */
function beats(a, b, trump) {
  const sa = suitOf(a), sb = suitOf(b);
  if (sa === sb) return rankOf(a) > rankOf(b);
  return sa === trump;
}

function trickWinner(trick, trump) {
  let best = trick[0];
  for (let i = 1; i < trick.length; i++) if (beats(trick[i].card, best.card, trump)) best = trick[i];
  return best;
}

/** پیروی اجباری از خال: اگر از خال زمین داری باید همان را بازی کنی */
function legalCards(hand, trick) {
  if (!trick.length) return hand.slice();
  const lead = suitOf(trick[0].card);
  const follow = hand.filter((c) => suitOf(c) === lead);
  return follow.length ? follow : hand.slice();
}

/** امتیاز کارت در شلم: آس و ده = ۱۰ ، پنج = ۵ */
function shelemPoints(c) {
  const r = rankOf(c);
  if (r === 14 || r === 10) return 10;
  if (r === 5) return 5;
  return 0;
}

module.exports = { SUITS, makeDeck, shuffle, suitOf, rankOf, beats, trickWinner, legalCards, shelemPoints };
