/**
 * scripts/test-telegram.js
 * Prueba la conexión con Telegram enviando un mensaje de prueba.
 * Uso: npm run test-telegram
 */

import { loadConfig } from '../src/config/index.js';

const cfg = loadConfig();
const token = cfg.telegram?.botToken;
const chatId = cfg.telegram?.chatId;

if (!token || !chatId) {
  console.error('[test-telegram] TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID son requeridos en .env');
  process.exit(1);
}

const message = `🤖 <b>PUMP-BOT</b> — Test de conexión\n\n✅ Telegram configurado correctamente.\nModo: <code>${cfg.mode}</code>\n⏰ ${new Date().toISOString()}`;

const url = `https://api.telegram.org/bot${token}/sendMessage`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
});

const data = await res.json();
if (data.ok) {
  console.log('[test-telegram] ✅ Mensaje enviado correctamente.');
} else {
  console.error('[test-telegram] ❌ Error:', data.description);
  process.exit(1);
}
