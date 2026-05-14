/**
 * src/web/server.js
 * Express server embebido con Status Page y endpoints de datos.
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SSEManager } from './sse.js';
import { getAllStates, getRecentTransitions } from '../storage/states.js';
import { getRecentAlerts } from '../storage/alerts.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger({ module: 'web' });
const __dirname = dirname(fileURLToPath(import.meta.url));

export const sseManager = new SSEManager();

let _botStatus = {
  mode: 'shadow',
  startedAt: Date.now(),
  cycleCount: 0,
  lastCycleDurationMs: 0,
  symbolsScanned: 0,
  apiHealth: 'OK',
  version: '0.1.0',
};

/**
 * Actualiza el estado del bot para mostrar en la Status Page.
 */
export function updateBotStatus(data) {
  _botStatus = { ..._botStatus, ...data };
}

/**
 * Inicia el servidor web.
 * @param {object} cfg - Sección statusPage del config.
 * @param {string} mode
 */
export function startWebServer(cfg, mode) {
  if (!cfg.enabled) return null;

  _botStatus.mode = mode;
  const app = express();
  const publicDir = join(__dirname, 'public');
  app.use(express.static(publicDir));

  // SSE endpoint
  app.get('/events', (req, res) => {
    sseManager.addClient(res);
  });

  // API: estado del bot
  app.get('/api/status', (req, res) => {
    res.json({
      ..._botStatus,
      uptime: Date.now() - _botStatus.startedAt,
      sseClients: sseManager.clientCount,
    });
  });

  // API: símbolos con sus states y scores
  app.get('/api/symbols', (req, res) => {
    const states = getAllStates();
    res.json(states);
  });

  // API: detalle de un símbolo específico
  app.get('/api/symbol/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { getSymbolState } = await import('../storage/states.js');
    const { getLatestFeatures } = await import('../storage/features.js');
    
    const state = getSymbolState(symbol);
    const featuresData = getLatestFeatures(symbol);
    
    if (!state && !featuresData) {
      return res.status(404).json({ error: 'Símbolo no encontrado' });
    }
    
    res.json({
      symbol,
      state: state || { current_state: 'NORMAL' },
      details: featuresData
    });
  });

  // API: alertas recientes
  app.get('/api/alerts', (req, res) => {
    res.json(getRecentAlerts(50));
  });

  // API: transiciones recientes
  app.get('/api/transitions', (req, res) => {
    res.json(getRecentTransitions(50));
  });

  const server = app.listen(cfg.port, cfg.host, () => {
    log.info({ port: cfg.port, host: cfg.host }, `Status Page en http://${cfg.host}:${cfg.port}`);
  });

  return server;
}
