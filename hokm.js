'use strict';
const { SUITS, makeDeck, shuffle, rankOf } = require('./cards');
const { TrickGame, GameError } = require('./base');

/**
 * حکم کلاسیک ۴ نفره
 * - تیم‌ها: صندلی ۰ و ۲ در برابر ۱ و ۳ (یارها روبه‌روی هم)
 * - دست اول: کارت رو به بالا پخش می‌شود تا اولین آس → حاکم
 * - حاکم با دیدن ۵ کارت اول حکم را اعلام می‌کند، بعد ۴+۴ کارت پخش می‌شود
 * - امتیاز: ۷ دست = ۱ | کُت (۷-۰) = ۲ | شلم (۱۳ دست) = ۳
 *   (وقتی تیمی ۷-۰ جلو است بازی ادامه پیدا می‌کند تا یا کُت قطعی شود یا شلم)
 * - اگر تیم حاکم ببازد، حاکمی به نفر بعدی می‌رسد
 */
class Hokm extends TrickGame {
  constructor(opts = {}) {
    super();
    this.type = 'hokm';
    this.target = opts.target || 7;
    this.scores = [0, 0];
    this.hakem = null;
    this.handNo = 0;
    this.phase = 'idle';
    this.winner = null;
    this.resetHand();
  }

  startHand() {
    this.handNo++;
    this.resetHand();
    this.tricks = [0, 0];
    this.kotTeam = -1;
    const events = [];

    if (this.hakem === null) {
      const d = shuffle(makeDeck());
      const seq = [];
      let seat = 0;
      for (const c of d) {
        seq.push({ seat, card: c });
        if (rankOf(c) === 14) { this.hakem = seat; break; }
        seat = (seat + 1) % 4;
      }
      events.push({ type: 'hakemSelect', seq, hakem: this.hakem });
    }

    this.deck = shuffle(makeDeck());
    for (let k = 0; k < 4; k++) {
      const s = (this.hakem + k) % 4;
      this.hands[s] = this.deck.splice(0, 5);
    }
    this.phase = 'chooseTrump';
    this.turn = this.hakem;
    events.push({ type: 'deal', count: 5, hakem: this.hakem, handNo: this.handNo });
    return events;
  }

  chooseTrump(seat, suit) {
    if (this.phase !== 'chooseTrump') throw new GameError('الان وقت انتخاب حکم نیست');
    if (seat !== this.hakem) throw new GameError('فقط حاکم حکم را انتخاب می‌کند');
    if (!SUITS.includes(suit)) throw new GameError('خال نامعتبر');
    this.trump = suit;
    for (const n of [4, 4]) {
      for (let k = 0; k < 4; k++) {
        const s = (this.hakem + k) % 4;
        this.hands[s].push(...this.deck.splice(0, n));
      }
    }
    this.phase = 'playing';
    this.turn = this.hakem;
    return [{ type: 'trump', suit, seat }, { type: 'deal', count: 8 }];
  }

  onTrickWon(w) { this.tricks[w % 2]++; }

  afterTrick() {
    const t = this.tricks;
    const a = t[0] >= 7 ? 0 : t[1] >= 7 ? 1 : -1;
    if (a < 0) return [];
    const o = 1 - a;
    if (t[o] === 0) {
      if (t[a] === 13) return this.endHand(a, 3, 'shlem');
      if (this.kotTeam < 0) { this.kotTeam = a; return [{ type: 'kotChase', team: a }]; }
      return [];
    }
    const kot = this.kotTeam === a;
    return this.endHand(a, kot ? 2 : 1, kot ? 'kot' : 'normal');
  }

  endHand(team, points, kind) {
    const prevHakem = this.hakem;
    this.scores[team] += points;
    if (team !== prevHakem % 2) this.hakem = (prevHakem + 1) % 4;
    const over = this.scores[team] >= this.target;
    this.result = { team, points, kind, tricks: this.tricks.slice(), hakem: prevHakem, scores: this.scores.slice(), gameOver: over };
    this.phase = over ? 'gameOver' : 'handEnd';
    if (over) this.winner = team;
    this.turn = -1;
    return [Object.assign({ type: 'handEnd' }, this.result)];
  }

  publicState(seat) {
    return {
      type: 'hokm', phase: this.phase, handNo: this.handNo, hakem: this.hakem, trump: this.trump,
      turn: this.turn, trick: this.trick, lastTrick: this.lastTrick, trickWinner: this.trickWinnerSeat,
      tricks: this.tricks, scores: this.scores, target: this.target,
      hand: this.hands[seat], legal: this.legalFor(seat), counts: this.hands.map((h) => h.length),
      result: this.result, winner: this.winner, kotTeam: this.kotTeam,
    };
  }
}

module.exports = { Hokm };
