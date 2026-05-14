/**
 * src/alerts/index.js
 * Alert manager: deduplicación, rate limiting, shadow/live mode.
 */

import { TelegramClient } from './telegram.js';
import { formatAlert, formatSystemAlert } from './formatter.js';
import { logAlert, hasRecentAlert, countAlertsLastHour, createOutcome } from '../storage/alerts.js';
import { getCachedTicker } from '../scanner/universe.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ module: 'alerts' });

export class AlertManager {
  constructor(cfg) {
    this.mode = cfg.mode ?? 'shadow';
    this.alertsCfg = cfg.alerts;
    this.telegram = this.mode === 'live' && cfg.telegram?.botToken
      ? new TelegramClient(cfg.telegram.botToken, cfg.telegram.chatId)
      : null;
  }

  /**
   * Envía (o loguea en shadow) una alerta de transición de estado.
   */
  async sendAlert(state, symbol, score, features, breakdown, penalties) {
    const dupWindow = (this.alertsCfg.deduplicationMinutes ?? 10) * 60_000;
    if (hasRecentAlert(symbol, state, dupWindow)) {
      log.debug({ symbol, state }, 'Alerta deduplicada');
      return;
    }

    if (countAlertsLastHour() >= (this.alertsCfg.maxPerHour ?? 15)) {
      log.warn({ symbol }, 'Límite de alertas/hora alcanzado');
      return;
    }

    const ticker = getCachedTicker(symbol);
    const featuresWithPrice = { ...features, price: ticker?.price ?? features.price };
    const message = formatAlert(state, symbol, score, featuresWithPrice, breakdown, penalties, this.mode);

    let success = false;
    if (this.mode === 'live' && this.telegram) {
      success = await this.telegram.send(message);
    } else {
      log.info({ symbol, state, score }, `[SHADOW] ${message.split('\n')[0]}`);
      success = true;
    }

    const alertId = logAlert(symbol, state, score, message, this.mode, success);
    createOutcome(alertId, symbol, state, featuresWithPrice.price ?? 0);
  }

  async sendSystemAlert(type, minutesDown = 0) {
    const message = formatSystemAlert(type, minutesDown);
    if (this.mode === 'live' && this.telegram) {
      await this.telegram.send(message);
    }
    log.warn({ type, minutesDown }, `[SISTEMA] ${message.split('\n')[0]}`);
  }
}
