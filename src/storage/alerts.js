/**
 * src/storage/alerts.js
 * CRUD para alerts_log y alert_outcomes.
 */

import { getDb } from './database.js';
import { nowMs } from '../utils/time.js';

// ─── alerts_log ──────────────────────────────────────────────────────────────

/**
 * Registra una alerta enviada (o logueada en shadow mode).
 * @param {string} symbol
 * @param {string} state
 * @param {number} score
 * @param {string} message
 * @param {string} mode - "shadow" | "live"
 * @param {boolean} telegramSuccess
 * @returns {number} ID de la alerta insertada
 */
export function logAlert(symbol, state, score, message, mode = 'shadow', telegramSuccess = false) {
  const result = getDb().prepare(`
    INSERT INTO alerts_log (symbol, state, score, message, mode, sent_at, telegram_success)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(symbol, state, score, message, mode, nowMs(), telegramSuccess ? 1 : 0);

  return result.lastInsertRowid;
}

/**
 * Obtiene las últimas N alertas.
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getRecentAlerts(limit = 50) {
  return getDb().prepare(`
    SELECT * FROM alerts_log ORDER BY sent_at DESC LIMIT ?
  `).all(limit);
}

/**
 * Verifica si hay una alerta reciente para un símbolo en un estado dado.
 * @param {string} symbol
 * @param {string} state
 * @param {number} withinMs - Ventana de deduplicación en ms.
 * @returns {boolean}
 */
export function hasRecentAlert(symbol, state, withinMs) {
  const since = nowMs() - withinMs;
  const row = getDb().prepare(`
    SELECT id FROM alerts_log
    WHERE symbol = ? AND state = ? AND sent_at > ?
    LIMIT 1
  `).get(symbol, state, since);
  return !!row;
}

/**
 * Cuenta alertas enviadas en la última hora.
 * @returns {number}
 */
export function countAlertsLastHour() {
  const since = nowMs() - 3_600_000;
  const row = getDb().prepare(
    'SELECT COUNT(*) as cnt FROM alerts_log WHERE sent_at > ?'
  ).get(since);
  return row.cnt;
}

// ─── alert_outcomes ───────────────────────────────────────────────────────────

/**
 * Crea una fila vacía en alert_outcomes al registrar la alerta.
 * @param {number} alertId - FK a alerts_log.id
 * @param {string} symbol
 * @param {string} alertState
 * @param {number} alertPrice
 */
export function createOutcome(alertId, symbol, alertState, alertPrice) {
  getDb().prepare(`
    INSERT OR IGNORE INTO alert_outcomes
      (id, symbol, alert_state, alert_price)
    VALUES (?, ?, ?, ?)
  `).run(alertId, symbol, alertState, alertPrice);
}

/**
 * Actualiza los campos de resultado posterior a la alerta.
 * @param {number} alertId
 * @param {object} data - Campos a actualizar (price_1h, return_1h, etc.)
 */
export function updateOutcome(alertId, data) {
  const fields = [
    'price_1h', 'price_4h', 'price_12h', 'price_24h',
    'return_1h', 'return_4h', 'return_12h', 'return_24h',
    'max_return_24h', 'max_drawdown_24h',
  ];
  const updates = fields
    .filter(f => data[f] !== undefined)
    .map(f => `${f} = ?`);

  if (updates.length === 0) return;

  const values = fields
    .filter(f => data[f] !== undefined)
    .map(f => data[f]);

  getDb().prepare(`
    UPDATE alert_outcomes SET ${updates.join(', ')}, evaluated_at = ?
    WHERE id = ?
  `).run(...values, nowMs(), alertId);
}

/**
 * Obtiene alertas pendientes de evaluación (con alert_price pero sin todos los returns).
 * @param {number} maxAgeMs - Solo alertas más recientes que esto.
 * @returns {Array<{ id, symbol, alert_state, alert_price, sent_at, price_1h, price_4h, price_12h, price_24h }>}
 */
export function getPendingOutcomes(maxAgeMs = 86_400_000) {
  const since = nowMs() - maxAgeMs;
  return getDb().prepare(`
    SELECT o.id, o.symbol, o.alert_state, o.alert_price, o.price_1h, o.price_4h, o.price_12h, o.price_24h,
           a.sent_at
    FROM alert_outcomes o
    JOIN alerts_log a ON a.id = o.id
    WHERE a.sent_at > ?
      AND (o.price_24h IS NULL)
    ORDER BY a.sent_at ASC
  `).all(since);
}
