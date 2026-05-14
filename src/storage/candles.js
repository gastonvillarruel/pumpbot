/**
 * src/storage/candles.js
 * CRUD para la tabla candles.
 */

import { getDb } from './database.js';
import { nowMs } from '../utils/time.js';

/**
 * UPSERT de un array de candles para un símbolo e intervalo.
 * @param {string} symbol
 * @param {string} interval
 * @param {Array<{
 *   openTime: number, open: number, high: number, low: number, close: number,
 *   volume: number, quoteVolume: number, tradesCount: number,
 *   takerBuyVolume: number, takerBuyQuoteVolume: number
 * }>} candles
 */
export function upsertCandles(symbol, interval, candles) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO candles (
      symbol, interval, open_time, open, high, low, close,
      volume, quote_volume, trades_count, taker_buy_volume, taker_buy_quote_volume
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol, interval, open_time) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low  = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      quote_volume = excluded.quote_volume,
      trades_count = excluded.trades_count,
      taker_buy_volume = excluded.taker_buy_volume,
      taker_buy_quote_volume = excluded.taker_buy_quote_volume
  `);

  db.exec('BEGIN');
  try {
    for (const c of candles) {
      stmt.run(
        symbol, interval, c.openTime,
        c.open, c.high, c.low, c.close,
        c.volume, c.quoteVolume, c.tradesCount ?? 0,
        c.takerBuyVolume ?? 0, c.takerBuyQuoteVolume ?? 0
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Obtiene las últimas N candles de un símbolo e intervalo, ordenadas ascendente (más antiguas primero).
 * @param {string} symbol
 * @param {string} interval
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getCandles(symbol, interval, limit) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT ?
  `).all(symbol, interval, limit).reverse();
}

/**
 * Obtiene candles en un rango de tiempo.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Array<object>}
 */
export function getCandlesInRange(symbol, interval, fromMs, toMs) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM candles
    WHERE symbol = ? AND interval = ? AND open_time BETWEEN ? AND ?
    ORDER BY open_time ASC
  `).all(symbol, interval, fromMs, toMs);
}

/**
 * Obtiene solo los precios de cierre de las últimas N candles.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} limit
 * @returns {number[]}
 */
export function getCloses(symbol, interval, limit) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT close FROM candles
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT ?
  `).all(symbol, interval, limit);
  return rows.map(r => r.close).reverse();
}

/**
 * Obtiene solo los volúmenes de las últimas N candles.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} limit
 * @returns {number[]}
 */
export function getVolumes(symbol, interval, limit) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT quote_volume FROM candles
    WHERE symbol = ? AND interval = ?
    ORDER BY open_time DESC
    LIMIT ?
  `).all(symbol, interval, limit);
  return rows.map(r => r.quote_volume).reverse();
}

/**
 * Retorna cuántas candles hay guardadas para un símbolo e intervalo.
 * @param {string} symbol
 * @param {string} interval
 * @returns {number}
 */
export function countCandles(symbol, interval) {
  const db = getDb();
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM candles WHERE symbol = ? AND interval = ?'
  ).get(symbol, interval);
  return row.cnt;
}

/**
 * Elimina candles más antiguas que retentionMs para un símbolo.
 * @param {string} symbol
 * @param {string} interval
 * @param {number} retentionMs
 */
export function pruneCandles(symbol, interval, retentionMs) {
  const cutoff = nowMs() - retentionMs;
  getDb().prepare(
    'DELETE FROM candles WHERE symbol = ? AND interval = ? AND open_time < ?'
  ).run(symbol, interval, cutoff);
}
