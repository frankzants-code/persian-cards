'use strict';
const { SUITS, makeDeck, shuffle, shelemPoints } = require('./cards');
const { TrickGame, GameError } = require('./base');

const MIN_BID = 100, MAX_BID = 165, STEP = 5, SHELEM_BONUS = 330;

/**
 * شلم ۴ نفره (دو تیم دو نفره)
 * - ۱۲ کارت برای هر نفر + ۴ کارت وسط (خاک)
 * - بید از ۱۰۰ تا ۱۶۵ با گام ۵ ؛ هر کس پاس دهد دیگر نمی‌خواند
 * - برنده بید (حاکم) ۴ کارت وسط را برمی‌دارد، ۴ کارت دور می‌ریزد و حکم را اعلام می‌کند
 * - امتیازها: آس و ده = ۱۰ ، پنج = ۵ (جمعاً ۱۰۰) + هر دست ۵ امتیاز (۱۲ دست + خاک = ۶۵) → ۱۶۵
 * - کارت‌های دورریخته (خاک) و ۵ امتیازش متعلق به تیم حاکم است
 * - رسیدن به بید: هر تیم امتیاز خودش را می‌گیرد | نرسیدن: تیم حاکم منفی بید
 * - شلم کامل (همه ۱۲ دست): +۳۳۰ | اعلام شلم (بید ۱۶۵) و نرسیدن: −۳۳۰
 */
class Shelem extends TrickGame {
  constructor(opts = {}) {
    super();
    this.type = 'shelem';
    this.target = opts.target || 1165;
    this.scores = [0, 0];
    this.dealer = 3;
    this.handNo = 0;
    this.phase = 'idle';
    this.winner = null;
    this.hakem = -1;
    this.resetHand();
  }

  startHand() {
    this.handNo++;
    this.resetHand();
    this.dealer = (this.dealer + 1) % 4;
    const d = shuffle(makeDeck());
    for (let s = 0; s < 4; s++) this.hands[s] = d.slice(s * 12, s * 12 + 12);
    this.widow = d.slice(48);
    this.bids = [null, null, null, null];
    this.passed = [false, false, false, false];
    this.highBid = 0;
    this.highBidder = -1;
    this.hakem = -1;
    this.bid = 0;
    this.tricksWon = [0, 0];
    this.points = [0, 0];
    this.khak = [];
    this.khakPoints = 0;
    this.phase = 'bidding';
    this.turn = (this.dealer + 1) % 4;
    return [{ type: 'deal', count: 12, dealer: this.dealer, handNo: this.handNo }];
  }

  minBid() { return this.highBid ? this.highBid + STEP : MIN_BID; }

  placeBid(seat, value) {
    if (this.phase !== 'bidding') throw new GameError('الان وقت خواندن نیست');
    if (this.turn !== seat) throw new GameError('نوبت تو نیست');
    const events = [];
    if (value === 'pass') {
      this.passed[seat] = true;
      this.bids[seat] = 'pass';
      events.push({ type: 'bid', seat, value: 'pass' });
    } else {
      const v = Number(value);
      if (!Number.isInteger(v) || v % STEP || v < this.minBid() || v > MAX_BID) throw new GameError('مقدار خواندن نامعتبر است');
      this.highBid = v;
      this.highBidder = seat;
      this.bids[seat] = v;
      events.push({ type: 'bid', seat, value: v });
    }
    const passedCount = this.passed.filter(Boolean).length;
    if (passedCount === 4) {
      this.phase = 'redeal';
      this.turn = -1;
      events.push({ type: 'allPass' });
      return events;
    }
    if ((this.highBidder >= 0 && passedCount === 3) || this.highBid === MAX_BID) return events.concat(this.endBidding());
    let n = (seat + 1) % 4;
    while (this.passed[n]) n = (n + 1) % 4;
    this.turn = n;
    return events;
  }

  endBidding() {
    this.hakem = this.highBidder;
    this.bid = this.highBid;
    this.hands[this.hakem].push(...this.widow);
    this.phase = 'widow';
    this.turn = this.hakem;
    return [{ type: 'bidWon', seat: this.hakem, bid: this.bid }];
  }

  discard(seat, cards, suit) {
    if (this.phase !== 'widow') throw new GameError('الان وقت دور ریختن نیست');
    if (seat !== this.hakem) throw new GameError('فقط حاکم کارت دور می‌ریزد');
    if (!Array.isArray(cards) || cards.length !== 4 || new Set(cards).size !== 4) throw new GameError('دقیقاً ۴ کارت انتخاب کن');
    const hand = this.hands[seat];
    if (!cards.every((c) => hand.includes(c))) throw new GameError('کارت نامعتبر');
    if (!SUITS.includes(suit)) throw new GameError('خال حکم نامعتبر');
    this.hands[seat] = hand.filter((c) => !cards.includes(c));
    this.khak = cards.slice();
    this.khakPoints = cards.reduce((s, c) => s + shelemPoints(c), 0) + 5;
    this.trump = suit;
    this.phase = 'playing';
    this.turn = this.hakem;
    return [{ type: 'discard', seat }, { type: 'trump', suit, seat }];
  }

  onTrickWon(w, trick) {
    const t = w % 2;
    this.tricksWon[t]++;
    this.points[t] += 5 + trick.reduce((s, x) => s + shelemPoints(x.card), 0);
  }

  afterTrick() {
    if (this.hands.every((h) => h.length === 0)) return this.endHand();
    return [];
  }

  endHand() {
    const ht = this.hakem % 2, dt = 1 - ht;
    const pts = this.points.slice();
    pts[ht] += this.khakPoints;
    const delta = [0, 0];
    let kind;
    if (this.tricksWon[ht] === 12) { delta[ht] = SHELEM_BONUS; kind = 'shelem'; }
    else if (this.bid === MAX_BID) { delta[ht] = -SHELEM_BONUS; delta[dt] = pts[dt]; kind = 'shelemFail'; }
    else if (pts[ht] >= this.bid) { delta[ht] = pts[ht]; delta[dt] = pts[dt]; kind = 'made'; }
    else { delta[ht] = -this.bid; delta[dt] = pts[dt]; kind = 'failed'; }
    this.scores[0] += delta[0];
    this.scores[1] += delta[1];
    const over = Math.max(...this.scores) >= this.target;
    if (over) this.winner = this.scores[0] === this.scores[1] ? ht : this.scores[0] > this.scores[1] ? 0 : 1;
    this.result = { kind, delta, points: pts, bid: this.bid, hakem: this.hakem, tricks: this.tricksWon.slice(), khak: this.khak.slice(), scores: this.scores.slice(), gameOver: over };
    this.phase = over ? 'gameOver' : 'handEnd';
    this.turn = -1;
    return [Object.assign({ type: 'handEnd' }, this.result)];
  }

  publicState(seat) {
    return {
      type: 'shelem', phase: this.phase, handNo: this.handNo, dealer: this.dealer, hakem: this.hakem, trump: this.trump,
      turn: this.turn, trick: this.trick, lastTrick: this.lastTrick, trickWinner: this.trickWinnerSeat,
      scores: this.scores, target: this.target, hand: this.hands[seat], legal: this.legalFor(seat),
      counts: this.hands.map((h) => h.length), bids: this.bids, highBid: this.highBid, highBidder: this.highBidder,
      minBid: this.phase === 'bidding' ? this.minBid() : null, maxBid: MAX_BID, bid: this.bid,
      points: this.points, tricksWon: this.tricksWon,
      widow: this.phase === 'widow' && seat === this.hakem ? this.widow : null,
      result: this.result, winner: this.winner,
    };
  }
}

module.exports = { Shelem, MIN_BID, MAX_BID, STEP, SHELEM_BONUS };
