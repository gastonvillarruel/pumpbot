/**
 * src/storage/funding.js
 * CRUD para la tabla funding_rates.
 */

import { getDb } from './database.js';
import { nowMs } from '../utils/time.js';

/**
 * UPSERT de un funding rate.
 * @param {string} symbol
 * @param {number} fundingTime - ms
 * @param {number} fundingRate
 * @param {number|null} markPrice
 */
export function upsertFunding(symbol, fundingTime, fundingRate, markPrice = null) {
  getDb().prepare(`
    INSERT INTO funding_rates (symbol, funding_time, funding_rate, mark_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (symbol, funding_time) DO UPDATE SET
      funding_rate = excluded.funding_rate,
      mark_price   = excluded.mark_price
  `).run(symbol, fundingTime, fundingRate, markPrice);
}

/**
 * UPSERT batch de funding rates.
 * @param {string} symbol
 * @param {Array<{ fundingTime: number, fundingRate: number, markPrice?: number }>} rows
 */
export function upsertFundingBatch(symbol, rows) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO funding_rates (symbol, funding_time, funding_rate, mark_price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (symbol, funding_time) DO UPDATE SET
      funding_rate = excluded.funding_rate,
      mark_price   = excluded.mark_price
  `);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(symbol, r.fundingTime, r.fundingRate, r.markPrice ?? null);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Obtiene los últimos N funding rates, ordenados ascendente.
 * @param {string} symbol
 * @param {number} limit
 * @returns {Array<{ symbol, funding_time, funding_rate, mark_price }>}
 */
export function getFunding(symbol, limit) {
  return getDb().prepare(`
    SELECT * FROM funding_rates
    WHERE symbol = ?
    ORDER BY funding_time DESC LIMIT ?
  `).all(symbol, limit).reverse();
}

/**
 * Retorna solo los valores de funding rate de los últimos N registros.
 * @param {string} symbol
 * @param {number} limit
 * @returns {number[]}
 */
export function getFundingValues(symbol, limit) {
  const rows = getDb().prepare(`
    SELECT funding_rate FROM funding_rates
    WHERE symbol = ?
    ORDER BY funding_time DESC LIMIT ?
  `).all(symbol, limit);
  return rows.map(r => r.funding_rate).reverse();
}

/**
 * Retorna el funding rate más reciente.
 * @param {string} symbol
 * @returns {{ funding_rate: number, funding_time: number }|null}
 */
export function getLatestFunding(symbol) {
  return getDb().prepare(`
    SELECT funding_rate, funding_time FROM funding_rates
    WHERE symbol = ?
    ORDER BY funding_time DESC LIMIT 1
  `).get(symbol) ?? null;
}

/**
 * Elimina funding rates más antiguos que retentionMs.
 * @param {string} symbol
 * @param {number} retentionMs
 */
export function pruneFunding(symbol, retentionMs) {
  const cutoff = nowMs() - retentionMs;
  getDb().prepare('DELETE FROM funding_rates WHERE symbol = ? AND funding_time < ?').run(symbol, cutoff);
}
