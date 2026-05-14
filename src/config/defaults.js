/**
 * src/config/defaults.js
 * Valores por defecto explícitos. Sirven como documentación y como fallback.
 * No usar directamente — el config manager hace merge con default.json.
 */

export const DEFAULTS = {
  mode: 'shadow',

  exchange: {
    name: 'binance_futures',
    baseUrl: 'https://fapi.binance.com',
    rateLimitPerMinute: 1200,
    requestTimeout: 10000,
    retryAttempts: 3,
    retryDelayMs: 1000,
  },

  scanner: {
    scanIntervalMs: 60000,
    intensiveScanIntervalMs: 30000,
    maxHotSymbols: 20,
    refreshUniverseIntervalMs: 3600000,
  },

  universe: {
    minVolume24hUsdt: 1_000_000,
    maxVolume24hUsdt: null,
    excludeStablecoins: true,
    blacklist: ['ETHUSDT'],
    contextSymbols: ['BTCUSDT'],
    whitelist: [],
  },

  newListing: {
    flagDurationDays: 7,
    scoreThresholdMultiplier: 1.5,
    minCyclesForWatch: 3,
  },

  stateMachine: {
    watchEntry: { minScore: 40, minCycles: 2 },
    watchExit: { maxScore: 35, minCycles: 3, timeoutMinutes: 120 },
    prePumpEntry: { minScore: 70, minSignals: 2 },
    prePumpExit: { maxScore: 50, minCycles: 3, timeoutMinutes: 60 },
    ignitionEntry: { minScore: 80, requireBreakout: true },
    ignitionExit: { maxScore: 60 },
    confirmedEntry: { minScore: 85 },
    confirmedExit: { maxScore: 70 },
    lateDanger: {
      fundingThreshold: 0.0005,
      extensionThreshold: 25,
      wickThreshold: 0.6,
    },
    cooldowns: {
      normalAfterIgnitionMinutes: 120,
      normalAfterWatchMinutes: 30,
      normalAfterLateDangerMinutes: 120,
    },
  },

  alerts: {
    maxPerHour: 15,
    deduplicationMinutes: 10,
    groupWatchThreshold: 5,
    quietHours: { start: '02:00', end: '06:00', timezone: 'UTC' },
    quietHoursMinState: 'PRE_PUMP',
  },

  storage: {
    dbPath: './data/pumpbot.db',
    walMode: true,
    retentionDays: 90,
  },

  logging: {
    level: 'info',
    dir: './data/logs',
    maxSize: '50m',
    maxFiles: 5,
  },

  statusPage: {
    enabled: true,
    port: 3847,
    host: '0.0.0.0',
  },

  healthMonitor: {
    maxConsecutiveFailures: 5,
  },

  pumpDefinitions: {
    extreme: { returnPct: 100, windowHours: 24 },
    strong: { returnPct: 50, windowHours: 12 },
    postAlertTargets: [20, 30, 50],
  },

  alertOutcomes: {
    checkIntervalMs: 300_000,
    evaluateAt: [1, 4, 12, 24],
  },
};

// Estados posibles del sistema
export const STATES = {
  NORMAL: 'NORMAL',
  WATCH: 'WATCH',
  PRE_PUMP: 'PRE_PUMP',
  IGNITION: 'IGNITION',
  CONFIRMED: 'CONFIRMED',
  LATE_DANGER: 'LATE_DANGER',
};

// Stablecoins a excluir del universo
export const STABLECOINS = new Set([
  'USDCUSDT', 'BUSDUSDT', 'DAIUSDT', 'TUSDUSDT',
  'USDPUSDT', 'FRAXUSDT', 'USTCUSDT', 'EURUSDT',
  'GBPUSDT', 'FDUSDUSDT',
]);

// Sufijos de pares USDT-M
export const USDT_SUFFIX = 'USDT';
