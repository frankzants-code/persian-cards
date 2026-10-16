/* میز ورق — کلاینت مینی‌اپ تلگرام */
(() => {
  'use strict';
  const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
  const inTelegram = !!(tg && tg.initData);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FA = '۰۱۲۳۴۵۶۷۸۹';
  const fa = (n) => String(n).replace(/\d/g, (d) => FA[d]).replace('-', '−');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_FA = { S: 'پیک', H: 'دل', D: 'خشت', C: 'گشنیز' };
  const RANK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const LEVEL_FA = { easy: 'آسان', medium: 'متوسط', hard: 'سخت' };
  const GAME_FA = { hokm: 'حکم', shelem: 'شلم' };
  const EMOJIS = ['👍', '😂', '😮', '😡', '🔥', '👏', '🙏', '😎', '😭', '🤝'];
  const REST_ROT = [0, 7, -3, -7];
  const suitOf = (c) => c[0];
  const rankOf = (c) => parseInt(c.slice(1), 10);
  const isRed = (s) => s === 'H' || s === 'D';
  const rankTxt = (r) => RANK_TXT[r] || String(r);

  const S = {
    ws: null, user: null, room: null, queue: [], busy: false, retry: 0, screen: 'loading',
    selected: null, discardSel: new Set(), bidValue: 100, bidHand: 0, sending: false,
    createGame: 'hokm', createOpts: { mode: 'bots', level: 'medium', target: 7 },
    pendingJoin: null, pendingGame: null, flyFrom: {}, resultTimer: null, lastTurnKey: '',
  };

  /* ================= تنظیمات ================= */
  const settings = Object.assign({ music: true, musicVol: 0.45, sfxVol: 0.85, haptics: true, oneTap: false },
    JSON.parse(localStorage.getItem('pc_settings') || '{}'));
  const saveSettings = () => { localStorage.setItem('pc_settings', JSON.stringify(settings)); Sound.apply(settings); };

  function haptic(kind) {
    if (!settings.haptics || !tg || !tg.HapticFeedback) return;
    try {
      if (['success', 'error', 'warning'].includes(kind)) tg.HapticFeedback.notificationOccurred(kind);
      else if (kind === 'select') tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.impactOccurred(kind || 'light');
    } catch (e) { /* ignore */ }
  }

  /* ================= تلگرام ================= */
  function initTelegram() {
    if (!tg) return;
    try { tg.ready(); tg.expand(); } catch (e) { /* */ }
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) { /* */ }
    try { tg.setHeaderColor('#0b1520'); tg.setBackgroundColor('#0b1520'); } catch (e) { /* */ }
    try { tg.setBottomBarColor && tg.setBottomBarColor('#0b1520'); } catch (e) { /* */ }
    try { tg.BackButton.onClick(onBack); } catch (e) { /* */ }
    try { tg.onEvent('viewportChanged', () => layoutHand()); } catch (e) { /* */ }
  }

  function getStartParams() {
    const q = new URLSearchParams(location.search);
    let room = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || q.get('tgWebAppStartParam') || q.get('room') || '';
    room = String(room).replace(/^join_/i, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const game = q.get('game');
    return { room: room || null, game: game === 'hokm' || game === 'shelem' ? game : null };
  }

  function devUser() {
    if (inTelegram) return null;
    let id = sessionStorage.getItem('pc_dev');
    if (!id) { id = Math.random().toString(36).slice(2, 8); sessionStorage.setItem('pc_dev', id); }
    return { id, name: 'مهمان ' + id.slice(-3).toUpperCase() };
  }

  /* ================= اتصال ================= */
  function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    S.ws = ws;
    ws.onopen = () => { S.retry = 0; send({ t: 'auth', initData: (tg && tg.initData) || '', dev: devUser() }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMessage(m); };
    ws.onclose = () => {
      S.ws = null;
      if (S.screen !== 'loading') $('#conn-badge').classList.add('on');
      setTimeout(connect, Math.min(800 * 2 ** S.retry++, 8000));
    };
  }
  const send = (o) => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(o)); };

  function onMessage(m) {
    switch (m.t) {
      case 'hello':
        $('#conn-badge').classList.remove('on');
        S.user = m.user; renderMe();
        if (S.pendingJoin) { send({ t: 'join', room: S.pendingJoin }); S.pendingJoin = null; return; }
        if (!m.inRoom) {
          S.room = null;
          showScreen('home');
          if (S.pendingGame) { openCreate(S.pendingGame); S.pendingGame = null; }
        }
        return;
      case 'state': S.queue.push(m); if (!S.busy) pump(); return;
      case 'left': S.room = null; resetTable(); hideResult(); showScreen('home'); return;
      case 'error':
        toast(m.msg); haptic('error');
        if (S.screen === 'loading') showScreen('home');
        S.sending = false; if (S.room && S.room.g) renderHand();
        return;
      case 'authFail':
        $('#loading-text').innerHTML = esc(m.msg) + '<br><small class="muted">این مینی‌اپ فقط داخل تلگرام کار می‌کند.</small>';
        $('.loader-cards').style.display = 'none';
        return;
    }
  }

  async function pump() {
    S.busy = true;
    while (S.queue.length) {
      const m = S.queue.shift();
      try { await processState(m.room, m.events || []); } catch (e) { console.error(e); }
    }
    S.busy = false;
  }

  /* ================= صفحه‌ها ================= */
  function showScreen(name) {
    if (S.screen === name) return;
    S.screen = name;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'scr-' + name));
    if (tg) {
      try { (name === 'lobby' || name === 'game') ? tg.BackButton.show() : tg.BackButton.hide(); } catch (e) { /* */ }
      try { name === 'game' ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation(); } catch (e) { /* */ }
    }
    if (name === 'game') requestAnimationFrame(layoutHand);
  }

  function onBack() {
    if ($('#sheet-create').classList.contains('open')) return closeCreate();
    const open = $('.modal.open'); if (open) return open.classList.remove('open');
    if (S.screen === 'lobby' || S.screen === 'game') confirmLeave();
  }
  function ask(msg, cb) {
    if (tg && tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) tg.showConfirm(msg, cb);
    else cb(window.confirm(msg));
  }
  function confirmLeave() {
    const g = S.room && S.room.g;
    const playing = g && g.phase !== 'gameOver';
    ask(playing ? 'از میز خارج می‌شوی؟ یک ربات جای تو بازی را ادامه می‌دهد.' : 'از میز خارج می‌شوی؟', (ok) => { if (ok) send({ t: 'leave' }); });
  }

  let toastTimer;
  function toast(text, ms = 2300) {
    const el = $('#toast'); el.textContent = text; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /* ================= آواتار و کارت ================= */
  const COLORS = [['#ff8a65', '#c2185b'], ['#4fc3f7', '#1565c0'], ['#81c784', '#2e7d32'], ['#ffd54f', '#ef6c00'], ['#ba68c8', '#4527a0'], ['#4db6ac', '#00695c']];
  function avatarHTML(p, extra = '') {
    if (!p) return `<div class="avatar empty ${extra}">+</div>`;
    if (p.photo) return `<div class="avatar ${extra}"><img src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer"></div>`;
    const name = String(p.name || '?').replace('🤖 ', '');
    let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [a, b] = COLORS[h % COLORS.length];
    const label = p.isBot ? '🤖' : esc([...name][0] || '?');
    return `<div class="avatar ${p.isBot ? 'bot' : ''} ${extra}" style="${p.isBot ? '' : `background:linear-gradient(135deg,${a},${b})`}">${label}</div>`;
  }
  function renderMe() {
    if (!S.user) return;
    $('#me-name').textContent = S.user.name;
    $('#me-avatar').outerHTML = avatarHTML(S.user, '').replace('class="avatar', 'id="me-avatar" class="avatar');
  }
  function cardHTML(c, cls = '') {
    const s = suitOf(c), r = rankOf(c), sym = SUIT_SYM[s], rt = rankTxt(r);
    const mid = r >= 11 && r <= 13 ? `<div class="face"><b>${rt}</b><i>${sym}</i></div>` : `<div class="pip">${sym}</div>`;
    return `<div class="card ${isRed(s) ? 'red' : ''} ${r === 14 ? 'ace' : ''} ${cls}" data-card="${c}"><div class="crn tl"><b>${rt}</b><i>${sym}</i></div>${mid}<div class="crn br"><b>${rt}</b><i>${sym}</i></div></div>`;
  }
  function cardEl(c, cls) { const d = document.createElement('div'); d.innerHTML = cardHTML(c, cls); return d.firstElementChild; }
  function sortCards(hand, trump) {
    let ord = ['S', 'H', 'C', 'D'];
    if (trump) { ord = ord.filter((s) => s !== trump); ord.unshift(trump); }
    return hand.slice().sort((a, b) => ord.indexOf(suitOf(a)) - ord.indexOf(suitOf(b)) || rankOf(b) - rankOf(a));
  }
  const relOf = (seat) => (seat - S.room.mySeat + 4) % 4;
  const seatEl = (rel) => $(`#scr-game .seat[data-rel="${rel}"]`);
  const shortName = (n) => { const s = String(n || '').replace('🤖 ', ''); return s.length > 12 ? s.slice(0, 11) + '…' : s; };
  const nameOf = (seat) => (seat === S.room.mySeat ? 'تو' : shortName(S.room.players[seat] && S.room.players[seat].name));

  /* ================= خانه / ساخت میز ================= */
  function openCreate(game) {
    S.createGame = game;
    S.createOpts.target = game === 'hokm' ? 7 : 1165;
    $('#cr-title').textContent = `میز ${GAME_FA[game]}`;
    const targets = game === 'hokm' ? [3, 5, 7] : [600, 1165];
    $('#cr-targets').innerHTML = targets.map((t) => `<button data-v="${t}" class="${t === S.createOpts.target ? 'on' : ''}">${fa(t)}</button>`).join('');
    syncSeg();
    $('#sheet-create').classList.add('open'); $('#sheet-back').classList.add('open');
    try { tg && tg.BackButton.show(); } catch (e) { /* */ }
  }
  function closeCreate() {
    $('#sheet-create').classList.remove('open'); $('#sheet-back').classList.remove('open');
    if (S.screen === 'home') try { tg && tg.BackButton.hide(); } catch (e) { /* */ }
  }
  function syncSeg() {
    $$('#sheet-create .seg').forEach((seg) => {
      const k = seg.dataset.opt;
      $$('button', seg).forEach((b) => b.classList.toggle('on', String(S.createOpts[k]) === b.dataset.v));
    });
    $('#cr-hint').textContent = S.createOpts.mode === 'bots'
      ? 'سه ربات کنار تو می‌نشینند و بازی فوراً شروع می‌شود.'
      : 'میز ساخته می‌شود و لینک دعوت می‌گیری. جاهای خالی را می‌توانی با ربات پر کنی.';
  }

  /* ================= لابی ================= */
  function renderLobby() {
    const r = S.room;
    $('#lb-title').textContent = 'میز ' + GAME_FA[r.gameType];
    $('#lb-meta').textContent = `ربات‌ها: ${LEVEL_FA[r.settings.level]} · پایان: ${fa(r.settings.target)} امتیاز`;
    $('#lb-code').textContent = r.id;
    $('#lb-game-sym').textContent = r.gameType === 'hokm' ? '♠' : '♦';
    for (let rel = 0; rel < 4; rel++) {
      const seat = (r.mySeat + rel) % 4, p = r.players[seat], el = $(`.lseat[data-rel="${rel}"]`);
      const team = rel % 2 === 0 ? '<span class="tag team-us">تیم ما</span>' : '<span class="tag team-them">حریف</span>';
      if (p) {
        const tags = [];
        if (seat === r.hostSeat) tags.push('👑 میزبان');
        if (p.isBot) tags.push('ربات ' + LEVEL_FA[p.level]);
        if (!p.isBot && !p.connected) tags.push('قطع');
        el.innerHTML = `${avatarHTML(p)}<div class="nm">${esc(rel === 0 ? p.name + ' (تو)' : p.name)}</div>${team}<span class="tag">${tags.join(' · ')}</span>
          ${r.isHost && p.isBot ? `<button class="mini" data-act="kick" data-seat="${seat}">✕ حذف</button>` : ''}
          ${!r.isHost && p.isBot ? `<button class="mini" data-act="sit" data-seat="${seat}">بنشین</button>` : ''}`;
      } else {
        el.innerHTML = `${avatarHTML(null)}<div class="nm muted">صندلی خالی</div>${team}<div class="row">
          ${r.isHost ? `<button class="mini gold" data-act="addBot" data-seat="${seat}">+ ربات</button>` : ''}
          <button class="mini" data-act="sit" data-seat="${seat}">بنشین</button></div>`;
      }
    }
    const full = r.players.every(Boolean);
    const humans = r.players.filter((p) => p && !p.isBot).length;
    const box = $('#lb-host-actions');
    if (r.isHost) {
      box.innerHTML = `<div class="seg" data-lobby-level>${['easy', 'medium', 'hard'].map((l) => `<button data-v="${l}" class="${r.settings.level === l ? 'on' : ''}">${LEVEL_FA[l]}</button>`).join('')}</div>
        ${full ? '' : '<button class="btn ghost" data-act="fillBots">🤖 پر کردن جاهای خالی با ربات</button>'}
        <button class="btn green big" data-act="start" ${full ? '' : 'disabled'}>▶️ شروع بازی</button>`;
      $('#lb-hint').textContent = full ? `${fa(humans)} بازیکن واقعی آماده‌اند.` : 'منتظر دوستانت بمان یا جاهای خالی را با ربات پر کن.';
    } else {
      box.innerHTML = '';
      $('#lb-hint').textContent = 'منتظر شروع بازی توسط میزبان… برای انتخاب تیم روی «بنشین» بزن.';
    }
  }

  /* ================= پردازش وضعیت ================= */
  async function processState(room, events) {
    const prev = S.room;
    const prevG = prev && prev.g;
    S.room = room;
    if (!room.g) { hideResult(); showScreen('lobby'); renderLobby(); return; }
    const g = room.g;
    const newGame = !prevG || prev.id !== room.id || prev.gameNo !== room.gameNo;
    const newHand = newGame || prevG.handNo !== g.handNo;
    if (S.screen !== 'game') { showScreen('game'); await sleep(30); }
    if (newHand) {
      S.discardSel.clear(); S.selected = null; S.sending = false; S.flyFrom = {};
      if (newGame) resetTable();
      hideResult();
    }

    const hs = events.find((e) => e.type === 'hakemSelect');
    if (hs) { renderChrome(); $('#hand').innerHTML = ''; await animHakemSelect(hs); }

    if (!newHand && prevG.trick.length === 4 && g.trick.length === 0) await animCollect(prevG.trickWinner);

    const dealing = events.some((e) => e.type === 'deal');
    render(dealing);
    S.sending = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'play': {
          if (ev.seat !== room.mySeat) Sound.card();
          if (ev.cut) cutEffect();
          break;
        }
        case 'deal': Sound.deal(ev.count || 5); break;
        case 'trump':
          banner(`<b class="${isRed(ev.suit) ? 'red' : ''}">${SUIT_SYM[ev.suit]}</b><span>حکم: ${SUIT_FA[ev.suit]}</span>`);
          Sound.trump(); haptic('medium');
          break;
        case 'bid': Sound.click(); break;
        case 'bidWon': toast(`👑 ${nameOf(ev.seat)} با ${fa(ev.bid)} حاکم شد`); break;
        case 'allPass': toast('همه پاس دادند؛ کارت‌ها دوباره پخش می‌شود'); break;
        case 'kotChase': toast(ev.team === room.mySeat % 2 ? '🔥 ۷ به ۰! حالا کُت یا شلم؟' : '😬 حریف ۷ به ۰ جلوست، حداقل یک دست بگیر!', 3000); break;
        case 'emoji': floatEmoji(ev.seat, ev.e); break;
        case 'handEnd': await sleep(350); showResult(ev); break;
      }
    }

    const turnKey = `${g.handNo}:${g.phase}:${g.turn}:${g.trick.length}`;
    if (g.turn === room.mySeat && turnKey !== S.lastTurnKey && ['playing', 'chooseTrump', 'bidding', 'widow'].includes(g.phase)) {
      Sound.turn(); haptic('light');
    }
    S.lastTurnKey = turnKey;
  }

  /* ================= رندر بازی ================= */
  function render(dealing) {
    renderChrome();
    renderTrick();
    renderHand(dealing);
    renderActions();
    renderTimer();
  }

  function renderChrome() {
    const r = S.room, g = r.g, me = r.mySeat, us = me % 2, them = 1 - us;
    const setScore = (id, v) => { const el = $(id); const t = fa(v); if (el.textContent !== t) { el.textContent = t; const p = el.parentElement; p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump'); } };
    setScore('#sc-us', g.scores[us]); setScore('#sc-them', g.scores[them]);
    $('#sc-game').textContent = GAME_FA[g.type];
    $('#sc-target').textContent = `تا ${fa(g.target)}`;

    // اطلاعات دست
    let info = '';
    if (g.type === 'hokm') {
      if (g.hakem != null) info += `👑 حاکم: <b>${esc(nameOf(g.hakem))}</b>`;
      if (g.phase !== 'chooseTrump' && g.tricks) info += ` · دست‌ها: <span class="us">ما ${fa(g.tricks[us])}</span> – <span class="them">${fa(g.tricks[them])} حریف</span>`;
    } else {
      if (g.phase === 'bidding') info = `🃏 پخش: <b>${esc(nameOf(g.dealer))}</b> · ${g.highBid ? `بالاترین: <b>${fa(g.highBid)}</b> (${esc(nameOf(g.highBidder))})` : 'هنوز کسی نخوانده'}`;
      else if (g.hakem >= 0) info = `👑 <b>${esc(nameOf(g.hakem))}</b> · بید <b>${fa(g.bid)}</b> · امتیاز: <span class="us">ما ${fa(g.points[us])}</span> – <span class="them">${fa(g.points[them])} حریف</span>`;
    }
    $('#hand-info').innerHTML = info;

    // حکم
    const tb = $('#trump-badge');
    if (g.trump) { tb.classList.add('on'); tb.innerHTML = `<b class="${isRed(g.trump) ? 'red' : ''}">${SUIT_SYM[g.trump]}</b><small>حکم ${SUIT_FA[g.trump]}</small>`; }
    else tb.classList.remove('on');

    // صندلی‌ها
    const active = ['playing', 'chooseTrump', 'bidding', 'widow'].includes(g.phase);
    for (let rel = 0; rel < 4; rel++) {
      const seat = (me + rel) % 4, p = r.players[seat], el = seatEl(rel);
      if (!p) { el.innerHTML = ''; continue; }
      el.classList.toggle('turn', active && g.turn === seat);
      let bubble = '';
      if (g.type === 'shelem' && g.phase === 'bidding' && g.bids && g.bids[seat] != null) {
        bubble = g.bids[seat] === 'pass' ? '<div class="bubble pass">پاس</div>' : `<div class="bubble">${fa(g.bids[seat])}</div>`;
      }
      const backs = rel ? `<div class="backs">${'<i></i>'.repeat(Math.min(g.counts[seat], 16))}</div>` : '';
      const dealer = g.type === 'shelem' && g.dealer === seat && g.phase === 'bidding' ? '<span class="dealer">پ</span>' : '';
      el.innerHTML = `<div class="av ${p.connected ? '' : 'off'}">${avatarHTML(p)}${g.hakem === seat && g.hakem >= 0 ? '<span class="crown">👑</span>' : ''}${dealer}</div>
        <div class="nm">${esc(rel === 0 ? 'تو' : shortName(p.name))}</div>${bubble}${backs}`;
    }

    // وضعیت
    let st = '';
    switch (g.phase) {
      case 'chooseTrump': st = g.hakem === me ? '' : `👑 ${nameOf(g.hakem)} در حال انتخاب حکم…`; break;
      case 'bidding': st = g.turn === me ? '' : `🗣️ نوبت خواندن ${nameOf(g.turn)}`; break;
      case 'widow': st = g.hakem === me ? '' : `${nameOf(g.hakem)} در حال برداشتن خاک…`; break;
      case 'playing': st = g.turn === me ? 'نوبت توئه 🎯' : ''; break;
      case 'trickEnd': st = `✨ دست برای ${nameOf(g.trickWinner)}`; break;
      case 'redeal': st = 'دوباره پخش می‌شود…'; break;
    }
    const se = $('#status'); se.textContent = st; se.classList.toggle('on', !!st);
  }

  function centerOf(el) { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width }; }
  function sourceFor(rel, card) {
    if (rel === 0 && S.flyFrom[card]) return S.flyFrom[card];
    const el = seatEl(rel); const av = el && el.querySelector('.av');
    return centerOf(av || el || $('#table'));
  }
  function flyIn(el, from, rel) {
    const to = centerOf(el);
    const sc = Math.max(0.45, Math.min(1.3, from.w / to.w));
    el.style.transition = 'none';
    el.style.transform = `translate(${from.x - to.x}px,${from.y - to.y}px) scale(${sc}) rotate(${rel === 0 ? 0 : 90 + Math.random() * 40}deg)`;
    void el.offsetWidth;
    el.style.transition = 'transform .34s cubic-bezier(.2,.85,.25,1)';
    el.style.transform = `rotate(${REST_ROT[rel]}deg)`;
  }

  function renderTrick() {
    const g = S.room.g, box = $('#trick');
    const want = g.trick.map((t) => t.card);
    $$('.tcard', box).forEach((el) => { if (!want.includes(el.dataset.card)) el.remove(); });
    g.trick.forEach((t, i) => {
      let el = box.querySelector(`[data-card="${t.card}"]`);
      const rel = relOf(t.seat);
      if (!el) {
        el = cardEl(t.card, 'tcard');
        el.dataset.rel = rel; el.style.zIndex = i + 1;
        box.appendChild(el);
        flyIn(el, sourceFor(rel, t.card), rel);
        if (t.seat === S.room.mySeat) Sound.card();
      }
      el.classList.toggle('win', g.phase === 'trickEnd' && g.trickWinner === t.seat);
    });
  }

  async function animCollect(winner) {
    const els = $$('#trick .tcard');
    if (!els.length || winner == null) return;
    await sleep(80);
    const target = sourceFor(relOf(winner));
    els.forEach((el) => {
      const c = centerOf(el);
      el.classList.remove('win');
      el.style.transition = 'transform .42s cubic-bezier(.5,0,.75,0), opacity .42s';
      el.style.transform = `translate(${target.x - c.x}px,${target.y - c.y}px) scale(.35) rotate(${Math.random() * 60 - 30}deg)`;
      el.style.opacity = '0';
    });
    Sound.collect();
    await sleep(430);
    els.forEach((el) => el.remove());
  }

  function resetTable() { $('#trick').innerHTML = ''; $('#hand').innerHTML = ''; $('#fx').innerHTML = ''; }

  /* ---------- دست من ---------- */
  function handMode() {
    const r = S.room, g = r.g, me = r.mySeat;
    if (g.type === 'shelem' && g.phase === 'widow' && g.hakem === me) return 'discard';
    if (g.phase === 'playing' && g.turn === me) return 'play';
    return 'idle';
  }

  function renderHand(dealing) {
    const g = S.room.g, box = $('#hand');
    const hand = sortCards(g.hand || [], g.trump);
    const mode = handMode();
    const legal = new Set(g.legal || []);
    const widow = new Set(g.widow || []);
    const existing = {};
    $$('.hc', box).forEach((el) => { existing[el.dataset.card] = el; });
    Object.keys(existing).forEach((c) => { if (!hand.includes(c)) existing[c].remove(); });
    let fresh = 0;
    hand.forEach((c) => {
      let el = existing[c];
      if (!el) {
        el = document.createElement('div');
        el.className = 'hc'; el.dataset.card = c; el.innerHTML = cardHTML(c);
        if (dealing) {
          el.classList.add('deal'); el.firstElementChild.style.animationDelay = `${fresh * 45}ms`; fresh++;
          el.firstElementChild.addEventListener('animationend', () => el.classList.remove('deal'), { once: true });
        }
        box.appendChild(el);
      }
      el.classList.toggle('playable', mode === 'play' && legal.has(c));
      el.classList.toggle('disabled', mode === 'play' && !legal.has(c));
      el.classList.toggle('sel', (mode === 'play' && S.selected === c) || (mode === 'discard' && S.discardSel.has(c)));
      el.classList.toggle('widow', mode === 'discard' && widow.has(c));
      el.classList.remove('gone');
    });
    if (mode !== 'play') S.selected = null;
    hand.forEach((c, i) => { const el = box.querySelector(`.hc[data-card="${c}"]`); if (el) el.dataset.i = String(i); });
    layoutHand();
  }

  function layoutHand() {
    const box = $('#hand');
    if (!box) return;
    const els = $$('.hc', box).filter((e) => !e.classList.contains('gone')).sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i));
    const n = els.length; if (!n) return;
    const W = box.clientWidth || window.innerWidth;
    const cw = els[0].firstElementChild.offsetWidth || 60;
    const step = n > 1 ? Math.min(cw * 0.7, (W - cw - 12) / (n - 1)) : 0;
    const total = cw + step * (n - 1), start = (W - total) / 2, mid = (n - 1) / 2;
    const spread = n > 12 ? 1.4 : 2.2;
    els.forEach((el, i) => {
      const off = i - mid;
      let y = Math.abs(off) * Math.abs(off) * (n > 12 ? 0.25 : 0.4);
      if (el.classList.contains('sel')) y -= 22;
      el.style.transform = `translate(${start + i * step}px,${y}px) rotate(${off * spread}deg)`;
      el.style.zIndex = String(i + 1);
    });
  }

  function onHandTap(card, el) {
    const g = S.room && S.room.g; if (!g || S.sending) return;
    const mode = handMode();
    if (mode === 'discard') {
      if (S.discardSel.has(card)) S.discardSel.delete(card);
      else if (S.discardSel.size < 4) S.discardSel.add(card);
      else { toast('فقط ۴ کارت'); return; }
      Sound.click(); haptic('select');
      renderHand(); renderActions();
      return;
    }
    if (mode !== 'play') {
      if (g.phase === 'playing') toast('صبر کن، نوبت تو نیست');
      return;
    }
    if (!(g.legal || []).includes(card)) {
      const lead = g.trick[0] && suitOf(g.trick[0].card);
      toast(lead ? `باید ${SUIT_FA[lead]} ${SUIT_SYM[lead]} بازی کنی` : 'این کارت مجاز نیست');
      haptic('error');
      return;
    }
    if (settings.oneTap || S.selected === card) {
      S.flyFrom[card] = centerOf(el.firstElementChild);
      el.classList.add('gone');
      S.sending = true; S.selected = null;
      send({ t: 'play', card });
      haptic('medium');
      layoutHand();
      return;
    }
    S.selected = card; haptic('select'); renderHand();
  }

  /* ---------- اکشن‌ها ---------- */
  function suitButtons(act, disabled) {
    return `<div class="suit-row">${SUITS.map((s) => `<button class="suit-btn ${isRed(s) ? 'red' : ''}" data-act="${act}" data-suit="${s}" ${disabled ? 'disabled' : ''}><span>${SUIT_SYM[s]}</span><small>${SUIT_FA[s]}</small></button>`).join('')}</div>`;
  }
  function renderActions() {
    const r = S.room, g = r.g, me = r.mySeat, box = $('#actions');
    let html = '';
    if (g.type === 'hokm' && g.phase === 'chooseTrump' && g.hakem === me) {
      html = `<div class="act-title">👑 تو حاکمی! با دیدن این ۵ کارت، خال حکم را انتخاب کن</div>${suitButtons('trump')}`;
    } else if (g.type === 'shelem' && g.phase === 'bidding' && g.turn === me) {
      if (S.bidHand !== g.handNo || S.bidValue < g.minBid) { S.bidValue = g.minBid; S.bidHand = g.handNo; }
      html = `<div class="act-title">${g.highBid ? `بالاترین خوانده: ${fa(g.highBid)} (${esc(nameOf(g.highBidder))})` : 'اولین خواندن از ۱۰۰ شروع می‌شود'}</div>
        <div class="bid-row"><button class="btn ghost" data-act="pass">پاس</button>
        <button class="round" data-act="bid-dec">−</button><div class="bid-val">${fa(S.bidValue)}</div><button class="round" data-act="bid-inc">+</button>
        <button class="btn" data-act="bid">بخوان</button></div>
        ${g.minBid <= 165 ? '<button class="chip" data-act="bid-max">🔥 اعلام شلم (۱۶۵)</button>' : ''}`;
    } else if (g.type === 'shelem' && g.phase === 'widow' && g.hakem === me) {
      const n = S.discardSel.size;
      html = `<div class="act-title">${n < 4 ? `۴ کارت برای دور ریختن انتخاب کن (${fa(n)} از ۴) · نقطه نارنجی = کارت‌های خاک` : 'حالا خال حکم را انتخاب کن 👇'}</div>${suitButtons('discard', n !== 4)}`;
    }
    box.innerHTML = html;
    box.classList.toggle('open', !!html);
    requestAnimationFrame(layoutHand);
  }

  function renderTimer() {
    const r = S.room, g = r.g, t = $('#timer'), bar = t.firstElementChild;
    const mine = r.turnDeadline && g.turn === r.mySeat;
    t.classList.toggle('on', !!mine);
    if (!mine) return;
    const left = Math.max(0, r.turnDeadline - r.now);
    const pct = Math.min(100, (left / 45000) * 100);
    bar.style.transition = 'none'; bar.style.width = pct + '%'; void bar.offsetWidth;
    bar.style.transition = `width ${left}ms linear`; bar.style.width = '0%';
  }

  /* ================= انیمیشن‌ها و افکت‌ها ================= */
  async function animHakemSelect(ev) {
    const fx = $('#fx'), table = $('#table').getBoundingClientRect();
    toast('🂡 تعیین حاکم: اولین آس…', 2000);
    const els = [];
    for (let i = 0; i < ev.seq.length; i++) {
      const { seat, card } = ev.seq[i];
      const el = cardEl(card, 'fly');
      fx.appendChild(el); els.push(el);
      const c = centerOf(el), t = sourceFor(relOf(seat));
      const k = 0.55;
      void el.offsetWidth;
      el.style.transform = `translate(${(t.x - c.x) * k + (Math.random() * 10 - 5)}px,${(t.y - c.y) * k}px) rotate(${Math.random() * 30 - 15}deg)`;
      Sound.card();
      if (rankOf(card) === 14) el.classList.add('ace');
      await sleep(300);
    }
    toast(`👑 ${nameOf(ev.hakem)} حاکم شد!`, 1800);
    haptic('success');
    await sleep(1200);
    els.forEach((el) => { el.style.opacity = '0'; });
    await sleep(320);
    fx.innerHTML = '';
    void table;
  }

  function cutEffect() {
    Sound.cut(); haptic('heavy');
    setTimeout(() => haptic('heavy'), 90);
    const table = $('#table');
    table.classList.remove('shake', 'flash'); void table.offsetWidth; table.classList.add('shake', 'flash');
    const svg = $('#crack');
    const cx = 200 + (Math.random() * 40 - 20), cy = 200 + (Math.random() * 40 - 20);
    let paths = '';
    const rays = 8 + Math.floor(Math.random() * 4);
    for (let i = 0; i < rays; i++) {
      const ang = (Math.PI * 2 * i) / rays + Math.random() * 0.4;
      let x = cx, y = cy, d = `M${x.toFixed(1)},${y.toFixed(1)}`;
      const segs = 4 + Math.floor(Math.random() * 3);
      for (let s = 0; s < segs; s++) {
        const len = 22 + Math.random() * 34, a = ang + (Math.random() - 0.5) * 0.9;
        x += Math.cos(a) * len; y += Math.sin(a) * len; d += ` L${x.toFixed(1)},${y.toFixed(1)}`;
        if (Math.random() < 0.35) {
          const ba = a + (Math.random() < 0.5 ? 0.8 : -0.8), bl = 14 + Math.random() * 20;
          paths += `<path d="M${x.toFixed(1)},${y.toFixed(1)} L${(x + Math.cos(ba) * bl).toFixed(1)},${(y + Math.sin(ba) * bl).toFixed(1)}" stroke-width="1.2"/>`;
        }
      }
      paths += `<path d="${d}" stroke-width="${(2.6 - i * 0.08).toFixed(2)}"/>`;
    }
    const ring = [];
    for (let i = 0; i < 10; i++) { const a = (Math.PI * 2 * i) / 10; const rr = 26 + Math.random() * 10; ring.push(`${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`); }
    paths += `<path d="M${ring.join(' L')} Z" stroke-width="1.4"/>`;
    svg.innerHTML = paths;
    svg.classList.remove('show'); void svg.getBoundingClientRect(); svg.classList.add('show');
    const tx = $('#cut-text'); tx.classList.remove('show'); void tx.offsetWidth; tx.classList.add('show');
    $$('#trick .tcard').forEach((el) => { el.classList.remove('cut'); void el.offsetWidth; });
  }

  function banner(html) {
    const b = document.createElement('div'); b.className = 'banner'; b.innerHTML = html;
    $('#fx').appendChild(b); setTimeout(() => b.remove(), 2000);
  }

  function floatEmoji(seat, e) {
    const table = $('#table').getBoundingClientRect();
    const c = sourceFor(relOf(seat));
    const el = document.createElement('div'); el.className = 'emo-float'; el.textContent = e;
    el.style.left = Math.max(20, Math.min(table.width - 20, c.x - table.left)) + 'px';
    el.style.top = Math.max(30, Math.min(table.height - 10, c.y - table.top)) + 'px';
    $('#fx').appendChild(el); setTimeout(() => el.remove(), 2100);
    if (seat !== S.room.mySeat) Sound.click();
  }

  /* ================= نتیجه ================= */
  function showResult(ev) {
    const r = S.room, g = r.g, us = r.mySeat % 2, them = 1 - us;
    let good, title, body = '';
    if (g.type === 'hokm') {
      good = ev.team === us;
      const kinds = { normal: '۱ امتیاز', kot: '💥 کُت! ۲ امتیاز', shlem: '🔥 شلم! ۳ امتیاز' };
      title = good ? 'این دور مال ما شد!' : 'این دور را باختیم';
      body = `${kinds[ev.kind]} برای ${good ? 'تیم ما' : 'تیم حریف'}<br>دست‌ها: ما ${fa(ev.tricks[us])} – ${fa(ev.tricks[them])} حریف`;
    } else {
      const ht = ev.hakem % 2, hakemUs = ht === us;
      const success = ev.kind === 'made' || ev.kind === 'shelem';
      good = hakemUs ? success : !success;
      const who = esc(nameOf(ev.hakem));
      const kinds = {
        made: `✅ ${who} ${fa(ev.bid)} خواند و ${fa(ev.points[ht])} گرفت`,
        failed: `❌ ${who} ${fa(ev.bid)} خواند ولی ${fa(ev.points[ht])} گرفت`,
        shelem: `🔥 شلم کامل! همه دست‌ها برای تیم ${who}`,
        shelemFail: `❌ شلم اعلام‌شده نرسید (${fa(ev.points[ht])})`,
      };
      title = good ? 'دور خوبی بود!' : 'این دور به ضرر ما شد';
      const sign = (v) => (v > 0 ? '+' : '') + fa(v);
      body = `${kinds[ev.kind]}<br>این دور: ما ${sign(ev.delta[us])} · حریف ${sign(ev.delta[them])}`;
    }
    let emoji = good ? '🎉' : '😔', actions = '';
    if (ev.gameOver) {
      const won = g.winner === us;
      title = won ? 'برنده شدید! 🏆' : 'بازی را باختید';
      emoji = won ? '🏆' : '🥲';
      actions = (r.isHost ? '<button class="btn green big" data-act="rematch">🔁 بازی دوباره</button>' : '<p class="muted small">منتظر میزبان برای بازی دوباره…</p>') +
        '<button class="btn ghost" data-act="leave-now">🏠 بازگشت به خانه</button>';
      won ? Sound.win() : Sound.lose(); haptic(won ? 'success' : 'warning');
    } else { good ? Sound.win() : Sound.lose(); haptic(good ? 'success' : 'warning'); }
    $('#res-emoji').textContent = emoji;
    $('#res-title').textContent = title;
    $('#res-body').innerHTML = body;
    $('#res-scores').innerHTML = `<div><small>ما</small><b style="color:#7fe0b0">${fa(ev.scores[us])}</b></div><div><small>حریف</small><b style="color:#ff9e86">${fa(ev.scores[them])}</b></div>`;
    $('#res-actions').innerHTML = actions;
    $('#result').classList.add('show');
    clearTimeout(S.resultTimer);
    if (!ev.gameOver) S.resultTimer = setTimeout(hideResult, 4600);
  }
  function hideResult() { clearTimeout(S.resultTimer); $('#result').classList.remove('show'); }

  /* ================= اشتراک‌گذاری ================= */
  function copyText(text) {
    const done = () => { toast('📋 لینک دعوت کپی شد'); haptic('success'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
    function fallback() { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast(text, 5000); } ta.remove(); }
  }
  function shareInvite() {
    const r = S.room; if (!r) return;
    const text = `🃏 بیا با هم ${GAME_FA[r.gameType]} بازی کنیم! کد میز: ${r.id}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(r.inviteLink)}&text=${encodeURIComponent(text)}`;
    if (tg && tg.openTelegramLink && inTelegram) tg.openTelegramLink(url);
    else if (navigator.share) navigator.share({ title: 'میز ورق', text, url: r.inviteLink }).catch(() => copyText(r.inviteLink));
    else copyText(r.inviteLink);
  }

  /* ================= رویدادها ================= */
  function bindUI() {
    document.addEventListener('pointerdown', () => { Sound.init(); Sound.apply(settings); }, { passive: true });

    $$('.game-card').forEach((b) => b.addEventListener('click', () => { Sound.click(); haptic('light'); openCreate(b.dataset.game); }));
    $('#sheet-back').addEventListener('click', closeCreate);
    $('#sheet-create').addEventListener('click', (e) => {
      const b = e.target.closest('.seg button'); if (!b) return;
      const k = b.parentElement.dataset.opt;
      S.createOpts[k] = k === 'target' ? Number(b.dataset.v) : b.dataset.v;
      Sound.click(); haptic('select'); syncSeg();
    });
    $('#btn-create').addEventListener('click', () => {
      send({ t: 'create', game: S.createGame, ...S.createOpts });
      closeCreate(); haptic('medium');
      $('#loading-text').textContent = 'در حال چیدن میز…'; showScreen('loading');
    });
    const join = () => {
      const code = $('#join-code').value.trim().toUpperCase();
      if (code.length < 4) return toast('کد میز را وارد کن');
      send({ t: 'join', room: code }); $('#join-code').blur();
    };
    $('#btn-join').addEventListener('click', join);
    $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

    document.addEventListener('click', (e) => {
      const op = e.target.closest('[data-open]');
      if (op) { $('#modal-' + op.dataset.open).classList.add('open'); Sound.click(); return; }
      if (e.target.closest('[data-close]') || e.target.classList.contains('modal')) { const m = e.target.closest('.modal'); if (m) m.classList.remove('open'); return; }
      const a = e.target.closest('[data-act]'); if (!a) return;
      const act = a.dataset.act, seat = a.dataset.seat != null ? Number(a.dataset.seat) : null;
      Sound.click();
      switch (act) {
        case 'leave': confirmLeave(); break;
        case 'leave-now': hideResult(); send({ t: 'leave' }); break;
        case 'copy': copyText(S.room.inviteLink); break;
        case 'share': shareInvite(); break;
        case 'addBot': send({ t: 'addBot', seat }); break;
        case 'kick': send({ t: 'kick', seat }); break;
        case 'sit': send({ t: 'sit', seat }); break;
        case 'fillBots': send({ t: 'fillBots' }); break;
        case 'start': send({ t: 'start' }); haptic('medium'); break;
        case 'rematch': hideResult(); send({ t: 'rematch' }); break;
        case 'trump': send({ t: 'trump', suit: a.dataset.suit }); $('#actions').classList.remove('open'); break;
        case 'pass': send({ t: 'bid', value: 'pass' }); $('#actions').classList.remove('open'); break;
        case 'bid': send({ t: 'bid', value: S.bidValue }); $('#actions').classList.remove('open'); break;
        case 'bid-max': send({ t: 'bid', value: 165 }); $('#actions').classList.remove('open'); break;
        case 'bid-inc': S.bidValue = Math.min(165, S.bidValue + 5); renderActions(); haptic('select'); break;
        case 'bid-dec': S.bidValue = Math.max(S.room.g.minBid, S.bidValue - 5); renderActions(); haptic('select'); break;
        case 'discard':
          if (S.discardSel.size !== 4) return toast('اول ۴ کارت انتخاب کن');
          send({ t: 'discard', cards: [...S.discardSel], suit: a.dataset.suit });
          S.discardSel.clear(); $('#actions').classList.remove('open');
          break;
      }
    });

    $('#scr-lobby').addEventListener('click', (e) => {
      const b = e.target.closest('[data-lobby-level] button'); if (!b) return;
      send({ t: 'level', level: b.dataset.v });
    });

    $('#hand').addEventListener('click', (e) => {
      const hc = e.target.closest('.hc'); if (!hc || hc.classList.contains('gone')) return;
      onHandTap(hc.dataset.card, hc);
    });

    const pop = $('#emoji-pop');
    pop.innerHTML = EMOJIS.map((x) => `<button data-e="${x}">${x}</button>`).join('');
    $('#emoji-btn').addEventListener('click', () => pop.classList.toggle('open'));
    pop.addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (!b) return; send({ t: 'emoji', e: b.dataset.e }); pop.classList.remove('open'); });

    // تنظیمات
    const m = $('#set-music'), mv = $('#set-music-vol'), sv = $('#set-sfx-vol'), hp = $('#set-haptics'), ot = $('#set-onetap');
    m.checked = settings.music; mv.value = settings.musicVol; sv.value = settings.sfxVol; hp.checked = settings.haptics; ot.checked = settings.oneTap;
    m.addEventListener('change', () => { settings.music = m.checked; saveSettings(); });
    mv.addEventListener('input', () => { settings.musicVol = Number(mv.value); saveSettings(); });
    sv.addEventListener('input', () => { settings.sfxVol = Number(sv.value); saveSettings(); });
    sv.addEventListener('change', () => Sound.card());
    hp.addEventListener('change', () => { settings.haptics = hp.checked; saveSettings(); haptic('medium'); });
    ot.addEventListener('change', () => { settings.oneTap = ot.checked; saveSettings(); });

    window.addEventListener('resize', layoutHand);
  }

  /* ================= شروع ================= */
  function boot() {
    initTelegram();
    bindUI();
    const sp = getStartParams();
    S.pendingJoin = sp.room;
    S.pendingGame = sp.game;
    Sound.s = settings;
    connect();
  }
  boot();
})();
