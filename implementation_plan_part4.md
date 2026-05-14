# PUMP-BOT: Plan de Arquitectura — Parte 4/5

## 12. ROADMAP POR FASES

### Fase 0 — Fundación (3-5 días)

**Objetivo:** Estructura del proyecto, configuración, storage, logging.

**Entregables:**
- Proyecto Node.js inicializado con ESM.
- `config.json` con todos los parámetros.
- Config manager con validación y defaults.
- Storage layer SQLite con esquema completo.
- Logger estructurado (winston o pino).
- Scripts de inicialización y reset de DB.

**Dificultad:** Baja.
**Riesgos:** Ninguno significativo.
**Criterio de fin:** `npm start` arranca sin errores, crea la DB, loguea correctamente.
**Tests:** Config carga correctamente con defaults. DB se inicializa con todas las tablas.

---

### Fase 1 — Scanner básico + Alertas (5-7 días)

**Objetivo:** Escanear Binance Futures, calcular features core, scoring simple, alertas Telegram.

**Entregables:**
- Exchange client Binance con rate limiting.
- Market scanner con filtrado de universo.
- Feature engine: RVOL, vol z-score, OI change, OI z-score, funding rate, price return, price extension.
- Scoring engine con pesos configurables.
- Alert manager Telegram funcional.
- Orchestrator con loop principal.

**Dificultad:** Media.
**Riesgos:**
- Rate limits de Binance si el universo es grande → mitigar con batching.
- OI histórico limitado en primeros días → manejar gracefully.
**Criterio de fin:** Bot corriendo 24h sin crash, enviando alertas WATCH a Telegram cuando hay anomalías reales.
**Tests:** Features calculan correctamente con datos mock. Scoring produce rangos esperados. Telegram envía mensajes.

---

### Fase 2 — State Machine + Compresión + Breakout (4-5 días)

**Objetivo:** Máquina de estados completa, detección de compresión y breakout.

**Entregables:**
- State machine con todos los estados y transiciones.
- Features: BBW (compresión), ATR%, rango lateral, breakout de highs.
- Histéresis, cooldowns, timeouts.
- Monitoreo intensivo para hot symbols.
- Alertas diferenciadas por estado.

**Dificultad:** Media-alta.
**Riesgos:**
- Calibración de histéresis/timeouts → requiere observación empírica.
- Hot symbols aumentan requests → monitorear rate limits.
**Criterio de fin:** Símbolos transicionan correctamente entre estados. No hay oscilaciones. Alertas PRE-PUMP son selectivas.
**Tests:** State machine con secuencias de scores conocidos produce transiciones esperadas.

---

### Fase 3 — Trades en tiempo real (5-7 días)

**Objetivo:** WebSocket de aggTrades para símbolos calientes, CVD, taker ratio real.

**Entregables:**
- WebSocket manager con reconexión automática.
- Procesador de aggTrades: acumulación de CVD, taker buy/sell volumes.
- Features: CVD, taker buy ratio real, volume delta.
- Integración con scoring (peso de microestructura sube a 10%).
- Datos de liquidaciones si disponibles.

**Dificultad:** Alta.
**Riesgos:**
- WebSocket de muchos símbolos simultáneos consume memoria y conexiones.
- Reconexiones pueden perder datos → buffer de recovery.
**Criterio de fin:** CVD calculado en real-time para hot symbols. Scoring mejorado con datos de trades.
**Tests:** CVD coincide con cálculo manual sobre datos históricos.

---

### Fase 4 — Order Book (5-7 días)

**Objetivo:** Análisis de profundidad de mercado para símbolos calientes.

**Entregables:**
- WebSocket de depth para hot symbols.
- Features: bid/ask imbalance, ask depth thinning, sweep detection.
- Spoofing detection básico (penalización).
- Integración con scoring (microestructura sube a 15%).

**Dificultad:** Alta.
**Riesgos:**
- Order book data es voluminoso y ruidoso.
- Spoofing detection tiene muchos falsos positivos.
**Criterio de fin:** Imbalance y ask thinning aportan valor medible al scoring.
**Tests:** Imbalance score es consistente con observación manual del order book.

---

### Fase 5 — Backtesting serio (7-10 días)

**Objetivo:** Reproducir pipeline sobre datos históricos, evaluar y optimizar.

**Entregables:**
- Backtester que replica pipeline en modo offline.
- Etiquetador de eventos pump.
- Generador de reportes (precision, recall, timing).
- Comparador de configuraciones de pesos.
- Walk-forward validation.

**Dificultad:** Alta.
**Riesgos:**
- OI histórico limitado reduce calidad del backtest.
- Sobreoptimización si se ajustan muchos parámetros → disciplina.
**Criterio de fin:** Reporte de backtesting muestra precision > 30% con recall > 20% para pumps de +50%.
**Tests:** Backtester sobre datos conocidos reproduce resultados esperados.

---

### Fase 6 — Multi-exchange / CoinGlass (5-7 días)

**Objetivo:** Agregar fuentes de datos adicionales.

**Entregables:**
- Client CoinGlass (OI multi-exchange, liquidaciones, funding global).
- Normalización de datos multi-fuente.
- Abstracción de exchange client para soportar Bybit/OKX.
- OI total (no solo Binance) como feature mejorado.

**Dificultad:** Media.
**Riesgos:** Costos de API CoinGlass. Diferencias en formato de datos entre exchanges.
**Criterio de fin:** OI multi-exchange funciona y mejora calidad de señales en backtest.

---

### Fase 7 — Social / On-chain (7-10 días)

**Objetivo:** Capa de sentimiento y datos on-chain.

**Entregables:**
- Client LunarCrush o Santiment.
- Social volume z-score como feature.
- Client DexScreener para DEX volume.
- Exchange netflow si hay fuente accesible.
- Peso de social/on-chain sube a 10% del score.

**Dificultad:** Media-alta.
**Riesgos:** APIs de social son caras y ruidosas. Latencia alta en datos on-chain.
**Criterio de fin:** Social z-score aporta valor detectable en backtest.

---

## 13. ESTRUCTURA DE CARPETAS

```
pump-bot/
├── src/
│   ├── config/
│   │   ├── index.js          # Carga, valida y exporta config
│   │   ├── defaults.js       # Valores por defecto
│   │   └── schema.js         # Validación de esquema (joi o ajv)
│   │
│   ├── exchanges/
│   │   ├── binance.js         # Client REST Binance Futures
│   │   ├── binanceWs.js       # Client WebSocket Binance (Fase 3)
│   │   └── rateLimiter.js     # Queue con rate limiting adaptativo
│   │
│   ├── scanner/
│   │   ├── marketScanner.js   # Orquesta escaneo de universo
│   │   ├── universe.js        # Filtrado de símbolos activos
│   │   └── hotSymbols.js      # Gestión de símbolos en monitoreo intensivo
│   │
│   ├── features/
│   │   ├── index.js           # Orquesta cálculo de todos los features
│   │   ├── volume.js          # RVOL, vol z-score, vol trend
│   │   ├── priceAction.js     # Returns, extension, breakout, compresión
│   │   ├── derivatives.js     # OI change, OI z-score, funding, divergence
│   │   ├── microstructure.js  # CVD, taker ratio, imbalance (Fase 3-4)
│   │   └── helpers.js         # SMA, z-score, lerp, percentile
│   │
│   ├── scoring/
│   │   ├── index.js           # Score total + breakdown
│   │   ├── weights.js         # Pesos por categoría (lee de config)
│   │   └── penalties.js       # Sistema de penalizaciones
│   │
│   ├── state/
│   │   ├── stateMachine.js    # Lógica de transiciones
│   │   ├── states.js          # Definición de estados y reglas
│   │   └── cooldowns.js       # Gestión de cooldowns y timeouts
│   │
│   ├── alerts/
│   │   ├── telegram.js        # Client Telegram Bot API
│   │   ├── formatter.js       # Formatea mensajes por tipo de estado
│   │   └── rateLimiter.js     # Control de spam de alertas
│   │
│   ├── storage/
│   │   ├── database.js        # Inicialización SQLite, migraciones
│   │   ├── candles.js         # CRUD candles
│   │   ├── openInterest.js    # CRUD OI
│   │   ├── funding.js         # CRUD funding
│   │   ├── features.js        # CRUD features calculados
│   │   ├── states.js          # CRUD estados de símbolos
│   │   └── alerts.js          # CRUD alertas enviadas
│   │
│   ├── backtesting/           # (Fase 5)
│   │   ├── runner.js          # Motor de backtesting
│   │   ├── labeler.js         # Etiquetador de eventos pump
│   │   └── reporter.js        # Generador de reportes
│   │
│   ├── utils/
│   │   ├── logger.js          # Winston/Pino configurado
│   │   ├── math.js            # Funciones matemáticas puras
│   │   └── time.js            # Helpers de timestamps
│   │
│   └── main.js                # Orchestrator / entry point
│
├── config/
│   ├── default.json           # Config por defecto
│   ├── production.json        # Overrides producción
│   └── .env.example           # Template de variables de entorno
│
├── scripts/
│   ├── setup-db.js            # Inicializar/resetear DB
│   ├── test-telegram.js       # Probar conexión Telegram
│   ├── test-binance.js        # Probar conexión Binance
│   └── download-history.js    # Descargar datos históricos (backtesting)
│
├── data/                      # SQLite DB file, logs
│   └── .gitkeep
│
├── tests/
│   ├── features/
│   ├── scoring/
│   ├── state/
│   └── helpers/
│
├── package.json
├── .env
├── .gitignore
└── README.md
```

---

## 14. MODELO DE DATOS

### Tabla: `symbols`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT PK | Ej: "XYZUSDT" |
| base_asset | TEXT | Ej: "XYZ" |
| status | TEXT | "TRADING", "BREAK" |
| price_precision | INT | Decimales de precio |
| qty_precision | INT | Decimales de cantidad |
| min_notional | REAL | Valor mínimo de orden |
| updated_at | INT | Timestamp última actualización |

### Tabla: `candles`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT | FK a symbols |
| interval | TEXT | "1m", "5m", "15m", "1h", "4h" |
| open_time | INT | Timestamp apertura (ms) |
| open | REAL | |
| high | REAL | |
| low | REAL | |
| close | REAL | |
| volume | REAL | Volume en base asset |
| quote_volume | REAL | Volume en USDT |
| trades_count | INT | Número de trades |
| taker_buy_volume | REAL | Vol comprador |
| taker_buy_quote_volume | REAL | Vol comprador en USDT |
| PK | | (symbol, interval, open_time) |

### Tabla: `open_interest`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT | |
| timestamp | INT | |
| oi_value | REAL | OI en contratos |
| oi_notional | REAL | OI en USDT |
| interval | TEXT | "5m", "15m", "1h" — de dónde viene |
| PK | | (symbol, timestamp) |

### Tabla: `funding_rates`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT | |
| funding_time | INT | Timestamp del funding |
| funding_rate | REAL | Rate actual |
| mark_price | REAL | Precio al momento |
| PK | | (symbol, funding_time) |

### Tabla: `calculated_features`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT | |
| timestamp | INT | Momento del cálculo |
| features_json | TEXT | JSON con todos los features calculados |
| score | REAL | Score total |
| score_breakdown_json | TEXT | JSON con desglose |
| penalties_json | TEXT | JSON con penalizaciones |
| PK | | (symbol, timestamp) |

> Nota: Guardar features como JSON en MVP es pragmático. Si el volumen crece, migrar a columnas individuales o TimescaleDB.

### Tabla: `symbol_states`

| Campo | Tipo | Descripción |
|---|---|---|
| symbol | TEXT PK | |
| current_state | TEXT | NORMAL/WATCH/PRE-PUMP/IGNITION/CONFIRMED/LATE_DANGER |
| state_since | INT | Timestamp de entrada al estado actual |
| previous_state | TEXT | Estado anterior |
| consecutive_cycles | INT | Ciclos consecutivos en este estado |
| cooldown_until | INT | Timestamp hasta cuándo tiene cooldown |
| last_score | REAL | Último score calculado |
| entry_price | REAL | Precio al entrar al primer estado no-NORMAL |
| peak_score | REAL | Score máximo alcanzado |
| updated_at | INT | |

### Tabla: `state_transitions`

| Campo | Tipo | Descripción |
|---|---|---|
| id | INT PK | Autoincrement |
| symbol | TEXT | |
| from_state | TEXT | |
| to_state | TEXT | |
| score | REAL | Score al momento de la transición |
| price | REAL | Precio al momento |
| features_snapshot_json | TEXT | Snapshot de features |
| timestamp | INT | |

### Tabla: `alerts_log`

| Campo | Tipo | Descripción |
|---|---|---|
| id | INT PK | |
| symbol | TEXT | |
| state | TEXT | Estado que disparó la alerta |
| score | REAL | |
| message | TEXT | Mensaje enviado |
| sent_at | INT | |
| telegram_success | BOOL | |

---

## 15. CONFIGURACIÓN

### `config/default.json` — Estructura propuesta

```json
{
  "exchange": {
    "name": "binance_futures",
    "baseUrl": "https://fapi.binance.com",
    "rateLimitPerMinute": 1200,
    "requestTimeout": 10000,
    "retryAttempts": 3,
    "retryDelayMs": 1000
  },

  "scanner": {
    "scanIntervalMs": 60000,
    "intensiveScanIntervalMs": 30000,
    "maxHotSymbols": 20,
    "refreshUniverseIntervalMs": 3600000
  },

  "universe": {
    "minVolume24hUsdt": 1000000,
    "maxVolume24hUsdt": null,
    "excludeStablecoins": true,
    "blacklist": ["BTCUSDT", "ETHUSDT"],
    "whitelist": []
  },

  "features": {
    "rvol": {
      "period": 20,
      "timeframes": ["1m", "5m", "1h"]
    },
    "volumeZscore": {
      "period": 100,
      "timeframes": ["5m", "1h"]
    },
    "oiChange": {
      "timeframes": ["5m", "15m", "1h", "4h"]
    },
    "oiZscore": {
      "period": 48,
      "interval": "1h"
    },
    "bbw": {
      "period": 20,
      "stddev": 2,
      "percentileWindow": 168,
      "timeframe": "1h"
    },
    "breakout": {
      "windows": [1, 4, 12, 24, 72]
    },
    "priceExtension": {
      "maPeriod": 20,
      "timeframe": "1h"
    }
  },

  "scoring": {
    "weights": {
      "accumulation": 30,
      "volume": 25,
      "priceAction": 25,
      "derivatives": 15,
      "microstructure": 5
    },
    "penalties": {
      "priceExtended10pct": -10,
      "priceExtended20pct": -20,
      "priceExtended30pct": -25,
      "fundingHot003": -10,
      "fundingHot005": -15,
      "fundingHot01": -20,
      "lowVolume500k": -10,
      "lowVolume1m": -5,
      "highSpread01pct": -5,
      "btcDown2pct": -5,
      "btcDown5pct": -10,
      "suspiciousVolume": -10,
      "upperWick60pct": -5
    }
  },

  "stateMachine": {
    "watchEntry": { "minScore": 40, "minCycles": 2 },
    "watchExit": { "maxScore": 35, "minCycles": 3, "timeoutMinutes": 120 },
    "prePumpEntry": { "minScore": 70, "minSignals": 2 },
    "prePumpExit": { "maxScore": 50, "minCycles": 3, "timeoutMinutes": 60 },
    "ignitionEntry": { "minScore": 80, "requireBreakout": true },
    "ignitionExit": { "maxScore": 60 },
    "confirmedEntry": { "minScore": 85 },
    "confirmedExit": { "maxScore": 70 },
    "lateDanger": {
      "fundingThreshold": 0.0005,
      "extensionThreshold": 25,
      "wickThreshold": 0.6
    },
    "cooldowns": {
      "normalAfterIgnitionMinutes": 120,
      "normalAfterWatchMinutes": 30,
      "normalAfterLateDangerMinutes": 120
    }
  },

  "alerts": {
    "maxPerHour": 15,
    "deduplicationMinutes": 10,
    "groupWatchThreshold": 5,
    "quietHours": { "start": "02:00", "end": "06:00", "timezone": "UTC" },
    "quietHoursMinState": "PRE_PUMP"
  },

  "telegram": {
    "chatId": "",
    "parseMode": "HTML"
  },

  "storage": {
    "dbPath": "./data/pumpbot.db",
    "walMode": true,
    "retentionDays": 90
  },

  "logging": {
    "level": "info",
    "file": "./data/pumpbot.log",
    "maxSize": "50m",
    "maxFiles": 5
  }
}
```

**Secrets via `.env`:**
```
BINANCE_API_KEY=xxx
BINANCE_API_SECRET=xxx
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx
```
