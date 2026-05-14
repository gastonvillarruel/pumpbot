/**
 * src/config/schema.js
 * Validación de configuración con AJV-like estructura.
 * Usamos validación manual para evitar dependencias pesadas en MVP.
 * Cada validator retorna { valid: boolean, errors: string[] }.
 */

/**
 * Valida la configuración completa.
 * @param {object} cfg
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateConfig(cfg) {
  const errors = [];

  // mode
  if (!['shadow', 'live'].includes(cfg.mode)) {
    errors.push(`config.mode debe ser "shadow" o "live", recibido: "${cfg.mode}"`);
  }

  // exchange
  if (!cfg.exchange?.baseUrl) errors.push('config.exchange.baseUrl es requerido');
  if (typeof cfg.exchange?.rateLimitPerMinute !== 'number') {
    errors.push('config.exchange.rateLimitPerMinute debe ser un número');
  }

  // scanner
  if (cfg.scanner?.scanIntervalMs < 5000) {
    errors.push('config.scanner.scanIntervalMs debe ser >= 5000ms');
  }

  // universe
  if (typeof cfg.universe?.minVolume24hUsdt !== 'number' || cfg.universe.minVolume24hUsdt < 0) {
    errors.push('config.universe.minVolume24hUsdt debe ser un número >= 0');
  }
  if (!Array.isArray(cfg.universe?.blacklist)) {
    errors.push('config.universe.blacklist debe ser un array');
  }
  if (!Array.isArray(cfg.universe?.contextSymbols)) {
    errors.push('config.universe.contextSymbols debe ser un array');
  }

  // stateMachine scores
  const sm = cfg.stateMachine;
  if (sm) {
    if (sm.watchEntry?.minScore < 0 || sm.watchEntry?.minScore > 100) {
      errors.push('config.stateMachine.watchEntry.minScore debe estar en [0, 100]');
    }
    if (sm.prePumpEntry?.minScore <= sm.watchEntry?.minScore) {
      errors.push('config.stateMachine.prePumpEntry.minScore debe ser > watchEntry.minScore');
    }
    if (sm.ignitionEntry?.minScore <= sm.prePumpEntry?.minScore) {
      errors.push('config.stateMachine.ignitionEntry.minScore debe ser > prePumpEntry.minScore');
    }
  }

  // telegram (solo en live mode)
  if (cfg.mode === 'live') {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      errors.push('TELEGRAM_BOT_TOKEN es requerido en modo live (variable de entorno)');
    }
    if (!process.env.TELEGRAM_CHAT_ID && !cfg.telegram?.chatId) {
      errors.push('TELEGRAM_CHAT_ID es requerido en modo live (.env o config.telegram.chatId)');
    }
  }

  // storage
  if (!cfg.storage?.dbPath) errors.push('config.storage.dbPath es requerido');

  // statusPage
  if (cfg.statusPage?.enabled) {
    const port = cfg.statusPage.port;
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      errors.push('config.statusPage.port debe ser un entero entre 1024 y 65535');
    }
  }

  return { valid: errors.length === 0, errors };
}
