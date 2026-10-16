'use strict';
// شبیه‌سازی کامل بازی‌ها با ربات‌ها برای اطمینان از درستی منطق (بدون نیاز به اینترنت یا تلگرام)
const assert = require('assert');
const { Hokm } = require('../game/hokm');
const { Shelem } = require('../game/shelem');
const AI = require('../game/ai');
const { shelemPoints } = require('../game/cards');
const { Room, TIMING } = require('../game/room');

function runGame(game, levels) {
  let ev = game.startHand(), guard = 0, hands = 0;
  while (game.phase !== 'gameOver' && guard++ < 100000) {
    const s = game.turn;
    switch (game.phase) {
      case 'chooseTrump': ev = game.chooseTrump(s, AI.chooseTrump(game.hands[s], levels[s])); break;
      case 'bidding': ev = game.placeBid(s, AI.shelemBid(game, s, levels[s])); break;
      case 'widow': { assert.strictEqual(game.hands[s].length, 16); const d = AI.shelemDiscard(game, s, levels[s]); ev = game.discard(s, d.cards, d.suit); break; }
      case 'playing': ev = game.play(s, AI.chooseCard(game, s, levels[s])); break;
      case 'trickEnd': ev = game.collect(); break;
      case 'handEnd': case 'redeal':
        if (game.type === 'shelem' && game.phase === 'handEnd') {
          const r = game.result; assert.strictEqual(r.points[0] + r.points[1], 165, 'shelem total must be 165');
        }
        hands++; ev = game.startHand(); break;
      default: throw new Error('bad phase ' + game.phase);
    }
  }
  assert(game.phase === 'gameOver', 'game did not finish');
  return { winner: game.winner, scores: game.scores, hands };
}

const lv = (a, b) => [a, b, a, b];
for (const [type, Cls] of [['hokm', Hokm], ['shelem', Shelem]]) {
  const wins = [0, 0];
  for (let i = 0; i < 200; i++) wins[runGame(new Cls({}), lv('hard', 'easy')).winner]++;
  console.log(`${type}: hard(team0) vs easy(team1) wins =`, wins);
  const w2 = [0, 0];
  for (let i = 0; i < 200; i++) w2[runGame(new Cls({}), lv('hard', 'medium')).winner]++;
  console.log(`${type}: hard(team0) vs medium(team1) wins =`, w2);
}
assert.strictEqual([...'S H D C'.split(' ')].reduce((s, su) => { let t = 0; for (let r = 2; r <= 14; r++) t += shelemPoints(su + r); return s + t; }, 0), 100);

// تست اتاق با زمان‌بندی سریع و یک بازیکن انسانی که تایم‌اوت می‌شود
for (const k of Object.keys(TIMING)) TIMING[k] = 1;
let msgs = 0, over = false;
const conn = { readyState: 1, send(s) { msgs++; const m = JSON.parse(s); if (m.room.g && m.room.g.phase === 'gameOver') over = true; } };
const room = new Room({ id: 'TEST01', gameType: 'shelem', settings: { level: 'hard', target: 600, mode: 'bots' }, inviteLink: 'x' });
room.attach({ id: 'u1', name: 'Frank' }, conn, { silent: true });
room.fillBots('hard');
room.start('u1');
const t0 = Date.now();
(function wait() {
  if (over) { console.log('room test OK, messages:', msgs); room.destroy(); process.exit(0); }
  if (Date.now() - t0 > 20000) { console.error('room test timeout'); process.exit(1); }
  setTimeout(wait, 20);
})();
