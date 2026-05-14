/**
 * src/alerts/telegram.js
 * Cliente para Telegram Bot API.
 */

import { childLogger } from '../utils/logger.js';

const log = childLogger({ module: 'telegram' });
const BASE = 'https://api.telegram.org/bot';

export class TelegramClient {
  /**
   * @param {string} token - Bot token.
   * @param {string} chatId - Chat ID de destino.
   */
  constructor(token, chatId) {
    this.token = token;
    this.chatId = chatId;
    this._url = `${BASE}${token}/sendMessage`;
  }

  /**
   * Envía un mensaje HTML a Telegram.
   * @param {string} text
   * @returns {Promise<boolean>} true si fue exitoso
   */
  async send(text) {
    try {
      const res = await fetch(this._url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      if (!data.ok) {
        log.warn({ err: data.description }, 'Telegram error');
        return false;
      }
      return true;
    } catch (err) {
      log.error({ err: err.message }, 'Telegram request fallido');
      return false;
    }
  }
}
