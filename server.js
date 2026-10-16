'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { webhookCallback } = require('grammy');
const { Room, GameError } = require('./game/room');
const { createBot, setupBotUi } = require('./bot');

/* ================= تنظیمات ================= */
const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
// روی Render متغیر RENDER_EXTERNAL_URL خودکار تنظیم می‌شود
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
const APP_SHORT_NAME = (process.env.APP_SHORT_NAME || '').trim();
const BOT_MODE = (process.env.BOT_MODE || (PUBLIC_URL.startsWith('https://') ? 'webhook' : 'polling')).toLowerCase();
const ALLOW_DEV_LOGIN = process.env.ALLOW_DEV_LOGIN === 'true' || !BOT_TOKEN;
const INIT_DATA_MAX_AGE = 3 * 24 * 3600; // ثانیه
const ROOM_IDLE_MS = 15 * 60 * 1000;

const state = { botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, '') };
const rooms = new Map();    // roomId -> Room
const userRoom = new Map(); // userId -> roomId

/* ================= Express ================= */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.get('/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.get('/api/config', (req, res) => res.json({ botUsername: state.botUsername, appShortName: APP_SHORT_NAME }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
}));

/* ================= ابزارها ================= */
function inviteLink(roomId) {
  if (state.botUsername && APP_SHORT_NAME) return `https://t.me/${state.botUsername}/${APP_SHORT_NAME}?startapp=${roomId}`;
  if (state.botUsername) return `https://t.me/${state.botUsername}?start=join_${roomId}`;
  return `${PUBLIC_URL || 'http://localhost:' + PORT}/?room=${roomId}`;
}

/** اعتبارسنجی initData طبق مستندات رسمی تلگرام */
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE) return null;
  let u;
  try { u = JSON.parse(params.get('user') || 'null'); } catch { return null; }
  if (!u || !u.id) return null;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.username || 'بازیکن';
  return { id: 'tg' + u.id, name: name.slice(0, 32), photo: u.photo_url || null };
}

function genRoomId() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do { id = Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join(''); } while (rooms.has(id));
  return id;
}

function currentRoom(uid) {
  const id = userRoom.get(uid);
  const r = id ? rooms.get(id) : null;
  if (id && !r) userRoom.delete(uid);
  return r || null;
}

function leaveCurrent(uid) {
  const r = currentRoom(uid);
  if (r) r.removeHuman(uid);
  userRoom.delete(uid);
}

const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

/* ================= WebSocket ================= */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.bucket = { t: Date.now(), n: 0 };
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    const now = Date.now();
    if (now - ws.bucket.t > 1000) ws.bucket = { t: now, n: 0 };
    if (++ws.bucket.n > 25) return; // ضد اسپم
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try {
      handle(ws, msg);
    } catch (e) {
      if (e instanceof GameError) send(ws, { t: 'error', msg: e.message });
      else { console.error(e); send(ws, { t: 'error', msg: 'خطای غیرمنتظره‌ای رخ داد' }); }
    }
  });
  ws.on('close', () => {
    if (!ws.user) return;
    const r = currentRoom(ws.user.id);
    if (r) r.detach(ws.user.id, ws);
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 25000);

function handle(ws, msg) {
  if (msg.t === 'auth') {
    let user = verifyInitData(msg.initData);
    if (!user && ALLOW_DEV_LOGIN && msg.dev && msg.dev.id) {
      user = { id: 'dev_' + String(msg.dev.id).replace(/[^\w]/g, '').slice(0, 16), name: String(msg.dev.name || 'مهمان').slice(0, 24), photo: null };
    }
    if (!user) return send(ws, { t: 'authFail', msg: 'لطفاً بازی را از داخل تلگرام باز کنید.' });
    ws.user = user;
    const r = currentRoom(user.id);
    send(ws, { t: 'hello', user, inRoom: !!r, config: { botUsername: state.botUsername, appShortName: APP_SHORT_NAME } });
    if (r) {
      try { r.attach(user, ws); } catch { userRoom.delete(user.id); }
    }
    return;
  }

  const user = ws.user;
  if (!user) throw new GameError('ابتدا وارد شوید');

  switch (msg.t) {
    case 'create': {
      leaveCurrent(user.id);
      const gameType = msg.game === 'shelem' ? 'shelem' : 'hokm';
      const level = ['easy', 'medium', 'hard'].includes(msg.level) ? msg.level : 'medium';
      const mode = msg.mode === 'online' ? 'online' : 'bots';
      const targets = gameType === 'hokm' ? [3, 5, 7] : [600, 1165];
      const target = targets.includes(Number(msg.target)) ? Number(msg.target) : gameType === 'hokm' ? 7 : 1165;
      const id = genRoomId();
      const room = new Room({ id, gameType, settings: { level, target, mode }, inviteLink: inviteLink(id) });
      rooms.set(id, room);
      room.attach(user, ws, { silent: true });
      userRoom.set(user.id, id);
      if (mode === 'bots') { room.fillBots(level); room.start(user.id); } else room.broadcast();
      return;
    }
    case 'join': {
      const id = String(msg.room || '').toUpperCase().replace(/^JOIN_/, '').replace(/[^A-Z0-9]/g, '');
      const room = rooms.get(id);
      if (!room) throw new GameError('میز پیدا نشد یا منقضی شده است');
      const cur = currentRoom(user.id);
      room.attach(user, ws);
      if (cur && cur !== room) cur.removeHuman(user.id);
      userRoom.set(user.id, id);
      return;
    }
    case 'leave':
      leaveCurrent(user.id);
      return send(ws, { t: 'left' });
    default: {
      const room = currentRoom(user.id);
      if (!room) throw new GameError('در هیچ میزی نیستی');
      room.handle(user.id, msg);
    }
  }
}

// پاک‌سازی میزهای بی‌استفاده
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (r.connectedHumans() > 0) { r.lastHumanSeen = now; continue; }
    if (now - r.lastHumanSeen > ROOM_IDLE_MS) {
      r.destroy();
      rooms.delete(id);
      for (const [u, rid] of userRoom) if (rid === id) userRoom.delete(u);
    }
  }
}, 60 * 1000);

/* ================= ربات تلگرام ================= */
async function startBot() {
  if (!BOT_TOKEN) {
    console.warn('⚠️  BOT_TOKEN تنظیم نشده؛ سرور بدون ربات و در حالت توسعه اجرا شد.');
    return;
  }
  const webAppUrl = PUBLIC_URL || `http://localhost:${PORT}`;
  const bot = createBot({ token: BOT_TOKEN, webAppUrl, appShortName: APP_SHORT_NAME, getBotUsername: () => state.botUsername });
  bot.catch((err) => console.error('Bot error:', err.error || err));
  await bot.init();
  state.botUsername = bot.botInfo.username;
  for (const r of rooms.values()) r.inviteLink = inviteLink(r.id);

  if (BOT_MODE === 'webhook') {
    if (!PUBLIC_URL.startsWith('https://')) throw new Error('حالت webhook به PUBLIC_URL با https نیاز دارد');
    const secret = crypto.createHash('sha256').update('wh:' + BOT_TOKEN).digest('hex').slice(0, 48);
    app.post(`/telegram/${secret}`, webhookCallback(bot, 'express', { secretToken: secret }));
    await bot.api.setWebhook(`${PUBLIC_URL}/telegram/${secret}`, {
      secret_token: secret,
      allowed_updates: ['message', 'callback_query', 'inline_query'],
    });
    console.log(`🤖 @${state.botUsername} در حالت webhook فعال شد`);
  } else {
    await bot.api.deleteWebhook();
    bot.start({ onStart: () => console.log(`🤖 @${state.botUsername} در حالت polling فعال شد`) });
  }
  await setupBotUi(bot, webAppUrl).catch((e) => console.warn('تنظیم منو ناموفق بود:', e.message));
}

server.listen(PORT, () => {
  console.log(`🃏 سرور روی پورت ${PORT} اجرا شد ${PUBLIC_URL ? '→ ' + PUBLIC_URL : ''}`);
  startBot().catch((e) => console.error('راه‌اندازی ربات ناموفق بود:', e.message));
});

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
