/**
 * src/storage/features.js
 * CRUD para la tabla calculated_features.
 */

import { getDb } from './database.js';

/**
 * Guarda features calculados para un símbolo.
 * @param {string} symbol
 * @param {number} timestamp - ms
 * @param {object} features - Objeto con todos los features
 * @param {number} score - Score total 0-100
 * @param {object|null} scoreBreakdown
 * @param {object|null} penalties
 */
export function saveFeatures(symbol, timestamp, features, score, scoreBreakdown = null, penalties = null) {
  getDb().prepare(`
    INSERT INTO calculated_features
      (symbol, timestamp, features_json, score, score_breakdown_json, penalties_json)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol, timestamp) DO UPDATE SET
      features_json        = excluded.features_json,
      score                = excluded.score,
      score_breakdown_json = excluded.score_breakdown_json,
      penalties_json       = excluded.penalties_json
  `).run(
    symbol,
    timestamp,
    JSON.stringify(features),
    score,
    scoreBreakdown ? JSON.stringify(scoreBreakdown) : null,
    penalties ? JSON.stringify(penalties) : null,
  );
}

/**
 * Obtiene el último snapshot de features para un símbolo.
 * @param {string} symbol
 * @returns {{ symbol, timestamp, features, score, scoreBreakdown, penalties }|null}
 */
export function getLatestFeatures(symbol) {
  const row = getDb().prepare(`
    SELECT * FROM calculated_features
    WHERE symbol = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(symbol);
  if (!row) return null;
  return _parseRow(row);
}

/**
 * Obtiene los últimos N snapshots de features para un símbolo.
 * @param {string} symbol
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getFeatureHistory(symbol, limit) {
  const rows = getDb().prepare(`
    SELECT * FROM calculated_features
    WHERE symbol = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(symbol, limit);
  return rows.map(_parseRow).reverse();
}

function _parseRow(row) {
  return {
    symbol: row.symbol,
    timestamp: row.timestamp,
    features: JSON.parse(row.features_json),
    score: row.score,
    scoreBreakdown: row.score_breakdown_json ? JSON.parse(row.score_breakdown_json) : null,
    penalties: row.penalties_json ? JSON.parse(row.penalties_json) : null,
  };
}
