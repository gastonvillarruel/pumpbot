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
    this._lastKlines5m = {};    // { [symbol]: timestamp }
    this._lastOIHistory = {};
    this._lastFunding = {};     // { [symbol]: timestamp }
  }

  /**
   * Escanea un símbolo completo en un ciclo.
   * @param {string} symbol
   */
  async scanSymbol(symbol) {
    const now = nowMs();

    // Inicializar timestamps escalonados (stagger) para no saturar la API
    // con un pico masivo cada 5 minutos exactos para todas las monedas
    if (this._lastKlines5m[symbol] === undefined) {
      // Offset aleatorio entre 0 y 5 minutos para esparcir la carga inicial
      const stagger = Math.floor(Math.random() * 5 * 60_000);
      // Para la primera vez, forzamos que se escanee hoy restando 5 min + stagger,
      // PERO asegurando que no pase el IF en todos los simbolos al mismo tiempo en los siguientes ciclos.
      // Mejor: lo seteamos tal que se ejecute AHORA en el primer ciclo, pero la "fecha de inicio"
      // es un poco en el pasado para que los proximos queden escalonados.
      this._lastKlines5m[symbol] = now - 5 * 60_000 - stagger;
      this._lastOIHistory[symbol] = now - 5 * 60_000 - stagger;
      this._lastFunding[symbol] = now - 60 * 60_000 - stagger;
    }

    const scan5min = now - this._lastKlines5m[symbol] > 5 * 60_000;

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
        
        this._lastKlines5m[symbol] = now;
      }

      // OI snapshot
      const oi = await this.binance.getOpenInterest(symbol);
      if (oi) upsertOI(symbol, oi.timestamp, oi.openInterest, null, 'snapshot');

      // OI histórico (cada 5 min)
      if (scan5min && now - this._lastOIHistory[symbol] > 5 * 60_000) {
        try {
          const oiHist = await this.binance.getOpenInterestHistory(symbol, '1h', 55);
          if (oiHist.length) upsertOIBatch(symbol, oiHist);
          this._lastOIHistory[symbol] = now;
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
}
