/**
 * src/features/derivatives.js
 * Features de derivados: OI change, OI z-score, OI-Price divergence, funding.
 */

import { zscore, pctChange } from '../utils/math.js';
import { getOIValues, getOI } from '../storage/openInterest.js';
import { getFundingValues, getLatestFunding } from '../storage/funding.js';
import { getCandles } from '../storage/candles.js';

/**
 * Calcula el cambio % de OI en N snapshots hacia atrás.
 * @param {number[]} oiValues - Valores de OI recientes.
 * @param {number} periodsBack - Snapshots hacia atrás.
 * @returns {number|null}
 */
export function calcOIChange(oiValues, periodsBack) {
  if (!oiValues || oiValues.length < periodsBack + 1) return null;
  const current = oiValues[oiValues.length - 1];
  const past = oiValues[oiValues.length - 1 - periodsBack];
  return pctChange(current, past);
}

/**
 * Calcula el z-score del OI actual vs historial.
 * @param {number[]} oiValues
 * @param {number} period
 * @returns {number|null}
 */
export function calcOIZscore(oiValues, period = 48) {
  if (!oiValues || oiValues.length < period + 1) return null;
  const current = oiValues[oiValues.length - 1];
  const history = oiValues.slice(0, -1);
  return zscore(current, history, period);
}

/**
 * Calcula la divergencia OI-Precio: OI sube pero precio no.
 * @param {number|null} oiChange1h - % cambio OI en 1h.
 * @param {number|null} priceReturn1h - % retorno de precio en 1h.
 * @returns {{ hasDivergence: boolean, divergenceScore: number }}
 */
export function calcOIPriceDivergence(oiChange1h, priceReturn1h) {
  if (oiChange1h === null || priceReturn1h === null) {
    return { hasDivergence: false, divergenceScore: 0 };
  }
  const hasDivergence = oiChange1h > 8 && Math.abs(priceReturn1h) < 2;
  const divergenceScore = hasDivergence
    ? Math.min(12, ((oiChange1h - 8) / 12) * 12)
    : 0;
  return { hasDivergence, divergenceScore };
}

/**
 * Clasifica el régimen de funding rate.
 * @param {number[]} fundingRates - Últimas 5 lecturas.
 * @returns {'NEGATIVE'|'NEUTRAL'|'WARMING'|'HOT'}
 */
export function classifyFundingRegime(fundingRates) {
  if (!fundingRates || fundingRates.length === 0) return 'NEUTRAL';
  const latest = fundingRates[fundingRates.length - 1];
  const avg = fundingRates.reduce((s, v) => s + v, 0) / fundingRates.length;

  if (latest > 0.0005) return 'HOT';    // > 0.05%
  if (latest > 0.0003) return 'WARMING'; // > 0.03%
  if (avg < -0.0001) return 'NEGATIVE';
  return 'NEUTRAL';
}

/**
 * Computa todos los features de derivados para un símbolo.
 * @param {string} symbol
 * @returns {object}
 */
export function computeDerivativeFeatures(symbol) {
  const oiValues = getOIValues(symbol, 55); // ~55 snapshots de 1h = ~48h

  // OI changes en distintos timeframes
  const oiChange5m = calcOIChange(oiValues, 1);   // Dos snapshots (aproximado)
  const oiChange1h = calcOIChange(oiValues, 12);  // 12 snapshots de 5m ≈ 1h
  const oiChange4h = calcOIChange(oiValues, 48);  // 48 snapshots de 5m ≈ 4h
  const oiZscore = calcOIZscore(oiValues, 48);

  // Funding
  const fundingValues = getFundingValues(symbol, 5);
  const latestFunding = getLatestFunding(symbol);
  const fundingRate = latestFunding?.funding_rate ?? null;
  const fundingRegime = classifyFundingRegime(fundingValues);

  return {
    oi_change_5m: oiChange5m,
    oi_change_1h: oiChange1h,
    oi_change_4h: oiChange4h,
    oi_zscore: oiZscore,
    funding_rate: fundingRate,
    funding_regime: fundingRegime,
  };
}
