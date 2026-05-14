/**
 * src/features/priceAction.js
 * Features de precio: returns, extensión, compresión BBW, breakout de highs, rango lateral.
 */

import { sma, bollingerBands, pctChange, percentileRank } from '../utils/math.js';
import { getCandles, getCloses } from '../storage/candles.js';

/**
 * Calcula el return % del precio en N candles.
 * @param {number[]} closes
 * @param {number} periodsBack
 * @returns {number|null}
 */
export function calcPriceReturn(closes, periodsBack) {
  if (!closes || closes.length < periodsBack + 1) return null;
  const current = closes[closes.length - 1];
  const past = closes[closes.length - 1 - periodsBack];
  return pctChange(current, past);
}

/**
 * Calcula la extensión del precio respecto a su MA20 (como %).
 * @param {number[]} closes
 * @returns {number|null}
 */
export function calcPriceExtension(closes, period = 20) {
  if (!closes || closes.length < period) return null;
  const ma = sma(closes, period);
  if (!ma || ma === 0) return null;
  const current = closes[closes.length - 1];
  return pctChange(current, ma);
}

/**
 * Calcula el Bollinger Band Width y su percentil en la ventana histórica.
 * @param {number[]} closes
 * @param {number} period - Período de las bandas.
 * @param {number} historyWindow - Ventana para calcular el percentil.
 * @returns {{ bbw: number|null, bbwPercentile: number|null }}
 */
export function calcBBWidth(closes, period = 20, historyWindow = 168) {
  if (!closes || closes.length < period) return { bbw: null, bbwPercentile: null };

  const bb = bollingerBands(closes, period);
  if (!bb) return { bbw: null, bbwPercentile: null };

  // Calcular BBW histórico para percentil
  if (closes.length >= historyWindow + period) {
    const historicalBBW = [];
    for (let i = period; i < closes.length - 1; i++) {
      const slice = closes.slice(i - period, i);
      const bbHist = bollingerBands(slice, period);
      if (bbHist) historicalBBW.push(bbHist.width);
    }
    const bbwPercentile = percentileRank(bb.width, historicalBBW);
    return { bbw: bb.width, bbwPercentile };
  }

  return { bbw: bb.width, bbwPercentile: null };
}

/**
 * Detecta si el precio está en rango lateral (compresión).
 * @param {Array<{ high: number, low: number }>} candles
 * @param {number} windowH - Horas de la ventana.
 * @param {number} maxRangePct - % máximo del rango para considerar compresión.
 * @returns {boolean}
 */
export function isLateralRange(candles, windowH = 24, maxRangePct = 5) {
  if (!candles || candles.length < windowH) return false;
  const slice = candles.slice(-windowH);
  const high = Math.max(...slice.map(c => c.high));
  const low = Math.min(...slice.map(c => c.low));
  if (low === 0) return false;
  const rangePct = ((high - low) / low) * 100;
  return rangePct < maxRangePct;
}

/**
 * Detecta breakouts de máximos históricos.
 * @param {Array<{ high: number, close: number }>} candles
 * @param {number[]} windows - Ventanas en horas a verificar.
 * @returns {{ breakout_1h, breakout_4h, breakout_12h, breakout_24h, breakout_72h, breakout_score }}
 */
export function calcBreakouts(candles, windows = [1, 4, 12, 24, 72]) {
  if (!candles || candles.length < 2) {
    return { breakout_1h: false, breakout_4h: false, breakout_12h: false, breakout_24h: false, breakout_72h: false, breakout_score: 0 };
  }

  const current = candles[candles.length - 1].close;
  const scores = { 1: 2, 4: 4, 12: 6, 24: 8, 72: 10 };
  const result = {};
  let breakoutScore = 0;

  for (const w of windows) {
    const key = `breakout_${w}h`;
    if (candles.length < w + 1) {
      result[key] = false;
      continue;
    }
    // El high del período anterior (excluyendo la candle actual)
    const slice = candles.slice(-w - 1, -1);
    const prevHigh = Math.max(...slice.map(c => c.high));
    const isBreakout = current > prevHigh;
    result[key] = isBreakout;
    if (isBreakout) breakoutScore += scores[w] ?? 0;
  }

  result.breakout_score = Math.min(breakoutScore, 10);
  return result;
}

/**
 * Computa todos los features de price action para un símbolo.
 * @param {string} symbol
 * @returns {object}
 */
export function computePriceActionFeatures(symbol) {
  const candles1h = getCandles(symbol, '1h', 180); // ~7.5 días
  const candles5m = getCandles(symbol, '5m', 12);
  const closes1h = candles1h.map(c => c.close);
  const closes5m = candles5m.map(c => c.close);

  const priceReturn5m  = calcPriceReturn(closes5m, closes5m.length - 1);
  const priceReturn1h  = calcPriceReturn(closes1h, 1);
  const priceReturn4h  = calcPriceReturn(closes1h, 4);
  const priceReturn24h = calcPriceReturn(closes1h, 24);

  const priceExtension = calcPriceExtension(closes1h, 20);
  const { bbw, bbwPercentile } = calcBBWidth(closes1h, 20, 168);
  const lateralRange24h = isLateralRange(candles1h, 24, 5);
  const lateralRange8h  = isLateralRange(candles1h, 8, 3);
  const breakouts = calcBreakouts(candles1h);

  // Penalización por mecha superior (última candle)
  let upperWickPct = null;
  if (candles1h.length > 0) {
    const last = candles1h[candles1h.length - 1];
    const range = last.high - last.low;
    if (range > 0) upperWickPct = (last.high - last.close) / range;
  }

  let high24h = null;
  if (candles1h.length > 0) {
    const slice24 = candles1h.slice(-Math.min(24, candles1h.length));
    high24h = Math.max(...slice24.map(c => c.high));
  }

  return {
    price_return_5m: priceReturn5m,
    price_return_1h: priceReturn1h,
    price_return_4h: priceReturn4h,
    price_return_24h: priceReturn24h,
    price_extension: priceExtension,
    bbw,
    bbw_percentile: bbwPercentile,
    lateral_range_24h: lateralRange24h,
    lateral_range_8h: lateralRange8h,
    upper_wick_pct: upperWickPct,
    high_24h: high24h,
    ...breakouts,
  };
}
