/**
 * src/scanner/universe.js
 * Filtrado y mantenimiento del universo de símbolos a escanear.
 */

import { getDb } from '../storage/database.js';
import { nowMs } from '../utils/time.js';
import { childLogger } from '../utils/logger.js';
import { STABLECOINS } from '../config/defaults.js';

const log = childLogger({ module: 'universe' });

/**
 * Actualiza la tabla symbols con los datos de exchangeInfo.
 * Detecta nuevos listings automáticamente.
 * @param {Array<object>} exchangeSymbols - Output de BinanceClient.getExchangeInfo()
 */
export function syncSymbols(exchangeSymbols) {
  const db = getDb();
  const now = nowMs();

  const stmt = db.prepare(`
    INSERT INTO symbols (symbol, base_asset, status, price_precision, qty_precision, min_notional, is_new_listing, listed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT (symbol) DO UPDATE SET
      status         = excluded.status,
      price_precision = excluded.price_precision,
      qty_precision  = excluded.qty_precision,
      min_notional   = excluded.min_notional,
      updated_at     = excluded.updated_at
  `);

  db.exec('BEGIN');
  try {
    for (const s of exchangeSymbols) {
      const existing = db.prepare('SELECT listed_at FROM symbols WHERE symbol = ?').get(s.symbol);
      if (!existing) {
        // Nuevo listing: marcar como tal
        db.prepare(`
          INSERT INTO symbols (symbol, base_asset, status, price_precision, qty_precision, min_notional, is_new_listing, listed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (symbol) DO NOTHING
        `).run(s.symbol, s.baseAsset, s.status, s.pricePrecision, s.quantityPrecision, s.minNotional ?? 0, now, now);
        log.info({ symbol: s.symbol }, 'Nuevo listing detectado');
      } else {
        stmt.run(s.symbol, s.baseAsset, s.status, s.pricePrecision, s.quantityPrecision, s.minNotional ?? 0, existing.listed_at ?? now, now);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Expira el flag is_new_listing después de N días.
 * @param {number} flagDurationDays
 */
export function expireNewListings(flagDurationDays) {
  const cutoff = nowMs() - flagDurationDays * 86_400_000;
  const result = getDb().prepare(
    'UPDATE symbols SET is_new_listing = 0 WHERE is_new_listing = 1 AND listed_at < ?'
  ).run(cutoff);
  if (result.changes > 0) {
    log.info({ count: result.changes }, 'New listing flags expirados');
  }
}

/**
 * Filtra el universo de símbolos a escanear según los criterios del config.
 * @param {Array<{ symbol, volume24h, price }>} tickers - Output de getAllTickers()
 * @param {object} universeCfg - Sección universe del config.
 * @returns {{ scan: string[], context: string[] }}
 *   - scan: símbolos a procesar por scoring/state machine
 *   - context: símbolos de contexto (BTC etc.) — solo datos, no alertas
 */
export function filterUniverse(tickers, universeCfg) {
  const {
    minVolume24hUsdt,
    maxVolume24hUsdt,
    excludeStablecoins,
    blacklist = [],
    contextSymbols = [],
    whitelist = [],
  } = universeCfg;

  const blacklistSet = new Set(blacklist);
  const contextSet = new Set(contextSymbols);

  const scan = [];
  const context = [];

  for (const t of tickers) {
    const { symbol, volume24h } = t;

    // Context symbols (BTC etc.): siempre incluir en context
    if (contextSet.has(symbol)) {
      context.push(symbol);
      continue;
    }

    // Blacklist
    if (blacklistSet.has(symbol)) continue;

    // Solo USDT-M perpetuos
    if (!symbol.endsWith('USDT')) continue;

    // Stablecoins
    if (excludeStablecoins && STABLECOINS.has(symbol)) continue;

    // Volumen mínimo
    if (volume24h < minVolume24hUsdt) continue;

    // Volumen máximo (opcional)
    if (maxVolume24hUsdt && volume24h > maxVolume24hUsdt) continue;

    // Whitelist: si está definida, solo incluir estos
    if (whitelist.length > 0 && !whitelist.includes(symbol)) continue;

    scan.push(symbol);
  }

  log.debug({ total: tickers.length, scan: scan.length, context: context.length }, 'Universo filtrado');
  return { scan, context };
}

/**
 * Actualiza el ticker cache en la DB.
 * @param {Array<{ symbol, price, priceChangePct, volume24h, high, low }>} tickers
 */
export function updateTickerCache(tickers) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO ticker_cache (symbol, price, price_change_pct, volume_usdt, high_24h, low_24h, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol) DO UPDATE SET
      price = excluded.price,
      price_change_pct = excluded.price_change_pct,
      volume_usdt = excluded.volume_usdt,
      high_24h = excluded.high_24h,
      low_24h  = excluded.low_24h,
      updated_at = excluded.updated_at
  `);
  const now = nowMs();
  db.exec('BEGIN');
  try {
    for (const t of tickers) {
      stmt.run(t.symbol, t.price, t.priceChangePct, t.volume24h, t.high, t.low, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Retorna el ticker cacheado de un símbolo.
 * @param {string} symbol
 * @returns {object|null}
 */
export function getCachedTicker(symbol) {
  return getDb().prepare('SELECT * FROM ticker_cache WHERE symbol = ?').get(symbol) ?? null;
}

/**
 * Retorna si un símbolo es new_listing.
 * @param {string} symbol
 * @returns {boolean}
 */
export function isNewListing(symbol) {
  const row = getDb().prepare('SELECT is_new_listing FROM symbols WHERE symbol = ?').get(symbol);
  return row?.is_new_listing === 1;
}
