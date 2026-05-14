/**
 * src/utils/math.js
 * Funciones matemáticas puras — sin efectos secundarios, sin dependencias externas.
 */

/**
 * Simple Moving Average (SMA) de los últimos N valores de un array.
 * @param {number[]} values - Array de números.
 * @param {number} period - Cantidad de valores a promediar.
 * @returns {number|null} SMA o null si no hay suficientes datos.
 */
export function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Desviación estándar poblacional de los últimos N valores.
 * @param {number[]} values
 * @param {number} period
 * @returns {number|null}
 */
export function stddev(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  const mean = slice.reduce((sum, v) => sum + v, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

/**
 * Z-score del valor actual respecto a los últimos N valores históricos.
 * @param {number} current - Valor actual.
 * @param {number[]} history - Historial (no incluye el current).
 * @param {number} period - Ventana para calcular mean y std.
 * @returns {number|null}
 */
export function zscore(current, history, period) {
  if (!history || history.length < period) return null;
  const slice = history.slice(-period);
  const mean = slice.reduce((sum, v) => sum + v, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (current - mean) / std;
}

/**
 * Interpolación lineal: mapea un valor en [inMin, inMax] a [outMin, outMax].
 * Se clampea al rango de salida.
 * @param {number} value
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @returns {number}
 */
export function lerp(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;
  const ratio = (value - inMin) / (inMax - inMin);
  const result = outMin + ratio * (outMax - outMin);
  return clamp(result, Math.min(outMin, outMax), Math.max(outMin, outMax));
}

/**
 * Clampea un valor en [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Percentil de un valor dentro de un array (0-100).
 * ¿Qué porcentaje de los valores del array es menor que value?
 * @param {number} value
 * @param {number[]} array
 * @returns {number|null} 0-100
 */
export function percentileRank(value, array) {
  if (!array || array.length === 0) return null;
  const below = array.filter(v => v < value).length;
  return (below / array.length) * 100;
}

/**
 * Percentil N de un array (ej: percentile(array, 10) = el valor que supera al 10% de los datos).
 * @param {number[]} array
 * @param {number} p - 0-100
 * @returns {number|null}
 */
export function percentile(array, p) {
  if (!array || array.length === 0) return null;
  const sorted = [...array].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Calcula el Average True Range (ATR) de las últimas N velas.
 * @param {Array<{high: number, low: number, close: number}>} candles
 * @param {number} period
 * @returns {number|null}
 */
export function atr(candles, period) {
  if (!candles || candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  const trues = [];
  for (let i = 1; i < slice.length; i++) {
    const high = slice[i].high;
    const low = slice[i].low;
    const prevClose = slice[i - 1].close;
    trues.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return trues.reduce((sum, v) => sum + v, 0) / period;
}

/**
 * Calcula Bollinger Bands para las últimas velas.
 * @param {number[]} closes - Array de precios de cierre.
 * @param {number} period
 * @param {number} multiplier - Número de desviaciones estándar.
 * @returns {{upper: number, middle: number, lower: number, width: number}|null}
 */
export function bollingerBands(closes, period, multiplier = 2) {
  if (!closes || closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((sum, v) => sum + v, 0) / period;
  const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period);
  const upper = middle + multiplier * std;
  const lower = middle - multiplier * std;
  const width = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  return { upper, middle, lower, width };
}

/**
 * Cambio porcentual entre dos valores.
 * @param {number} current
 * @param {number} previous
 * @returns {number|null}
 */
export function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}
