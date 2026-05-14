/**
 * src/storage/states.js
 * CRUD para symbol_states y state_transitions.
 */

import { getDb } from './database.js';
import { nowMs } from '../utils/time.js';

// ─── symbol_states ────────────────────────────────────────────────────────────

/**
 * Obtiene el estado actual de un símbolo. Si no existe, retorna estado NORMAL por defecto.
 * @param {string} symbol
 * @returns {object}
 */
export function getSymbolState(symbol) {
  const row = getDb().prepare('SELECT * FROM symbol_states WHERE symbol = ?').get(symbol);
  if (!row) {
    return {
      symbol,
      current_state: 'NORMAL',
      state_since: nowMs(),
      previous_state: null,
      consecutive_cycles: 0,
      cooldown_until: null,
      last_score: 0,
      entry_price: null,
      peak_score: 0,
      updated_at: nowMs(),
    };
  }
  return row;
}

/**
 * Actualiza el estado de un símbolo.
 * @param {string} symbol
 * @param {object} data - Campos a actualizar.
 */
export function upsertSymbolState(symbol, data) {
  const now = nowMs();
  getDb().prepare(`
    INSERT INTO symbol_states (
      symbol, current_state, state_since, previous_state,
      consecutive_cycles, cooldown_until, last_score, entry_price, peak_score, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (symbol) DO UPDATE SET
      current_state      = excluded.current_state,
      state_since        = excluded.state_since,
      previous_state     = excluded.previous_state,
      consecutive_cycles = excluded.consecutive_cycles,
      cooldown_until     = excluded.cooldown_until,
      last_score         = excluded.last_score,
      entry_price        = excluded.entry_price,
      peak_score         = excluded.peak_score,
      updated_at         = excluded.updated_at
  `).run(
    symbol,
    data.current_state ?? 'NORMAL',
    data.state_since ?? now,
    data.previous_state ?? null,
    data.consecutive_cycles ?? 0,
    data.cooldown_until ?? null,
    data.last_score ?? 0,
    data.entry_price ?? null,
    data.peak_score ?? 0,
    now,
  );
}

/**
 * Obtiene todos los símbolos que NO están en NORMAL.
 * @returns {Array<object>}
 */
export function getActiveSymbols() {
  return getDb().prepare(
    "SELECT * FROM symbol_states WHERE current_state != 'NORMAL' ORDER BY last_score DESC"
  ).all();
}

/**
 * Obtiene todos los estados actuales (para la Status Page).
 * @returns {Array<object>}
 */
export function getAllStates() {
  return getDb().prepare('SELECT * FROM symbol_states ORDER BY last_score DESC').all();
}

// ─── state_transitions ───────────────────────────────────────────────────────

/**
 * Registra una transición de estado.
 * @param {string} symbol
 * @param {string} fromState
 * @param {string} toState
 * @param {number} score
 * @param {number|null} price
 * @param {object|null} featuresSnapshot
 */
export function recordTransition(symbol, fromState, toState, score, price = null, featuresSnapshot = null) {
  getDb().prepare(`
    INSERT INTO state_transitions
      (symbol, from_state, to_state, score, price, features_snapshot_json, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    symbol, fromState, toState, score, price,
    featuresSnapshot ? JSON.stringify(featuresSnapshot) : null,
    nowMs()
  );
}

/**
 * Obtiene las últimas N transiciones de un símbolo.
 * @param {string} symbol
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getTransitions(symbol, limit = 20) {
  return getDb().prepare(`
    SELECT * FROM state_transitions
    WHERE symbol = ?
    ORDER BY timestamp DESC LIMIT ?
  `).all(symbol, limit);
}

/**
 * Obtiene las últimas N transiciones globales (para status page / timeline).
 * @param {number} limit
 * @returns {Array<object>}
 */
export function getRecentTransitions(limit = 50) {
  return getDb().prepare(`
    SELECT * FROM state_transitions
    ORDER BY timestamp DESC LIMIT ?
  `).all(limit);
}
