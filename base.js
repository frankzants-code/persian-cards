'use strict';
const { suitOf, legalCards, trickWinner } = require('./cards');

class GameError extends Error {}

/** پایه مشترک بازی‌های دست‌گیر (حکم و شلم) */
class TrickGame {
  resetHand() {
    this.hands = [[], [], [], []];
    this.trick = [];
    this.lastTrick = null;
    this.trump = null;
    this.played = [];
    this.voids = [{}, {}, {}, {}];
    this.trickWinnerSeat = null;
    this.result = null;
  }

  legalFor(seat) {
    if (this.phase !== 'playing' || this.turn !== seat) return [];
    return legalCards(this.hands[seat], this.trick);
  }

  play(seat, card) {
    if (this.phase !== 'playing') throw new GameError('الان وقت بازی کردن کارت نیست');
    if (this.turn !== seat) throw new GameError('نوبت تو نیست');
    const hand = this.hands[seat];
    const idx = hand.indexOf(card);
    if (idx < 0) throw new GameError('این کارت دست تو نیست');
    if (!legalCards(hand, this.trick).includes(card)) throw new GameError('باید از خال زمین بازی کنی');
    hand.splice(idx, 1);

    let cut = false;
    if (this.trick.length) {
      const lead = suitOf(this.trick[0].card);
      if (suitOf(card) !== lead) {
        this.voids[seat][lead] = true;
        if (suitOf(card) === this.trump) cut = true; // بُرش
      }
    }
    this.trick.push({ seat, card });
    this.played.push(card);
    const events = [{ type: 'play', seat, card, cut }];

    if (this.trick.length < 4) {
      this.turn = (seat + 1) % 4;
    } else {
      const w = trickWinner(this.trick, this.trump).seat;
      this.trickWinnerSeat = w;
      this.phase = 'trickEnd';
      this.turn = -1;
      this.onTrickWon(w, this.trick);
      events.push({ type: 'trickWon', winner: w });
    }
    return events;
  }

  /** بعد از مکث نمایش دست، کارت‌ها جمع می‌شوند */
  collect() {
    if (this.phase !== 'trickEnd') return [];
    this.lastTrick = this.trick;
    this.trick = [];
    this.phase = 'playing';
    this.turn = this.trickWinnerSeat;
    return [{ type: 'collect', winner: this.trickWinnerSeat }].concat(this.afterTrick());
  }
}

module.exports = { TrickGame, GameError };
