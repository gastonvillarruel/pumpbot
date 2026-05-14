/**
 * src/alerts/formatter.js
 * Formatea mensajes de alerta por tipo de estado.
 */

const TV_BASE = 'https://tradingview.com/chart/?symbol=BINANCE:';

function scoreBar(score) {
  const filled = Math.round(score / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function fmt(n, decimals = 2) {
  if (n === null || n === undefined) return 'N/A';
  return Number(n).toFixed(decimals);
}

function fundingEmoji(rate) {
  if (rate === null) return '';
  if (rate > 0.0005) return '🔴';
  if (rate > 0.0003) return '⚡';
  if (rate < -0.0001) return '✅✅';
  return '✅';
}

export function formatAlert(state, symbol, score, features, breakdown, penalties, mode) {
  const emoji = { WATCH: '🔍', PRE_PUMP: '🟡', IGNITION: '🟠', CONFIRMED: '🟢', LATE_DANGER: '🔴' };
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const tvUrl = `${TV_BASE}${symbol.replace('USDT', 'USDT.P')}`;
  const shadowTag = mode === 'shadow' ? ' [SHADOW]' : '';
  const priceStr = features.price ? `$${fmt(features.price, 4)}` : 'N/A';
  const ret1h = features.price_return_1h;
  const retStr = ret1h !== null ? ` (${ret1h >= 0 ? '+' : ''}${fmt(ret1h)}% 1h)` : '';

  const penLines = Object.entries(penalties)
    .map(([k, v]) => `• ${k.replace(/_/g, ' ')}: ${v} pts`)
    .join('\n');

  return [
    `${emoji[state] ?? '❓'} <b>${state}${shadowTag} — ${symbol}</b>`,
    ``,
    `Score: ${score}/100  ${scoreBar(score)}`,
    `Precio: ${priceStr}${retStr}`,
    ``,
    `📊 <b>Señales activas:</b>`,
    `• RVOL ${fmt(features.rvol_5m)}x (5m) | z-score 1h: ${fmt(features.vol_zscore_1h)}`,
    `• OI: ${fmt(features.oi_change_1h)}% en 1h (z: ${fmt(features.oi_zscore)})`,
    features.oi_price_divergence ? `• Divergencia OI-Precio 🔥` : null,
    `• Funding: ${fmt(features.funding_rate ? features.funding_rate * 100 : null, 4)}% ${fundingEmoji(features.funding_rate)}`,
    features.breakout_24h ? `• Breakout 24h ✅` : null,
    features.breakout_72h ? `• Breakout 72h ✅` : null,
    ``,
    penLines ? `⚠️ Penalizaciones:\n${penLines}` : `⚠️ Sin penalizaciones`,
    ``,
    `🔗 <a href="${tvUrl}">TradingView</a> | ⏰ ${ts}`,
  ].filter(l => l !== null).join('\n');
}

export function formatSystemAlert(type, minutesDown) {
  if (type === 'down') {
    return `⚠️ <b>PUMP-BOT — API UNREACHABLE</b>\n\nBinance no responde hace ${minutesDown} min. Señales pausadas.`;
  }
  return `✅ <b>PUMP-BOT — API RECUPERADA</b>\n\nReanudando operación normal.`;
}
