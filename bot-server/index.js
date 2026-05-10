// bot-server/index.js
// Telegram Bot — Telegraf + Inline-кнопка для запуска Mini App
// Запуск: node index.js  (или pm2 start index.js --name il-bot)

'use strict';

const { Telegraf, Markup } = require('telegraf');

// ── Config ──────────────────────────────────────────────────────
const BOT_TOKEN    = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://il-trade.web.app';

if (!BOT_TOKEN) {
  console.error('[Bot] FATAL: BOT_TOKEN env variable is not set');
  process.exit(1);
}

// ── Bot instance ────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

// ── Middleware: error handler ───────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`[Bot] Error for ${ctx.updateType}:`, err.message ?? err);
});

// ── /start ──────────────────────────────────────────────────────
bot.start(async ctx => {
  try {
    const firstName = ctx.from?.first_name || 'трейдер';
    await ctx.replyWithHTML(
      `👋 Привет, <b>${firstName}</b>!\n\n` +
      `📓 <b>IL-Trading Journal PRO+</b> — твой персональный торговый журнал.\n\n` +
      `Нажми кнопку ниже, чтобы открыть приложение 👇`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📊 Открыть журнал', MINI_APP_URL)
      ])
    );
  } catch (e) {
    console.error('[/start]', e.message);
  }
});

// ── /help ───────────────────────────────────────────────────────
bot.help(async ctx => {
  try {
    await ctx.replyWithHTML(
      `<b>IL-Trading Journal — Команды</b>\n\n` +
      `/start — Открыть торговый журнал\n` +
      `/help  — Список команд\n` +
      `/stats — Краткая статистика\n`
    );
  } catch (e) {
    console.error('[/help]', e.message);
  }
});

// ── /stats (пример — данные из Firebase через Admin SDK если нужно) ─
bot.command('stats', async ctx => {
  try {
    await ctx.replyWithHTML(
      `📈 <b>Статистика</b>\n\n` +
      `Откройте приложение для просмотра подробной статистики:`,
      Markup.inlineKeyboard([
        Markup.button.webApp('📊 Открыть журнал', MINI_APP_URL)
      ])
    );
  } catch (e) {
    console.error('[/stats]', e.message);
  }
});

// ── Inline query (на случай если бот добавлен в inline-режим) ──
bot.on('inline_query', async ctx => {
  try {
    await ctx.answerInlineQuery([], {
      switch_pm_text: '📊 Открыть журнал',
      switch_pm_parameter: 'open'
    });
  } catch (e) {
    console.error('[inline_query]', e.message);
  }
});

// ── Launch + Graceful Shutdown ──────────────────────────────────
async function main() {
  try {
    await bot.launch();
    console.log('[Bot] ✅ IL-Trading Journal bot started');
    console.log(`[Bot] Mini App URL: ${MINI_APP_URL}`);
  } catch (e) {
    console.error('[Bot] Failed to start:', e.message);
    process.exit(1);
  }
}

function shutdown(signal) {
  console.log(`[Bot] ${signal} received — shutting down gracefully...`);
  bot.stop(signal);
  process.exit(0);
}

process.once('SIGINT',  () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[Bot] Unhandled rejection:', reason);
});

main();
