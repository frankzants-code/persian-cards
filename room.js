'use strict';
const { SUITS, legalCards } = require('./cards');
const { Hokm } = require('./hokm');
const { Shelem } = require('./shelem');
const { GameError } = require('./base');
const AI = require('./ai');

const TIMING = {
  botMin: 650, botMax: 1250, trickPause: 1400, handPause: 5500, redealPause: 2200,
  turnTimeout: 45000, disconnectedTurn: 6000, hakemStep: 320, dealPause: 900, lobbyGrace: 60000,
};
const LEVELS = ['easy', 'medium', 'hard'];
const BOT_NAMES = ['رستم', 'سیمرغ', 'آرش', 'شیرین', 'کاوه', 'گردآفرید', 'بهرام', 'مهسا', 'سهراب', 'تهمینه'];
const EMOJIS = new Set(['👍', '😂', '😮', '😡', '🔥', '👏', '🙏', '😎', '😭', '🤝']);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));

class Room {
  constructor({ id, gameType, settings, inviteLink }) {
    this.id = id;
    this.gameType = gameType;
    this.settings = settings;
    this.inviteLink = inviteLink;
    this.players = [null, null, null, null];
    this.hostUid = null;
    this.game = null;
    this.timer = null;
    this.turnDeadline = null;
    this.lastHumanSeen = Date.now();
    this.gameNo = 0;
  }

  seatOf(uid) { return this.players.findIndex((p) => p && !p.isBot && p.uid === uid); }
  connectedHumans() { return this.players.filter((p) => p && !p.isBot && p.connected).length; }
  isHost(uid) { return uid === this.hostUid; }

  makeBot(level) {
    const used = new Set(this.players.filter(Boolean).map((p) => p.name));
    const free = BOT_NAMES.filter((n) => !used.has('🤖 ' + n));
    return { isBot: true, level: LEVELS.includes(level) ? level : 'medium', name: '🤖 ' + (free.length ? free[rnd(0, free.length)] : 'ربات'), connected: true };
  }

  /* ---------- اتصال بازیکن ---------- */
  attach(user, conn, { silent = false } = {}) {
    let seat = this.seatOf(user.id);
    if (seat < 0) {
      if (this.game) {
        seat = this.players.findIndex((p) => p && p.isBot && p.formerUid === user.id);
        if (seat < 0) throw new GameError('این میز در حال بازی است و جای خالی ندارد');
      } else {
        seat = this.players.findIndex((p) => !p);
        if (seat < 0) seat = this.players.findIndex((p) => p && p.isBot);
        if (seat < 0) throw new GameError('میز پر است');
      }
      this.players[seat] = { uid: user.id, isBot: false };
    }
    const p = this.players[seat];
    clearTimeout(p.leaveTimer);
    Object.assign(p, { name: user.name, photo: user.photo || null, conn, connected: true });
    if (!this.hostUid || this.seatOf(this.hostUid) < 0) this.hostUid = user.id;
    this.lastHumanSeen = Date.now();
    if (!silent) {
      if (this.game) this.schedule();
      this.broadcast();
    }
    return seat;
  }

  detach(uid, conn) {
    const s = this.seatOf(uid);
    if (s < 0) return;
    const p = this.players[s];
    if (p.conn !== conn) return;
    p.conn = null;
    p.connected = false;
    if (!this.game) {
      p.leaveTimer = setTimeout(() => { if (!p.connected && !this.game) this.removeHuman(uid); }, TIMING.lobbyGrace);
    } else {
      this.schedule();
    }
    this.broadcast();
  }

  removeHuman(uid) {
    const s = this.seatOf(uid);
    if (s < 0) return;
    clearTimeout(this.players[s].leaveTimer);
    if (this.game) {
      const bot = this.makeBot(this.settings.level === 'easy' ? 'medium' : this.settings.level);
      bot.formerUid = uid;
      this.players[s] = bot;
    } else {
      this.players[s] = null;
    }
    if (this.hostUid === uid) {
      const h = this.players.find((p) => p && !p.isBot);
      this.hostUid = h ? h.uid : null;
    }
    if (this.game) this.schedule();
    this.broadcast();
  }

  fillBots(level = this.settings.level) {
    for (let i = 0; i < 4; i++) if (!this.players[i]) this.players[i] = this.makeBot(level);
  }

  requireLobbyHost(uid) {
    if (!this.isHost(uid)) throw new GameError('فقط میزبان می‌تواند این کار را انجام دهد');
    if (this.game) throw new GameError('بازی شروع شده است');
  }

  start(uid) {
    if (!this.isHost(uid)) throw new GameError('فقط میزبان می‌تواند بازی را شروع کند');
    if (this.players.some((p) => !p)) throw new GameError('هنوز همه صندلی‌ها پر نشده');
    if (this.game && this.game.phase !== 'gameOver') throw new GameError('بازی در جریان است');
    const opts = { target: this.settings.target };
    this.gameNo++;
    this.game = this.gameType === 'hokm' ? new Hokm(opts) : new Shelem(opts);
    this.after(this.game.startHand());
  }

  /* ---------- پیام‌های بازیکن ---------- */
  handle(uid, msg) {
    const seat = this.seatOf(uid);
    if (seat < 0) throw new GameError('عضو این میز نیستی');
    this.lastHumanSeen = Date.now();
    switch (msg.t) {
      case 'start':
      case 'rematch':
        return this.start(uid);
      case 'addBot': {
        this.requireLobbyHost(uid);
        const s = Number(msg.seat);
        if (!(s >= 0 && s < 4) || this.players[s]) throw new GameError('صندلی نامعتبر');
        this.players[s] = this.makeBot(LEVELS.includes(msg.level) ? msg.level : this.settings.level);
        return this.broadcast();
      }
      case 'fillBots':
        this.requireLobbyHost(uid);
        this.fillBots();
        return this.broadcast();
      case 'kick': {
        this.requireLobbyHost(uid);
        const s = Number(msg.seat), p = this.players[s];
        if (!p) return;
        if (!p.isBot) throw new GameError('فقط ربات‌ها را می‌توان برداشت');
        this.players[s] = null;
        return this.broadcast();
      }
      case 'sit': {
        if (this.game) throw new GameError('بازی شروع شده است');
        const s = Number(msg.seat);
        if (!(s >= 0 && s < 4) || s === seat) return;
        const target = this.players[s];
        if (target && !target.isBot) throw new GameError('این صندلی پر است');
        this.players[s] = this.players[seat];
        this.players[seat] = target || null;
        return this.broadcast();
      }
      case 'level':
        this.requireLobbyHost(uid);
        if (LEVELS.includes(msg.level)) {
          this.settings.level = msg.level;
          this.players.forEach((p) => { if (p && p.isBot) p.level = msg.level; });
        }
        return this.broadcast();
      case 'emoji': {
        if (!EMOJIS.has(msg.e)) return;
        const p = this.players[seat], now = Date.now();
        if (p.lastEmoji && now - p.lastEmoji < 1500) return;
        p.lastEmoji = now;
        return this.broadcast([{ type: 'emoji', seat, e: msg.e }]);
      }
      case 'trump': case 'play': case 'bid': case 'discard':
        return this.humanAction(seat, msg);
      default:
        throw new GameError('دستور نامعتبر');
    }
  }

  humanAction(seat, msg) {
    const g = this.game;
    if (!g) throw new GameError('بازی هنوز شروع نشده');
    let ev;
    if (msg.t === 'trump') {
      if (!g.chooseTrump) throw new GameError('دستور نامعتبر');
      ev = g.chooseTrump(seat, String(msg.suit));
    } else if (msg.t === 'play') {
      ev = g.play(seat, String(msg.card));
    } else if (msg.t === 'bid') {
      if (!g.placeBid) throw new GameError('دستور نامعتبر');
      ev = g.placeBid(seat, msg.value === 'pass' ? 'pass' : Number(msg.value));
    } else if (msg.t === 'discard') {
      if (!g.discard || !Array.isArray(msg.cards)) throw new GameError('دستور نامعتبر');
      ev = g.discard(seat, msg.cards.map(String), String(msg.suit));
    }
    this.after(ev);
  }

  /* ---------- زمان‌بندی و ربات‌ها ---------- */
  after(events = []) { this.schedule(events); this.broadcast(events); }

  later(ms, fn) {
    this.timer = setTimeout(() => {
      this.timer = null;
      try { fn(); } catch (e) { console.error('[room ' + this.id + ']', e); }
    }, ms);
  }

  schedule(events = []) {
    clearTimeout(this.timer);
    this.timer = null;
    this.turnDeadline = null;
    const g = this.game;
    if (!g || this.connectedHumans() === 0) return; // بدون بازیکن آنلاین، بازی متوقف می‌ماند

    let extra = 0;
    for (const e of events) {
      if (e.type === 'hakemSelect') extra += e.seq.length * TIMING.hakemStep + 1600;
      if (e.type === 'deal') extra += TIMING.dealPause;
    }
    switch (g.phase) {
      case 'trickEnd': return this.later(TIMING.trickPause, () => this.after(g.collect()));
      case 'handEnd': return this.later(TIMING.handPause, () => this.after(g.startHand()));
      case 'redeal': return this.later(TIMING.redealPause, () => this.after(g.startHand()));
      case 'gameOver': return;
    }
    const seat = g.turn;
    if (seat == null || seat < 0) return;
    const p = this.players[seat];
    if (!p) return;
    if (p.isBot) {
      const think = g.phase === 'widow' ? 1800 : rnd(TIMING.botMin, TIMING.botMax);
      return this.later(extra + think, () => this.botAct(seat));
    }
    if (!p.connected) return this.later(extra + TIMING.disconnectedTurn, () => this.botAct(seat, 'medium'));
    const t = extra + TIMING.turnTimeout;
    this.turnDeadline = Date.now() + t;
    this.later(t, () => this.botAct(seat, 'medium'));
  }

  botAct(seat, override) {
    const g = this.game;
    if (!g || g.turn !== seat) return;
    const level = override || this.players[seat].level || 'medium';
    let ev = null;
    const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error('AI error', e); return fallback(); } };
    switch (g.phase) {
      case 'chooseTrump':
        ev = g.chooseTrump(seat, safe(() => AI.chooseTrump(g.hands[seat], level), () => SUITS[0]));
        break;
      case 'bidding':
        ev = g.placeBid(seat, safe(() => AI.shelemBid(g, seat, level), () => 'pass'));
        break;
      case 'widow': {
        const d = safe(() => AI.shelemDiscard(g, seat, level), () => ({ cards: g.hands[seat].slice(0, 4), suit: SUITS[0] }));
        ev = g.discard(seat, d.cards, d.suit);
        break;
      }
      case 'playing': {
        let c = safe(() => AI.chooseCard(g, seat, level), () => null);
        const legal = legalCards(g.hands[seat], g.trick);
        if (!legal.includes(c)) c = legal[0];
        ev = g.play(seat, c);
        break;
      }
    }
    if (ev) this.after(ev);
  }

  /* ---------- ارسال وضعیت ---------- */
  viewFor(seat) {
    const me = this.players[seat];
    return {
      id: this.id, gameType: this.gameType, settings: this.settings, inviteLink: this.inviteLink,
      mySeat: seat, hostSeat: this.seatOf(this.hostUid), isHost: !!me && me.uid === this.hostUid,
      players: this.players.map((p) => (p ? { name: p.name, photo: p.photo || null, isBot: !!p.isBot, level: p.isBot ? p.level : null, connected: !!p.connected } : null)),
      turnDeadline: this.turnDeadline, now: Date.now(), gameNo: this.gameNo,
      g: this.game ? this.game.publicState(seat) : null,
    };
  }

  broadcast(events = []) {
    this.players.forEach((p, i) => {
      if (p && !p.isBot && p.conn && p.conn.readyState === 1) {
        try { p.conn.send(JSON.stringify({ t: 'state', room: this.viewFor(i), events })); } catch (e) { /* ignore */ }
      }
    });
  }

  destroy() {
    clearTimeout(this.timer);
    this.players.forEach((p) => p && clearTimeout(p.leaveTimer));
  }
}

module.exports = { Room, GameError, TIMING };
