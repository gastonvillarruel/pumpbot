/**
 * src/storage/openInterest.js
 * CRUD para la tabla open_interest.
 */

import { getDb } from './database.js';
import { nowMs } from '../utils/time.js';

/**
 * UPSERT de un snapshot de OI.
 * @param {string} symbol
 * @param {number} timestamp - ms
 * @param {number} oiValue - OI en contratos
 * @param {number|null} oiNotional - OI en USDT
 * @param {string} interval - "snapshot", "5m", "15m", "1h"
 */
export function upsertOI(symbol, timestamp, oiValue, oiNotional = null, interval = 'snapshot') {
  getDb().prepare(`
    INSERT INTO open_interest (symbol, timestamp, oi_value, oi_notional, interval)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (symbol, timestamp) DO UPDATE SET
      oi_value = excluded.oi_value,
      oi_notional = excluded.oi_notional,
      interval = excluded.interval
  `).run(symbol, timestamp, oiValue, oiNotional, interval);
}

/**
 * UPSERT de múltiples snapshots de OI.
 * @param {string} symbol
 * @param {Array<{ timestamp: number, oiValue: number, oiNotional?: number, interval?: string }>} rows
 */
export function upsertOIBatch(symbol, rows) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO open_interest (symbol, timestamp, oi_value, oi_notional, interval)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (symbol, timestamp) DO UPDATE SET
      oi_value = excluded.oi_value,
      oi_notional = excluded.oi_notional
  `);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      stmt.run(symbol, r.timestamp, r.oiValue, r.oiNotional ?? null, r.interval ?? 'snapshot');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Obtiene los últimos N snapshots de OI, ordenados ascendente.
 * @param {string} symbol
 * @param {number} limit
 * @param {string|null} interval
 * @returns {Array<{ symbol, timestamp, oi_value, oi_notional, interval }>}
 */
export function getOI(symbol, limit, interval = null) {
  const db = getDb();
  if (interval) {
    return db.prepare(`
      SELECT * FROM open_interest
      WHERE symbol = ? AND interval = ?
      ORDER BY timestamp DESC LIMIT ?
    `).all(symbol, interval, limit).reverse();
  }
  return db.prepare(`
    SELECT * FROM open_interest
    WHERE symbol = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(symbol, limit).reverse();
}

/**
 * Obtiene OI en un rango de tiempo.
 * @param {string} symbol
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {Array<object>}
 */
export function getOIInRange(symbol, fromMs, toMs) {
  return getDb().prepare(`
    SELECT * FROM open_interest
    WHERE symbol = ? AND timestamp BETWEEN ? AND ?
    ORDER BY timestamp ASC
  `).all(symbol, fromMs, toMs);
}

/**
 * Retorna solo los valores de OI de los últimos N snapshots.
 * @param {string} symbol
 * @param {number} limit
 * @returns {number[]}
 */
export function getOIValues(symbol, limit) {
  const rows = getDb().prepare(`
    SELECT oi_value FROM open_interest
    WHERE symbol = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(symbol, limit);
  return rows.map(r => r.oi_value).reverse();
}

/**
 * Elimina OI más antiguo que retentionMs.
 * @param {string} symbol
 * @param {number} retentionMs
 */
export function pruneOI(symbol, retentionMs) {
  const cutoff = nowMs() - retentionMs;
  getDb().prepare('DELETE FROM open_interest WHERE symbol = ? AND timestamp < ?').run(symbol, cutoff);
}
