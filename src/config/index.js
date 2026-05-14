/**
 * src/config/index.js
 * Carga, valida y exporta la configuración del sistema.
 *
 * Orden de precedencia (mayor a menor):
 * 1. Variables de entorno (secrets)
 * 2. config/production.json (si existe)
 * 3. config/default.json
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as loadDotenv } from 'dotenv';
import { DEFAULTS } from './defaults.js';
import { validateConfig } from './schema.js';

// Cargar .env desde la raíz del proyecto
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
loadDotenv({ path: resolve(ROOT, '.env') });

/**
 * Merge profundo de dos objetos (simple, sin librerías).
 * Los valores de `override` tienen prioridad.
 * @param {object} base
 * @param {object} override
 * @returns {object}
 */
function deepMerge(base, override) {
  const result = { ...base };
  for (const key of Object.keys(override ?? {})) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(base[key] ?? {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

/**
 * Lee un archivo JSON. Retorna {} si no existe.
 * @param {string} filePath
 * @returns {object}
 */
function readJson(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (err) {
    throw new Error(`Error al parsear ${filePath}: ${err.message}`);
  }
}

let _config = null;

/**
 * Inicializa y retorna la configuración del sistema.
 * Singleton: la primera llamada carga el config; las siguientes lo retornan cacheado.
 * @returns {Readonly<object>}
 */
export function loadConfig() {
  if (_config) return _config;

  const defaultJson = readJson(resolve(ROOT, 'config/default.json'));
  const prodJson = readJson(resolve(ROOT, 'config/production.json'));

  // Merge: DEFAULTS → default.json → production.json
  let merged = deepMerge(DEFAULTS, defaultJson);
  merged = deepMerge(merged, prodJson);

  // Inyectar secrets desde env
  if (process.env.BINANCE_API_KEY) {
    merged.exchange = merged.exchange ?? {};
    merged.exchange.apiKey = process.env.BINANCE_API_KEY;
  }
  if (process.env.BINANCE_API_SECRET) {
    merged.exchange = merged.exchange ?? {};
    merged.exchange.apiSecret = process.env.BINANCE_API_SECRET;
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    merged.telegram = merged.telegram ?? {};
    merged.telegram.botToken = process.env.TELEGRAM_BOT_TOKEN;
  }
  if (process.env.TELEGRAM_CHAT_ID) {
    merged.telegram = merged.telegram ?? {};
    merged.telegram.chatId = process.env.TELEGRAM_CHAT_ID;
  }

  // Validar
  const { valid, errors } = validateConfig(merged);
  if (!valid) {
    throw new Error(`Configuración inválida:\n${errors.map(e => `  - ${e}`).join('\n')}`);
  }

  _config = Object.freeze(merged);
  return _config;
}

/**
 * Retorna el config ya cargado. Lanza si no fue inicializado.
 * @returns {Readonly<object>}
 */
export function getConfig() {
  if (!_config) throw new Error('Config no inicializado. Llamar loadConfig() primero.');
  return _config;
}

/** Solo para tests: resetea el singleton. */
export function _resetConfig() {
  _config = null;
}
