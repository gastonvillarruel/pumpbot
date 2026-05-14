/**
 * src/exchanges/rateLimiter.js
 * Queue de requests con control de concurrencia y tracking de rate limit weight.
 */

export class RateLimiter {
  /**
   * @param {number} maxWeight - Límite de weight por minuto (Binance default: 1200).
   * @param {number} maxConcurrent - Requests simultáneos máximos.
   */
  constructor(maxWeight = 1200, maxConcurrent = 10) {
    this.maxWeight = maxWeight;
    this.maxConcurrent = maxConcurrent;
    this._usedWeight = 0;
    this._windowStart = Date.now();
    this._active = 0;
    this._queue = [];
  }

  /**
   * Encola y ejecuta una función async respetando rate limits.
   * @param {() => Promise<T>} fn - Función a ejecutar.
   * @param {number} weight - Weight del request (default 1).
   * @returns {Promise<T>}
   */
  async schedule(fn, weight = 1) {
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, weight, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    while (this._queue.length > 0 && this._active < this.maxConcurrent) {
      this._resetWindowIfNeeded();
      const item = this._queue[0];

      // Si supera el 80% del límite, pausar
      if (this._usedWeight + item.weight > this.maxWeight * 0.8) {
        const waitMs = 60000 - (Date.now() - this._windowStart);
        if (waitMs > 0) {
          setTimeout(() => this._drain(), waitMs + 100);
          return;
        }
        this._resetWindow();
      }

      this._queue.shift();
      this._active++;
      this._usedWeight += item.weight;

      item.fn()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this._active--;
          this._drain();
        });
    }
  }

  _resetWindowIfNeeded() {
    if (Date.now() - this._windowStart >= 60000) {
      this._resetWindow();
    }
  }

  _resetWindow() {
    this._usedWeight = 0;
    this._windowStart = Date.now();
  }

  /**
   * Actualiza el weight usado con el valor real reportado por Binance en headers.
   * @param {number} usedWeight
   */
  updateWeight(usedWeight) {
    if (usedWeight > this._usedWeight) {
      this._usedWeight = usedWeight;
    }
  }

  get stats() {
    return {
      usedWeight: this._usedWeight,
      maxWeight: this.maxWeight,
      active: this._active,
      queued: this._queue.length,
    };
  }
}
