// src/api/telegram.js
// Инкапсуляция всего взаимодействия с Telegram WebApp (TWA).
// Экспортирует объект tg и вспомогательные методы получения данных пользователя.

const tg = window.Telegram?.WebApp || {};

// Автоматически разворачиваем и сигнализируем о готовности
try { if (typeof tg.expand === 'function') tg.expand(); } catch (_) {}
try { if (typeof tg.ready  === 'function') tg.ready();  } catch (_) {}

/**
 * Объект Telegram WebApp (либо пустой {}, если запущено вне Telegram).
 * @type {object}
 */
export { tg };

/**
 * Данные пользователя из initDataUnsafe, или null если недоступны.
 * @returns {{ id: number, username?: string, first_name?: string, last_name?: string } | null}
 */
export function getTgUser() {
  return tg.initDataUnsafe?.user || null;
}

/**
 * Telegram user ID для авторизации в Firebase.
 * @returns {number | null}
 */
export function getTgUserId() {
  return tg.initDataUnsafe?.user?.id ?? null;
}

/**
 * Возвращает true если приложение запущено внутри Telegram.
 * @returns {boolean}
 */
export function isInsideTelegram() {
  return Boolean(window.Telegram?.WebApp?.initData);
}
