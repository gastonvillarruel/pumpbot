/**
 * src/scoring/index.js
 * Scoring engine: combina features en un score 0-100 con pesos configurables.
 */

import { lerp, clamp } from '../utils/math.js';

/**
 * Calcula el score total de un símbolo.
 * @param {object} features - Output de computeFeatures().
 * @param {object} scoringCfg - Sección scoring del config.
 * @param {boolean} isNewListing
 * @returns {{ score: number, breakdown: object, penalties: object }}
 */
export function calculateScore(features, scoringCfg, isNewListing = false) {
  const breakdown = {};
  let raw = 0;

  // ── Acumulación / Divergencia OI-Precio (30 pts) ──────────────────────────
  const oiChange1h = features.oi_change_1h ?? 0;
  const oiZscore   = features.oi_zscore ?? 0;
  const divScore   = features.oi_price_divergence_score ?? 0;

  breakdown.oi_change    = lerp(oiChange1h, 0, 15, 0, 10);
  breakdown.oi_zscore    = lerp(oiZscore, 0, 3, 0, 8);
  breakdown.oi_divergence = divScore;
  raw += breakdown.oi_change + breakdown.oi_zscore + breakdown.oi_divergence;

  // ── Volumen / Anomalía (25 pts) ────────────────────────────────────────────
  breakdown.rvol_5m        = lerp(features.rvol_5m ?? 0, 1, 5, 0, 8);
  breakdown.vol_zscore_1h  = lerp(features.vol_zscore_1h ?? 0, 0, 4, 0, 8);
  breakdown.vol_trend      = features.vol_trending ? 5 : 0;
  breakdown.vol_from_low   = features.vol_from_low ? 4 : 0;
  raw += breakdown.rvol_5m + breakdown.vol_zscore_1h + breakdown.vol_trend + breakdown.vol_from_low;

  // ── Price Action (25 pts) ─────────────────────────────────────────────────
  const bbwPercentile = features.bbw_percentile ?? 50;
  breakdown.bbw_compression  = lerp(100 - bbwPercentile, 0, 100, 0, 8);
  breakdown.lateral_range    = (features.lateral_range_24h || features.lateral_range_8h) ? 5 : 0;
  breakdown.breakout         = features.breakout_score ?? 0;

  const ret1h = features.price_return_1h ?? 0;
  // Return moderado positivo (2-8%) es ideal; flat o sobreextendido no suma
  breakdown.return_moderate = (ret1h >= 2 && ret1h <= 8) ? lerp(ret1h, 2, 8, 2, 4) : 0;
  raw += breakdown.bbw_compression + breakdown.lateral_range + breakdown.breakout + breakdown.return_moderate;

  // ── Derivados / Funding (15 pts) ──────────────────────────────────────────
  const funding = features.funding_rate ?? 0;
  if (funding >= -0.0002 && funding <= 0.00005) {
    breakdown.funding_score = 6;
  } else if (funding < -0.0002) {
    // Muy negativo = short squeeze posible
    breakdown.funding_score = 4;
  } else if (funding <= 0.0001) {
    breakdown.funding_score = 3;
  } else {
    breakdown.funding_score = 0;
  }

  const regime = features.funding_regime ?? 'NEUTRAL';
  breakdown.funding_regime = { NEGATIVE: 4, NEUTRAL: 4, WARMING: 2, HOT: 0 }[regime] ?? 0;

  // Taker ratio (MVP: no disponible aún, se agrega en Fase 2)
  breakdown.taker_ratio = 0;

  raw += breakdown.funding_score + breakdown.funding_regime + breakdown.taker_ratio;

  // ── Microestructura (5 pts, siempre 0 en MVP) ────────────────────────────
  breakdown.microstructure = 0;

  // ── Penalizaciones ────────────────────────────────────────────────────────
  const penalties = calculatePenalties(features, scoringCfg.penalties);
  const penaltyTotal = Object.values(penalties).reduce((s, v) => s + v, 0);

  const score = clamp(raw + penaltyTotal, 0, 100);

  // New listing: reducir score efectivo (más exigente)
  const finalScore = isNewListing ? score * 0.7 : score;

  return {
    score: Math.round(finalScore * 10) / 10,
    breakdown,
    penalties,
  };
}

/**
 * Calcula las penalizaciones y retorna objeto con nombre → valor (negativo).
 */
function calculatePenalties(features, penaltyCfg) {
  const pen = {};
  const ext = features.price_extension ?? 0;
  const funding = features.funding_rate ?? 0;
  const vol24h = features.volume_24h ?? Infinity;
  const rvol5m = features.rvol_5m ?? 0;
  const wick = features.upper_wick_pct ?? 0;
  const btcReturn1h = features.btc_return_1h ?? 0;

  // Precio extendido
  if (ext > 30) pen.price_extended = penaltyCfg.priceExtended30pct ?? -25;
  else if (ext > 20) pen.price_extended = penaltyCfg.priceExtended20pct ?? -20;
  else if (ext > 10) pen.price_extended = penaltyCfg.priceExtended10pct ?? -10;

  // Funding eufórico
  if (funding > 0.001) pen.funding_hot = penaltyCfg.fundingHot01 ?? -20;
  else if (funding > 0.0005) pen.funding_hot = penaltyCfg.fundingHot005 ?? -15;
  else if (funding > 0.0003) pen.funding_hot = penaltyCfg.fundingHot003 ?? -10;

  // Volumen bajo
  if (vol24h < 500_000) pen.low_volume = penaltyCfg.lowVolume500k ?? -10;
  else if (vol24h < 1_000_000) pen.low_volume = penaltyCfg.lowVolume1m ?? -5;

  // Volumen sospechoso (RVOL extremo sin movimiento de precio)
  const ret1h = Math.abs(features.price_return_1h ?? 0);
  if (rvol5m > 20 && ret1h < 2) pen.suspicious_volume = penaltyCfg.suspiciousVolume ?? -10;

  // Mecha superior
  if (wick > 0.6) pen.upper_wick = penaltyCfg.upperWick60pct ?? -5;

  // BTC en contra
  if (btcReturn1h < -5) pen.btc_down = penaltyCfg.btcDown5pct1h ?? -10;
  else if (btcReturn1h < -2) pen.btc_down = penaltyCfg.btcDown2pct1h ?? -5;

  return pen;
}
