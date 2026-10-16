'use strict';
const { Bot, InlineKeyboard } = require('grammy');

const RULES_HOKM = `<b>📖 قوانین حکم</b>

• ۴ بازیکن در دو تیم؛ یارها روبه‌روی هم می‌نشینند.
• دست اول: کارت‌ها رو به بالا پخش می‌شود؛ اولین نفری که آس بیاورد <b>حاکم</b> است.
• حاکم با دیدن ۵ کارت اول، خال <b>حکم</b> را اعلام می‌کند و بقیه کارت‌ها پخش می‌شود.
• پیروی از خال زمین اجباری است. فقط وقتی آن خال را نداری می‌توانی <b>بُر بزنی</b> (حکم بیندازی).
• اولین تیمی که ۷ دست ببرد برنده آن دور است.

<b>امتیاز:</b> ۷ دست = ۱ | کُت (۷ به ۰) = ۲ | شلم (هر ۱۳ دست) = ۳
اگر تیم حاکم ببازد، حاکمی به نفر بعدی می‌رسد.`;

const RULES_SHELEM = `<b>📖 قوانین شلم</b>

• ۴ بازیکن در دو تیم؛ به هر نفر ۱۲ کارت و ۴ کارت وسط (خاک).
• <b>بید:</b> از ۱۰۰ تا ۱۶۵ با گام ۵. هر کس پاس بدهد دیگر نمی‌خواند.
• برنده بید (حاکم) ۴ کارت وسط را برمی‌دارد، ۴ کارت دور می‌ریزد و حکم را اعلام می‌کند.
• امتیاز کارت‌ها: آس و ده = ۱۰ | پنج = ۵ | هر دست = ۵ (مجموع ۱۶۵)
• کارت‌های دورریخته و ۵ امتیازش مال تیم حاکم است.
• اگر تیم حاکم به بید برسد، هر تیم امتیاز خودش را می‌گیرد؛ وگرنه تیم حاکم منفی بید می‌شود.
• <b>شلم کامل</b> (بردن همه دست‌ها): ۳۳۰+ | اعلام شلم (۱۶۵) و نرسیدن: ۳۳۰−`;

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function createBot({ token, webAppUrl, appShortName, getBotUsername }) {
  const bot = new Bot(token);
  const https = webAppUrl.startsWith('https://');

  const appUrl = (params = {}) => {
    const u = new URL(webAppUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  };

  const mainMenu = () => {
    const kb = new InlineKeyboard();
    if (https) {
      kb.webApp('🃏 بازی حکم', appUrl({ game: 'hokm' })).row()
        .webApp('♦️ بازی شلم', appUrl({ game: 'shelem' })).row()
        .webApp('🎴 باز کردن میز ورق', appUrl()).row();
    }
    kb.text('📖 قوانین حکم', 'rules:hokm').text('📖 قوانین شلم', 'rules:shelem');
    return kb;
  };

  const httpsWarning = '⚠️ آدرس مینی‌اپ باید HTTPS باشد. متغیر PUBLIC_URL را تنظیم کنید.';

  bot.command('start', async (ctx) => {
    const payload = (ctx.match || '').trim();
    const m = payload.match(/^join_([A-Za-z0-9]{4,10})$/);
    if (m) {
      const room = m[1].toUpperCase();
      if (!https) return ctx.reply(httpsWarning);
      return ctx.reply(`🎴 به میز <b>${room}</b> دعوت شدی!\nروی دکمه زیر بزن تا مستقیم وارد میز بشی 👇`, {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().webApp('🚪 ورود به میز', appUrl({ room })),
      });
    }
    const name = esc(ctx.from?.first_name || 'رفیق');
    await ctx.reply(
      `سلام ${name} 👋\nبه <b>میز ورق</b> خوش اومدی!\n\nحکم و شلم اصیل ایرانی، با دوستات یا با ربات‌ها.\nیکی از بازی‌ها رو انتخاب کن 👇${https ? '' : '\n\n' + httpsWarning}`,
      { parse_mode: 'HTML', reply_markup: mainMenu() },
    );
  });

  bot.command(['play', 'menu'], (ctx) => ctx.reply('🎴 بازی رو انتخاب کن:', { reply_markup: mainMenu() }));

  bot.command('help', (ctx) => ctx.reply(
    '🎴 <b>راهنما</b>\n\n/start منوی بازی‌ها\n/play شروع سریع\n\nداخل مینی‌اپ می‌توانی میز بسازی، لینک دعوت بفرستی یا با ربات‌ها (آسان/متوسط/سخت) بازی کنی.',
    { parse_mode: 'HTML', reply_markup: mainMenu() },
  ));

  bot.callbackQuery(/^rules:(hokm|shelem)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(ctx.match[1] === 'hokm' ? RULES_HOKM : RULES_SHELEM, { parse_mode: 'HTML' });
  });

  // اختیاری: دعوت با حالت inline (در BotFather با /setinline فعال کنید) → @botname ROOMID
  bot.on('inline_query', async (ctx) => {
    const m = ctx.inlineQuery.query.trim().toUpperCase().match(/([A-Z0-9]{6})/);
    const uname = getBotUsername();
    if (!m || !uname) return ctx.answerInlineQuery([], { cache_time: 5 });
    const room = m[1];
    const link = appShortName ? `https://t.me/${uname}/${appShortName}?startapp=${room}` : `https://t.me/${uname}?start=join_${room}`;
    await ctx.answerInlineQuery([{
      type: 'article',
      id: 'inv_' + room,
      title: `دعوت به میز ${room}`,
      description: 'بفرست تا دوستانت مستقیم وارد میز شوند',
      input_message_content: { message_text: `🃏 بیا با هم ورق بازی کنیم!\nکد میز: ${room}` },
      reply_markup: new InlineKeyboard().url('🚪 ورود به میز', link),
    }], { cache_time: 0, is_personal: true });
  });

  bot.on('message', (ctx) => ctx.reply('برای شروع روی دکمه زیر بزن 🎴', { reply_markup: mainMenu() }));

  return bot;
}

/** دستورها + دکمه Menu Button تلگرام */
async function setupBotUi(bot, webAppUrl) {
  await bot.api.setMyCommands([
    { command: 'start', description: 'منوی بازی‌ها' },
    { command: 'play', description: 'شروع بازی' },
    { command: 'help', description: 'راهنما' },
  ]);
  if (webAppUrl.startsWith('https://')) {
    await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: '🎴 بازی', web_app: { url: webAppUrl } } });
  }
}

module.exports = { createBot, setupBotUi };
