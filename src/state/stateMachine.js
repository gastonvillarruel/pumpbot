/**
 * src/state/stateMachine.js
 * Máquina de estados: NORMAL → WATCH → PRE_PUMP → IGNITION.
 * Implementa histéresis, cooldowns y timeouts.
 */

import { getSymbolState, upsertSymbolState, recordTransition } from '../storage/states.js';
import { nowMs, isInCooldown, cooldownUntil, diffMinutes } from '../utils/time.js';
import { STATES } from '../config/defaults.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ module: 'state' });

/**
 * Procesa el nuevo score de un símbolo y determina si hay transición de estado.
 * @param {string} symbol
 * @param {number} score
 * @param {object} features - Features completos para condiciones adicionales.
 * @param {object} smCfg - Sección stateMachine del config.
 * @param {boolean} isNewListing
 * @returns {{ state: string, transitioned: boolean, prevState: string }}
 */
export function processState(symbol, score, features, smCfg, isNewListing = false) {
  const stateData = getSymbolState(symbol);
  const now = nowMs();
  const current = stateData.current_state;

  // Multiplicador para nuevos listings: más ciclos requeridos
  const cycleMultiplier = isNewListing ? 1.5 : 1;

  // ── En cooldown: no cambiar estado ───────────────────────────────────────
  if (isInCooldown(stateData.cooldown_until) && current === STATES.NORMAL) {
    _updateState(symbol, current, score, stateData, now, false);
    return { state: current, transitioned: false, prevState: current };
  }

  // ── BTC override: si BTC cayó > 3%, no escalar a IGNITION ───────────────
  const btcDown = (features.btc_return_1h ?? 0) < -3;

  let newState = current;

  switch (current) {
    case STATES.NORMAL:
      newState = _evalFromNormal(score, stateData, smCfg, cycleMultiplier, features);
      break;
    case STATES.WATCH:
      newState = _evalFromWatch(score, stateData, smCfg, cycleMultiplier, features, now);
      break;
    case STATES.PRE_PUMP:
      newState = _evalFromPrePump(score, stateData, smCfg, cycleMultiplier, features, now, btcDown);
      break;
    case STATES.IGNITION:
      newState = _evalFromIgnition(score, stateData, smCfg, features);
      break;
    case STATES.CONFIRMED:
      newState = _evalFromConfirmed(score, stateData, smCfg, features);
      break;
    case STATES.LATE_DANGER:
      // Después de 30 min vuelve a NORMAL con cooldown
      if (diffMinutes(stateData.state_since, now) > 30) {
        newState = STATES.NORMAL;
      }
      break;
  }

  // Detectar LATE_DANGER desde cualquier estado no-NORMAL
  if (current !== STATES.NORMAL && current !== STATES.LATE_DANGER) {
    if (_isLateDanger(features, smCfg)) {
      newState = STATES.LATE_DANGER;
    }
  }

  const transitioned = newState !== current;

  // Cooldowns al bajar a NORMAL
  let cooldownUntilMs = stateData.cooldown_until;
  if (transitioned && newState === STATES.NORMAL) {
    if ([STATES.IGNITION, STATES.CONFIRMED].includes(current)) {
      cooldownUntilMs = cooldownUntil(smCfg.cooldowns.normalAfterIgnitionMinutes ?? 120);
    } else if (current === STATES.LATE_DANGER) {
      cooldownUntilMs = cooldownUntil(smCfg.cooldowns.normalAfterLateDangerMinutes ?? 120);
    } else if (current === STATES.WATCH) {
      cooldownUntilMs = cooldownUntil(smCfg.cooldowns.normalAfterWatchMinutes ?? 30);
    }
  }

  // Determinar si es nueva entrada al estado o ciclo consecutivo
  const isNewState = transitioned;
  const consecutiveCycles = isNewState ? 1 : stateData.consecutive_cycles + 1;
  const stateSince = isNewState ? now : stateData.state_since;
  const entryPrice = isNewState && current === STATES.NORMAL
    ? features.price
    : stateData.entry_price;
  const peakScore = Math.max(score, stateData.peak_score ?? 0);

  _updateState(symbol, newState, score, stateData, now, {
    consecutive_cycles: consecutiveCycles,
    state_since: stateSince,
    cooldown_until: cooldownUntilMs,
    entry_price: entryPrice,
    peak_score: peakScore,
    previous_state: current,
  });

  if (transitioned) {
    recordTransition(symbol, current, newState, score, features.price, features);
    log.info({ symbol, from: current, to: newState, score }, 'Transición de estado');
  }

  return { state: newState, transitioned, prevState: current };
}

// ─── Evaluadores por estado ──────────────────────────────────────────────────

function _evalFromNormal(score, stateData, smCfg, cycleMultiplier, features) {
  const { watchEntry } = smCfg;
  const minCycles = Math.ceil((watchEntry.minCycles ?? 2) * cycleMultiplier);
  const hasSignal = (features.rvol_5m ?? 0) > 2 ||
    (features.oi_change_1h ?? 0) > 5 ||
    (features.vol_zscore_1h ?? 0) > 2;

  if (score >= watchEntry.minScore && hasSignal) {
    // Si estamos en el primer ciclo que supera el umbral, incrementar contador
    if (stateData.consecutive_cycles >= minCycles - 1) {
      return STATES.WATCH;
    }
  }
  return STATES.NORMAL;
}

function _evalFromWatch(score, stateData, smCfg, cycleMultiplier, features, now) {
  const { watchExit, prePumpEntry } = smCfg;

  // Timeout
  if (diffMinutes(stateData.state_since, now) > (watchExit.timeoutMinutes ?? 120)) {
    return STATES.NORMAL;
  }
  // Salida por score bajo
  if (score < watchExit.maxScore && stateData.consecutive_cycles >= watchExit.minCycles) {
    return STATES.NORMAL;
  }
  // Subir a PRE_PUMP
  const minSignals = Math.ceil((prePumpEntry.minSignals ?? 2) * cycleMultiplier);
  const signals = _countActiveSignals(features);
  if (score >= prePumpEntry.minScore && signals >= minSignals) {
    return STATES.PRE_PUMP;
  }
  return STATES.WATCH;
}

function _evalFromPrePump(score, stateData, smCfg, cycleMultiplier, features, now, btcDown) {
  const { prePumpExit, ignitionEntry } = smCfg;

  // Timeout
  if (diffMinutes(stateData.state_since, now) > (prePumpExit.timeoutMinutes ?? 60)) {
    return STATES.NORMAL;
  }
  // Salida por score bajo
  if (score < prePumpExit.maxScore && stateData.consecutive_cycles >= prePumpExit.minCycles) {
    return STATES.NORMAL;
  }
  // Subir a IGNITION (BTC override: no escalar si BTC cae)
  if (!btcDown && score >= ignitionEntry.minScore && features.breakout_24h) {
    return STATES.IGNITION;
  }
  return STATES.PRE_PUMP;
}

function _evalFromIgnition(score, stateData, smCfg, features) {
  const { ignitionExit, confirmedEntry } = smCfg;
  if (score < ignitionExit.maxScore) return STATES.NORMAL;
  if (score >= confirmedEntry.minScore) return STATES.CONFIRMED;
  return STATES.IGNITION;
}

function _evalFromConfirmed(score, stateData, smCfg, features) {
  if (score < smCfg.confirmedExit.maxScore) return STATES.NORMAL;
  return STATES.CONFIRMED;
}

function _isLateDanger(features, smCfg) {
  const { lateDanger } = smCfg;
  return (
    (features.funding_rate ?? 0) > lateDanger.fundingThreshold ||
    (features.price_extension ?? 0) > lateDanger.extensionThreshold ||
    (features.upper_wick_pct ?? 0) > lateDanger.wickThreshold
  );
}

function _countActiveSignals(features) {
  let count = 0;
  if ((features.bbw_percentile ?? 100) < 20) count++;
  if (features.oi_price_divergence) count++;
  if (features.funding_regime === 'NEUTRAL' || features.funding_regime === 'NEGATIVE') count++;
  if ((features.rvol_5m ?? 0) > 3) count++;
  return count;
}

function _updateState(symbol, newState, score, stateData, now, overrides) {
  upsertSymbolState(symbol, {
    current_state: newState,
    state_since: overrides?.state_since ?? stateData.state_since,
    previous_state: overrides?.previous_state ?? stateData.previous_state,
    consecutive_cycles: overrides?.consecutive_cycles ?? stateData.consecutive_cycles + 1,
    cooldown_until: overrides?.cooldown_until ?? stateData.cooldown_until,
    last_score: score,
    entry_price: overrides?.entry_price ?? stateData.entry_price,
    peak_score: overrides?.peak_score ?? stateData.peak_score,
    updated_at: now,
  });
}
