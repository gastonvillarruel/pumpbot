/**
 * src/storage/database.js
 * Inicialización y esquema de la base de datos SQLite.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

let _db = null;

/**
 * Inicializa la conexión SQLite y crea todas las tablas.
 * @param {string} dbPath - Ruta al archivo .db.
 * @param {boolean} walMode - Activar WAL mode.
 * @returns {import('better-sqlite3').Database}
 */
export function initDatabase(dbPath, walMode = true) {
  if (_db) return _db;

  const absPath = resolve(dbPath);
  const dir = dirname(absPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new DatabaseSync(absPath);

  if (walMode) {
    _db.exec('PRAGMA journal_mode = WAL');
  }
  _db.exec('PRAGMA foreign_keys = ON');
  _db.exec('PRAGMA synchronous = NORMAL');
  _db.exec('PRAGMA cache_size = -32000'); // 32MB cache

  _createTables(_db);
  _migrate(_db);

  return _db;
}

/**
 * Retorna la instancia de DB. Lanza si no fue inicializada.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  if (!_db) throw new Error('Database no inicializada. Llamar initDatabase() primero.');
  return _db;
}

/** Solo para tests. */
export function _resetDb() {
  if (_db) { _db.close(); _db = null; }
}

// ─── Creación de tablas ───────────────────────────────────────────────────────

function _createTables(db) {
  db.exec(`
    -- Versión del esquema para migraciones futuras
    CREATE TABLE IF NOT EXISTS schema_version (
      version   INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    -- Símbolos del universo
    CREATE TABLE IF NOT EXISTS symbols (
      symbol          TEXT PRIMARY KEY,
      base_asset      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'TRADING',
      price_precision INTEGER NOT NULL DEFAULT 8,
      qty_precision   INTEGER NOT NULL DEFAULT 8,
      min_notional    REAL,
      is_new_listing  INTEGER NOT NULL DEFAULT 0,
      listed_at       INTEGER,
      updated_at      INTEGER NOT NULL
    );

    -- Velas OHLCV
    CREATE TABLE IF NOT EXISTS candles (
      symbol                  TEXT NOT NULL,
      interval                TEXT NOT NULL,
      open_time               INTEGER NOT NULL,
      open                    REAL NOT NULL,
      high                    REAL NOT NULL,
      low                     REAL NOT NULL,
      close                   REAL NOT NULL,
      volume                  REAL NOT NULL,
      quote_volume            REAL NOT NULL,
      trades_count            INTEGER NOT NULL DEFAULT 0,
      taker_buy_volume        REAL NOT NULL DEFAULT 0,
      taker_buy_quote_volume  REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (symbol, interval, open_time)
    );
    CREATE INDEX IF NOT EXISTS idx_candles_symbol_interval
      ON candles (symbol, interval, open_time DESC);

    -- Open Interest snapshots
    CREATE TABLE IF NOT EXISTS open_interest (
      symbol      TEXT NOT NULL,
      timestamp   INTEGER NOT NULL,
      oi_value    REAL NOT NULL,
      oi_notional REAL,
      interval    TEXT NOT NULL DEFAULT 'snapshot',
      PRIMARY KEY (symbol, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_oi_symbol_ts
      ON open_interest (symbol, timestamp DESC);

    -- Funding rates
    CREATE TABLE IF NOT EXISTS funding_rates (
      symbol       TEXT NOT NULL,
      funding_time INTEGER NOT NULL,
      funding_rate REAL NOT NULL,
      mark_price   REAL,
      PRIMARY KEY (symbol, funding_time)
    );
    CREATE INDEX IF NOT EXISTS idx_funding_symbol_ts
      ON funding_rates (symbol, funding_time DESC);

    -- Features calculados (JSON compacto para MVP)
    CREATE TABLE IF NOT EXISTS calculated_features (
      symbol              TEXT NOT NULL,
      timestamp           INTEGER NOT NULL,
      features_json       TEXT NOT NULL,
      score               REAL NOT NULL,
      score_breakdown_json TEXT,
      penalties_json      TEXT,
      PRIMARY KEY (symbol, timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_features_symbol_ts
      ON calculated_features (symbol, timestamp DESC);

    -- Estado actual de cada símbolo
    CREATE TABLE IF NOT EXISTS symbol_states (
      symbol             TEXT PRIMARY KEY,
      current_state      TEXT NOT NULL DEFAULT 'NORMAL',
      state_since        INTEGER NOT NULL,
      previous_state     TEXT,
      consecutive_cycles INTEGER NOT NULL DEFAULT 0,
      cooldown_until     INTEGER,
      last_score         REAL NOT NULL DEFAULT 0,
      entry_price        REAL,
      peak_score         REAL NOT NULL DEFAULT 0,
      updated_at         INTEGER NOT NULL
    );

    -- Historial de transiciones de estado
    CREATE TABLE IF NOT EXISTS state_transitions (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol                  TEXT NOT NULL,
      from_state              TEXT NOT NULL,
      to_state                TEXT NOT NULL,
      score                   REAL NOT NULL,
      price                   REAL,
      features_snapshot_json  TEXT,
      timestamp               INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transitions_symbol_ts
      ON state_transitions (symbol, timestamp DESC);

    -- Alertas enviadas (o logueadas en shadow mode)
    CREATE TABLE IF NOT EXISTS alerts_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol           TEXT NOT NULL,
      state            TEXT NOT NULL,
      score            REAL NOT NULL,
      message          TEXT,
      mode             TEXT NOT NULL DEFAULT 'shadow',
      sent_at          INTEGER NOT NULL,
      telegram_success INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_symbol_ts
      ON alerts_log (symbol, sent_at DESC);

    -- Resultados post-alerta (se llena progresivamente)
    CREATE TABLE IF NOT EXISTS alert_outcomes (
      id              INTEGER PRIMARY KEY,
      symbol          TEXT NOT NULL,
      alert_state     TEXT NOT NULL,
      alert_price     REAL NOT NULL,
      price_1h        REAL,
      price_4h        REAL,
      price_12h       REAL,
      price_24h       REAL,
      return_1h       REAL,
      return_4h       REAL,
      return_12h      REAL,
      return_24h      REAL,
      max_return_24h  REAL,
      max_drawdown_24h REAL,
      evaluated_at    INTEGER,
      FOREIGN KEY (id) REFERENCES alerts_log(id)
    );

    -- Ticker 24h cacheado (para filtrado de universo)
    CREATE TABLE IF NOT EXISTS ticker_cache (
      symbol        TEXT PRIMARY KEY,
      price         REAL NOT NULL,
      price_change_pct REAL NOT NULL,
      volume_usdt   REAL NOT NULL,
      high_24h      REAL NOT NULL,
      low_24h       REAL NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
}

// ─── Migraciones ─────────────────────────────────────────────────────────────

const CURRENT_SCHEMA_VERSION = 1;

function _migrate(db) {
  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get();
  const currentVersion = row?.v ?? 0;

  if (currentVersion < 1) {
    // v1 = esquema inicial, ya creado en _createTables
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(1, Date.now());
  }

  // Aquí se agregarán futuras migraciones:
  // if (currentVersion < 2) { ... }
}

/**
 * Cierra la conexión DB (usar en shutdown).
 */
export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}
