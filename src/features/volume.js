/**
 * src/features/volume.js
 * Features de volumen: RVOL, z-score, tendencia, volumen desde nivel bajo.
 */

import { sma, zscore, pctChange } from '../utils/math.js';
import { getVolumes } from '../storage/candles.js';

/**
 * Calcula Relative Volume (RVOL) = vol_actual / SMA(vol, period).
 * @param {number[]} volumes - Array de volúmenes (el último es el actual).
 * @param {number} period - Período del SMA.
 * @returns {number|null}
 */
export function calcRVOL(volumes, period = 20) {
  if (!volumes || volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const history = volumes.slice(0, -1);
  const avg = sma(history, period);
  if (!avg || avg === 0) return null;
  return current / avg;
}

/**
 * Calcula Z-Score del volumen actual vs historial.
 * @param {number[]} volumes - Array de volúmenes (el último es el actual).
 * @param {number} period
 * @returns {number|null}
 */
export function calcVolumeZscore(volumes, period = 50) {
  if (!volumes || volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const history = volumes.slice(0, -1);
  return zscore(current, history, period);
}

/**
 * Determina si el volumen está en tendencia creciente.
 * Requiere que las últimas N horas cada una tenga más volumen que la anterior.
 * @param {number[]} hourlyVolumes - Volúmenes horarios recientes.
 * @param {number} consecutiveHours
 * @returns {boolean}
 */
export function isVolumeTrending(hourlyVolumes, consecutiveHours = 3) {
  if (!hourlyVolumes || hourlyVolumes.length < consecutiveHours) return false;
  const slice = hourlyVolumes.slice(-consecutiveHours);
  for (let i = 1; i < slice.length; i++) {
    if (slice[i] <= slice[i - 1]) return false;
  }
  return true;
}

/**
 * Determina si el volumen está subiendo desde un nivel bajo.
 * @param {number[]} dailyVolumes - Volúmenes de los últimos 7d (valor diario acumulado).
 * @param {number} lowPercentile - Percentil (0-100) para considerar "nivel bajo".
 * @returns {boolean}
 */
export function isVolumeFromLow(dailyVolumes, lowPercentile = 30) {
  if (!dailyVolumes || dailyVolumes.length < 7) return false;
  const sorted = [...dailyVolumes].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * lowPercentile / 100)];
  // El volumen de ayer (penúltimo) debe haber estado en bajo percentil
  const yesterday = dailyVolumes[dailyVolumes.length - 2];
  return yesterday <= threshold;
}

/**
 * Computes all volume features for a symbol.
 * @param {string} symbol
 * @returns {object}
 */
export function computeVolumeFeatures(symbol) {
  const vols1m = getVolumes(symbol, '1m', 25);
  const vols5m = getVolumes(symbol, '5m', 55);
  const vols1h = getVolumes(symbol, '1h', 30);

  return {
    rvol_1m: calcRVOL(vols1m, 20),
    rvol_5m: calcRVOL(vols5m, 20),
    rvol_1h: calcRVOL(vols1h, 24),
    vol_zscore_5m: calcVolumeZscore(vols5m, 50),
    vol_zscore_1h: calcVolumeZscore(vols1h, 24),
    vol_trending: isVolumeTrending(vols1h, 3),
    vol_from_low: isVolumeFromLow(vols1h.slice(-8), 30),
  };
}
