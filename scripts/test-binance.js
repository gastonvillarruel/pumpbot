/**
 * scripts/test-binance.js
 * Prueba la conexión con Binance Futures y muestra algunos datos básicos.
 * Uso: npm run test-binance
 */

import { loadConfig } from '../src/config/index.js';

const cfg = loadConfig();
const baseUrl = cfg.exchange.baseUrl;

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}`);
  return res.json();
}

console.log(`[test-binance] Conectando a ${baseUrl}...\n`);

try {
  // 1. Ping
  await get('/fapi/v1/ping');
  console.log('✅ Ping OK');

  // 2. Server time
  const timeData = await get('/fapi/v1/time');
  const serverTime = new Date(timeData.serverTime).toISOString();
  console.log(`✅ Server time: ${serverTime}`);

  // 3. Exchange info (cantidad de símbolos)
  const info = await get('/fapi/v1/exchangeInfo');
  const tradingSymbols = info.symbols.filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT');
  console.log(`✅ Símbolos USDT-M activos: ${tradingSymbols.length}`);

  // 4. Ticker 24h (primer par)
  const ticker = await get('/fapi/v1/ticker/24hr?symbol=BTCUSDT');
  console.log(`✅ BTC price: $${parseFloat(ticker.lastPrice).toLocaleString()} | Vol 24h: $${(parseFloat(ticker.quoteVolume) / 1e9).toFixed(2)}B`);

  // 5. OI de BTC
  const oi = await get('/fapi/v1/openInterest?symbol=BTCUSDT');
  console.log(`✅ BTC OI: ${parseFloat(oi.openInterest).toLocaleString()} contratos`);

  // 6. Funding rate
  const funding = await get('/fapi/v1/premiumIndex?symbol=BTCUSDT');
  console.log(`✅ BTC Funding rate: ${(parseFloat(funding.lastFundingRate) * 100).toFixed(4)}%`);

  console.log('\n[test-binance] ✅ Todas las verificaciones pasaron.');
} catch (err) {
  console.error(`\n[test-binance] ❌ Error: ${err.message}`);
  process.exit(1);
}
