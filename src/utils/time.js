/**
 * src/utils/time.js
 * Helpers de timestamps y tiempo.
 */

/**
 * Timestamp actual en millisegundos (UTC).
 * @returns {number}
 */
export function nowMs() {
  return Date.now();
}

/**
 * Timestamp actual en segundos (UTC).
 * @returns {number}
 */
export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Convierte timestamp ms a Date ISO string legible.
 * @param {number} ms
 * @returns {string}
 */
export function msToIso(ms) {
  return new Date(ms).toISOString();
}

/**
 * Diferencia en minutos entre dos timestamps ms.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number}
 */
export function diffMinutes(fromMs, toMs) {
  return (toMs - fromMs) / 60000;
}

/**
 * Diferencia en horas entre dos timestamps ms.
 * @param {number} fromMs
 * @param {number} toMs
 * @returns {number}
 */
export function diffHours(fromMs, toMs) {
  return (toMs - fromMs) / 3600000;
}

/**
 * Retorna el timestamp de inicio de la vela para un intervalo dado.
 * @param {number} ms - Timestamp en ms.
 * @param {string} interval - "1m", "5m", "15m", "1h", "4h", "1d".
 * @returns {number}
 */
export function candleOpenTime(ms, interval) {
  const intervalMs = intervalToMs(interval);
  return Math.floor(ms / intervalMs) * intervalMs;
}

/**
 * Convierte un string de intervalo a milisegundos.
 * @param {string} interval
 * @returns {number}
 */
export function intervalToMs(interval) {
  const map = {
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h': 14_400_000,
    '6h': 21_600_000,
    '8h': 28_800_000,
    '12h': 43_200_000,
    '1d': 86_400_000,
  };
  if (!map[interval]) throw new Error(`Intervalo desconocido: ${interval}`);
  return map[interval];
}

/**
 * Retorna si el timestamp está dentro del período de cooldown.
 * @param {number|null} cooldownUntilMs
 * @returns {boolean}
 */
export function isInCooldown(cooldownUntilMs) {
  if (!cooldownUntilMs) return false;
  return Date.now() < cooldownUntilMs;
}

/**
 * Calcula el timestamp de fin de cooldown.
 * @param {number} durationMinutes
 * @returns {number}
 */
export function cooldownUntil(durationMinutes) {
  return Date.now() + durationMinutes * 60_000;
}

/**
 * Formatea duración en ms a string legible (ej: "2h 34m").
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
