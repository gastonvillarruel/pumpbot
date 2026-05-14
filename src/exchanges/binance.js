/**
 * src/exchanges/binance.js
 * Client REST para Binance Futures USDT-M.
 * Maneja autenticación, retries con backoff, y normalización de respuestas.
 */

import { RateLimiter } from './rateLimiter.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ module: 'binance' });

const BINANCE_ERRORS = {
  429: 'Rate limit exceeded',
  418: 'IP banned',
};

export class BinanceClient {
  /**
   * @param {object} cfg - Sección exchange del config.
   */
  constructor(cfg) {
    this.baseUrl = cfg.baseUrl ?? 'https://fapi.binance.com';
    this.apiKey = cfg.apiKey ?? null;
    this.apiSecret = cfg.apiSecret ?? null;
    this.timeout = cfg.requestTimeout ?? 10000;
    this.retryAttempts = cfg.retryAttempts ?? 3;
    this.retryDelayMs = cfg.retryDelayMs ?? 1000;
    this.rateLimiter = new RateLimiter(cfg.rateLimitPerMinute ?? 1200);
  }

  // ─── Raw HTTP ────────────────────────────────────────────────────────────────

  async _get(path, params = {}, weight = 1) {
    return this.rateLimiter.schedule(() => this._fetch(path, params, weight), weight);
  }

  async _fetch(path, params = {}, weight = 1) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }

    const headers = {};
    if (this.apiKey) headers['X-MBX-APIKEY'] = this.apiKey;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const res = await fetch(url.toString(), {
          headers,
          signal: AbortSignal.timeout(this.timeout),
        });

        // Actualizar weight desde headers de Binance
        const usedWeight = parseInt(res.headers.get('x-mbx-used-weight-1m') ?? '0');
        if (usedWeight) this.rateLimiter.updateWeight(usedWeight);

        if (res.status === 429 || res.status === 418) {
          const retryAfter = parseInt(res.headers.get('retry-after') ?? '60') * 1000;
          log.warn({ path, status: res.status }, `Rate limited. Esperando ${retryAfter}ms`);
          await _sleep(retryAfter);
          continue;
        }

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }

        return res.json();

      } catch (err) {
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelayMs * (2 ** (attempt - 1));
          log.warn({ path, attempt, err: err.message }, `Retry en ${delay}ms`);
          await _sleep(delay);
        } else {
          log.error({ path, err: err.message }, 'Request fallido tras todos los reintentos');
          throw err;
        }
      }
    }
  }

  // ─── Endpoints ───────────────────────────────────────────────────────────────

  /** Ping. */
  async ping() {
    return this._get('/fapi/v1/ping');
  }

  /**
   * Información de todos los símbolos activos.
   * @returns {Promise<Array<{ symbol, status, baseAsset, quoteAsset, pricePrecision, quantityPrecision, filters }>>}
   */
  async getExchangeInfo() {
    const data = await this._get('/fapi/v1/exchangeInfo', {}, 1);
    return data.symbols
      .filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map(s => ({
        symbol: s.symbol,
        status: s.status,
        baseAsset: s.baseAsset,
        pricePrecision: s.pricePrecision,
        quantityPrecision: s.quantityPrecision,
        minNotional: parseFloat(s.filters.find(f => f.filterType === 'MIN_NOTIONAL')?.notional ?? 0),
      }));
  }

  /**
   * Ticker 24h de TODOS los símbolos (1 request, weight 40).
   * @returns {Promise<Array<{ symbol, price, priceChangePct, volume24h, high, low }>>}
   */
  async getAllTickers() {
    const data = await this._get('/fapi/v1/ticker/24hr', {}, 40);
    return data.map(t => ({
      symbol: t.symbol,
      price: parseFloat(t.lastPrice),
      priceChangePct: parseFloat(t.priceChangePercent),
      volume24h: parseFloat(t.quoteVolume),
      high: parseFloat(t.highPrice),
      low: parseFloat(t.lowPrice),
    }));
  }

  /**
   * Klines (velas OHLCV).
   * @param {string} symbol
   * @param {string} interval - "1m", "5m", "15m", "1h", "4h"
   * @param {number} limit - Número de velas (max 1500)
   * @returns {Promise<Array<{ openTime, open, high, low, close, volume, quoteVolume, tradesCount, takerBuyVolume, takerBuyQuoteVolume }>>}
   */
  async getKlines(symbol, interval, limit = 20) {
    const data = await this._get('/fapi/v1/klines', { symbol, interval, limit }, 1);
    return data.map(k => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      quoteVolume: parseFloat(k[7]),
      tradesCount: parseInt(k[8]),
      takerBuyVolume: parseFloat(k[9]),
      takerBuyQuoteVolume: parseFloat(k[10]),
    }));
  }

  /**
   * Open Interest snapshot actual.
   * @param {string} symbol
   * @returns {Promise<{ symbol, openInterest, timestamp }>}
   */
  async getOpenInterest(symbol) {
    const data = await this._get('/fapi/v1/openInterest', { symbol }, 1);
    return {
      symbol: data.symbol,
      openInterest: parseFloat(data.openInterest),
      timestamp: data.time,
    };
  }

  /**
   * Historial de Open Interest.
   * @param {string} symbol
   * @param {string} period - "5m", "15m", "1h", "4h"
   * @param {number} limit
   * @returns {Promise<Array<{ symbol, oiValue, oiNotional, timestamp }>>}
   */
  async getOpenInterestHistory(symbol, period = '1h', limit = 50) {
    const data = await this._get('/futures/data/openInterestHist', {
      symbol, period, limit,
    }, 1);
    return data.map(d => ({
      symbol,
      oiValue: parseFloat(d.sumOpenInterest),
      oiNotional: parseFloat(d.sumOpenInterestValue),
      timestamp: d.timestamp,
      interval: period,
    }));
  }

  /**
   * Premium Index (funding rate actual y estimado).
   * @param {string} symbol
   * @returns {Promise<{ symbol, fundingRate, markPrice, nextFundingTime }>}
   */
  async getPremiumIndex(symbol) {
    const data = await this._get('/fapi/v1/premiumIndex', { symbol }, 1);
    return {
      symbol: data.symbol,
      fundingRate: parseFloat(data.lastFundingRate),
      markPrice: parseFloat(data.markPrice),
      nextFundingTime: data.nextFundingTime,
    };
  }

  /**
   * Historial de funding rates.
   * @param {string} symbol
   * @param {number} limit
   * @returns {Promise<Array<{ symbol, fundingTime, fundingRate }>>}
   */
  async getFundingHistory(symbol, limit = 10) {
    const data = await this._get('/fapi/v1/fundingRate', { symbol, limit }, 1);
    return data.map(d => ({
      symbol: d.symbol,
      fundingTime: d.fundingTime,
      fundingRate: parseFloat(d.fundingRate),
      markPrice: parseFloat(d.markPrice ?? 0),
    }));
  }

  get rateLimiterStats() {
    return this.rateLimiter.stats;
  }
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
