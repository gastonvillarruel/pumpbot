/**
 * src/main.js
 * Orchestrator principal del PUMP-BOT.
 * Loop: scan → features → scoring → state → alerts → web push
 */

import { loadConfig } from './config/index.js';
import { initLogger, childLogger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './storage/database.js';
import { BinanceClient } from './exchanges/binance.js';
import { MarketScanner } from './scanner/marketScanner.js';
import { syncSymbols, filterUniverse, updateTickerCache, expireNewListings, isNewListing } from './scanner/universe.js';
import { computeFeatures } from './features/index.js';
import { saveFeatures } from './storage/features.js';
import { calculateScore } from './scoring/index.js';
import { processState } from './state/stateMachine.js';
import { AlertManager } from './alerts/index.js';
import { startWebServer, updateBotStatus, sseManager } from './web/server.js';
import { nowMs, formatDuration } from './utils/time.js';

const cfg = loadConfig();
const log = initLogger(cfg.logging).child({ module: 'main' });

// ── Estado global del bot ────────────────────────────────────────────────────
let cycleCount = 0;
let consecutiveFailures = 0;
let apiPaused = false;
let universeSymbols = [];
let contextSymbols = [];
let lastUniverseRefresh = 0;
const ALERT_STATES = ['WATCH', 'PRE_PUMP', 'IGNITION', 'CONFIRMED', 'LATE_DANGER'];

// ── Inicialización ───────────────────────────────────────────────────────────
log.info(`Iniciando PUMP-BOT v0.1.0 — modo: ${cfg.mode.toUpperCase()}`);
initDatabase(cfg.storage.dbPath, cfg.storage.walMode);

const binance = new BinanceClient(cfg.exchange);
const scanner = new MarketScanner(binance, cfg);
const alerts  = new AlertManager(cfg);
startWebServer(cfg.statusPage, cfg.mode);

// ── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function shutdown(signal) {
  log.info({ signal }, 'Apagando bot...');
  closeDatabase();
  process.exit(0);
}

// ── Actualizar universo ──────────────────────────────────────────────────────
async function refreshUniverse() {
  const now = nowMs();
  if (now - lastUniverseRefresh < cfg.scanner.refreshUniverseIntervalMs) return;

  log.info('Actualizando universo...');
  const [exchangeSymbols, tickers] = await Promise.all([
    binance.getExchangeInfo(),
    binance.getAllTickers(),
  ]);

  syncSymbols(exchangeSymbols);
  expireNewListings(cfg.newListing.flagDurationDays);
  updateTickerCache(tickers);

  const { scan, context } = filterUniverse(tickers, cfg.universe);
  universeSymbols = scan;
  contextSymbols = context;
  lastUniverseRefresh = now;

  log.info({ scan: scan.length, context: context.length }, 'Universo actualizado');
}

// ── Ciclo de escaneo para un símbolo ────────────────────────────────────────
async function processBtcContext() {
  for (const sym of contextSymbols) {
    await scanner.scanSymbol(sym);
  }
}

async function getBtcFeatures() {
  try {
    const feat = computeFeatures('BTCUSDT', null);
    return { btc_return_1h: feat.price_return_1h ?? 0 };
  } catch { return { btc_return_1h: 0 }; }
}

// ── Loop principal ───────────────────────────────────────────────────────────
async function runCycle() {
  const cycleStart = nowMs();
  cycleCount++;
  log.info({ cycle: cycleCount, symbols: universeSymbols.length }, 'Iniciando ciclo');

  try {
    // Actualizar universo si toca
    await refreshUniverse();
    if (!universeSymbols.length) {
      log.warn('Universo vacío — esperando próximo ciclo');
      return;
    }

    // Escanear BTC (contexto)
    await processBtcContext();
    const btcCtx = await getBtcFeatures();

    // Escanear símbolos en batches de 10
    const BATCH = 10;
    for (let i = 0; i < universeSymbols.length; i += BATCH) {
      const batch = universeSymbols.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(sym => scanner.scanSymbol(sym)));
    }
    scanner.markSlowScanDone();

    // Features + Scoring + State para cada símbolo
    // Refresh tickers para tener precio actual
    const tickers = await binance.getAllTickers();
    const tickerMap = Object.fromEntries(tickers.map(t => [t.symbol, t]));
    updateTickerCache(tickers);

    const transitions = [];
    for (const symbol of universeSymbols) {
      try {
        const ticker = tickerMap[symbol];
        const features = { ...computeFeatures(symbol, ticker), ...btcCtx };
        const newListing = isNewListing(symbol);
        const { score, breakdown, penalties } = calculateScore(features, cfg.scoring, newListing);

        saveFeatures(symbol, features.timestamp, features, score, breakdown, penalties);

        if (!apiPaused) {
          const { state, transitioned, prevState } = processState(
            symbol, score, features, cfg.stateMachine, newListing
          );

          if (transitioned && ALERT_STATES.includes(state)) {
            await alerts.sendAlert(state, symbol, score, features, breakdown, penalties);
            transitions.push({ symbol, from: prevState, to: state, score });
          }
        }
      } catch (err) {
        log.warn({ symbol, err: err.message }, 'Error procesando símbolo');
      }
    }

    consecutiveFailures = 0;
    if (apiPaused) {
      apiPaused = false;
      await alerts.sendSystemAlert('recovered');
    }

    const duration = nowMs() - cycleStart;
    log.info({ cycle: cycleCount, duration, transitions: transitions.length }, 'Ciclo completado');

    // Push SSE a la Status Page
    const botStatus = { cycleCount, lastCycleDurationMs: duration, symbolsScanned: universeSymbols.length, apiHealth: 'OK', mode: cfg.mode };
    updateBotStatus(botStatus);
    sseManager.broadcast('cycle', { status: botStatus });

  } catch (err) {
    consecutiveFailures++;
    log.error({ err: err.message, consecutive: consecutiveFailures }, 'Error en ciclo');

    if (consecutiveFailures >= cfg.healthMonitor.maxConsecutiveFailures) {
      if (!apiPaused) {
        apiPaused = true;
        const mins = Math.round(consecutiveFailures * cfg.scanner.scanIntervalMs / 60000);
        await alerts.sendSystemAlert('down', mins);
        updateBotStatus({ apiHealth: 'DOWN' });
      }
    }
  }
}

// ── Arranque ─────────────────────────────────────────────────────────────────
async function main() {
  // Primera pasada de universo (sin esperar el intervalo)
  lastUniverseRefresh = 0;
  await refreshUniverse().catch(err => log.warn({ err: err.message }, 'Falló primer refresh'));

  log.info({ interval: cfg.scanner.scanIntervalMs }, 'Bot iniciado. Comenzando ciclos...');
  await runCycle();

  setInterval(runCycle, cfg.scanner.scanIntervalMs);
}

main().catch(err => {
  log.error({ err: err.message }, 'Error fatal en main()');
  process.exit(1);
});
