/**
 * src/scanner/marketScanner.js
 * Orquesta el ciclo de escaneo: recolecta datos, guarda en storage.
 */

import { upsertCandles } from '../storage/candles.js';
import { upsertOIBatch, upsertOI } from '../storage/openInterest.js';
import { upsertFunding } from '../storage/funding.js';
import { childLogger } from '../utils/logger.js';
import { nowMs } from '../utils/time.js';

const log = childLogger({ module: 'scanner' });

export class MarketScanner {
  /**
   * @param {import('../exchanges/binance.js').BinanceClient} binance
   * @param {object} cfg - Config completo.
   */
  constructor(binance, cfg) {
    this.binance = binance;
    this.cfg = cfg;
    this._lastKlines5m = 0;    // Timestamp de última actualización de klines lentas
    this._lastOIHistory = 0;
    this._lastFunding = {};    // { [symbol]: timestamp }
  }

  /**
   * Escanea un símbolo completo en un ciclo.
   * @param {string} symbol
   */
  async scanSymbol(symbol) {
    const now = nowMs();
    const scan5min = now - this._lastKlines5m > 5 * 60_000;

    try {
      // Klines 1m (siempre)
      const k1m = await this.binance.getKlines(symbol, '1m', 5);
      if (k1m.length) upsertCandles(symbol, '1m', k1m);

      // Klines 5m, 1h (cada 5 min)
      if (scan5min) {
        const k5m = await this.binance.getKlines(symbol, '5m', 20);
        if (k5m.length) upsertCandles(symbol, '5m', k5m);

        const k1h = await this.binance.getKlines(symbol, '1h', 50);
        if (k1h.length) upsertCandles(symbol, '1h', k1h);
      }

      // OI snapshot
      const oi = await this.binance.getOpenInterest(symbol);
      if (oi) upsertOI(symbol, oi.timestamp, oi.openInterest, null, 'snapshot');

      // OI histórico (cada 5 min)
      if (scan5min && now - this._lastOIHistory > 5 * 60_000) {
        try {
          const oiHist = await this.binance.getOpenInterestHistory(symbol, '1h', 55);
          if (oiHist.length) upsertOIBatch(symbol, oiHist);
        } catch {
          // OI histórico puede fallar en pares nuevos — no crítico
        }
      }

      // Funding (cada hora aprox)
      const lastFundingTs = this._lastFunding[symbol] ?? 0;
      if (now - lastFundingTs > 60 * 60_000) {
        const funding = await this.binance.getPremiumIndex(symbol);
        if (funding) {
          upsertFunding(symbol, now, funding.fundingRate, funding.markPrice);
          this._lastFunding[symbol] = now;
        }
      }

    } catch (err) {
      log.warn({ symbol, err: err.message }, 'Error escaneando símbolo');
    }
  }

  /**
   * Marca que se completó una ronda de klines lentas (5m+).
   */
  markSlowScanDone() {
    this._lastKlines5m = nowMs();
    this._lastOIHistory = nowMs();
  }
}
