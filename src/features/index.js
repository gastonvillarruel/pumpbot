/**
 * src/features/index.js
 * Orquesta el cálculo de todos los features para un símbolo.
 */

import { computeVolumeFeatures } from './volume.js';
import { computeDerivativeFeatures, calcOIPriceDivergence } from './derivatives.js';
import { computePriceActionFeatures } from './priceAction.js';

/**
 * Calcula todos los features para un símbolo a partir de datos en storage.
 * @param {string} symbol
 * @param {{ price: number, volume24h: number }} tickerData - Datos del ticker actual.
 * @returns {object} - Objeto con todos los features calculados.
 */
export function computeFeatures(symbol, tickerData) {
  const volume = computeVolumeFeatures(symbol);
  const derivatives = computeDerivativeFeatures(symbol);
  const priceAction = computePriceActionFeatures(symbol);

  // OI-Price Divergence (cross-feature)
  const { hasDivergence, divergenceScore } = calcOIPriceDivergence(
    derivatives.oi_change_1h,
    priceAction.price_return_1h,
  );

  return {
    symbol,
    timestamp: Date.now(),
    price: tickerData?.price ?? null,
    volume_24h: tickerData?.volume24h ?? null,
    ...volume,
    ...derivatives,
    ...priceAction,
    oi_price_divergence: hasDivergence,
    oi_price_divergence_score: divergenceScore,
  };
}
