/**
 * src/utils/logger.js
 * Logger centralizado basado en Pino con rotación de archivos.
 */

import pino from 'pino';
import { mkdirSync } from 'fs';

let _logger = null;

/**
 * Inicializa el logger. Debe llamarse una sola vez al inicio del proceso.
 * @param {{ level: string, dir: string }} cfg - Sección logging del config.
 */
export function initLogger(cfg) {
  const level = cfg?.level ?? 'info';
  const logDir = cfg?.dir ?? './data/logs';

  // Crear directorio si no existe
  mkdirSync(logDir, { recursive: true });

  const targets = [
    // Consola con pretty print en desarrollo
    {
      target: 'pino-pretty',
      level,
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '[{module}] {msg}',
      },
    },
    // Archivo con rotación
    {
      target: 'pino-roll',
      level,
      options: {
        file: `${logDir}/pumpbot.log`,
        frequency: 'daily',
        size: cfg?.maxSize ?? '50m',
        limit: { count: cfg?.maxFiles ?? 5 },
      },
    },
  ];

  _logger = pino(
    { level },
    pino.transport({ targets })
  );

  return _logger;
}

/**
 * Retorna el logger global. Retorna un fallback de consola si no fue inicializado.
 * @returns {import('pino').Logger}
 */
export function getLogger() {
  if (!_logger) {
    // Fallback mínimo para cuando se llama antes de initLogger (imports de módulos)
    return {
      info: (...a) => console.log('[INFO]', ...a),
      warn: (...a) => console.warn('[WARN]', ...a),
      error: (...a) => console.error('[ERROR]', ...a),
      debug: () => {},
      child: () => getLogger(),
    };
  }
  return _logger;
}

/**
 * Crea un child logger con bindings fijos.
 * @param {object} bindings
 * @returns {import('pino').Logger}
 */
export function childLogger(bindings) {
  return getLogger().child(bindings);
}
