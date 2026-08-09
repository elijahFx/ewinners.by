import { sendTelegram } from './notify.js';

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';

function apiUrl(method) {
  return `https://api.telegram.org/bot${token()}/${method}`;
}

export async function telegramApi(method, body) {
  if (!token()) throw new Error('TELEGRAM_BOT_TOKEN не задан');
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    throw new Error(data.description || `Telegram API ${method} failed`);
  }
  return data.result;
}

function welcomeText(chatId) {
  return (
    `<b>E-Winners</b>\n\n` +
    `Бот подключён.\n` +
    `Ваш <b>Chat ID</b>:\n<code>${chatId}</code>\n\n` +
    `Скопируйте его в личный кабинет:\n` +
    `• клиент — Уведомления\n` +
    `• админ — Безопасность (2FA)\n\n` +
    `Коды входа и уведомления будут приходить сюда.`
  );
}

export async function handleTelegramUpdate(update) {
  const message = update?.message || update?.edited_message;
  if (!message?.chat?.id) return;

  const chatId = message.chat.id;
  const text = String(message.text || '').trim();
  const isStart = text === '/start' || text.startsWith('/start@') || text.startsWith('/start ');

  if (isStart || text === '/chatid' || text === '/id') {
    await sendTelegram({ chatId, text: welcomeText(chatId) });
    return;
  }

  if (text) {
    await sendTelegram({
      chatId,
      text:
        `Ваш Chat ID: <code>${chatId}</code>\n` +
        `Команды: /start — приветствие и Chat ID`,
    });
  }
}

let polling = false;
let offset = 0;

async function pollOnce() {
  const result = await telegramApi('getUpdates', {
    offset,
    timeout: 25,
    allowed_updates: ['message'],
  });
  for (const update of result || []) {
    offset = update.update_id + 1;
    try {
      await handleTelegramUpdate(update);
    } catch (err) {
      console.warn('Telegram update error:', err.message);
    }
  }
}

export async function startTelegramBot() {
  if (!token()) {
    console.warn('Telegram bot: TELEGRAM_BOT_TOKEN не задан');
    return;
  }

  const webhookUrl = String(process.env.TELEGRAM_WEBHOOK_URL || '').trim();

  try {
    if (webhookUrl) {
      await telegramApi('deleteWebhook', { drop_pending_updates: false });
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET || undefined;
      await telegramApi('setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message'],
        drop_pending_updates: false,
        ...(secret ? { secret_token: secret } : {}),
      });
      console.log('Telegram bot: webhook →', webhookUrl);
      return;
    }

    // Long polling by default (бот отвечает на /start без отдельного webhook)
    await telegramApi('deleteWebhook', { drop_pending_updates: false });
    console.log('Telegram bot: long polling started');
    polling = true;
    const loop = async () => {
      while (polling) {
        try {
          await pollOnce();
        } catch (err) {
          console.warn('Telegram poll error:', err.message);
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    };
    loop();
  } catch (err) {
    console.error('Telegram bot start failed:', err.message);
  }
}

export function stopTelegramBot() {
  polling = false;
}
