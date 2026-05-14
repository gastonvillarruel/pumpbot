# PUMP-BOT MVP — Plan de Implementación

## Contexto

Las 20 decisiones del usuario resuelven las 20 preguntas críticas del plan de arquitectura. Este documento traduce esas decisiones en cambios concretos al plan y define el orden de implementación.

## Decisiones Integradas (Resumen de Impacto)

| # | Decisión | Impacto en código |
|---|---|---|
| 1 | Solo Binance Futures USDT-M | Sin cambios, ya previsto |
| 2 | No Spot | Sin cambios |
| 3 | Pump extremo = +100% en 24h | Constante en config para labeling/backtesting |
| 4 | Operativo = +50%/12h, seguimiento +20/+30% post-alerta | **Nuevo**: tabla `alert_outcomes` para medir resultado |
| 5 | Anticipación 2-6h | Afecta calibración de umbrales WATCH |
| 6 | WATCH temprano + PRE_PUMP selectivo | Ya previsto en state machine |
| 7 | Max 5-10 WATCH/día, 1-3 PRE_PUMP, 0-1 IGNITION | Config de alertas + ajuste de umbrales |
| 8 | REST polling 60s | Sin cambios |
| 9 | Vol mínimo 1M USDT/24h configurable | Sin cambios, ya previsto |
| 10 | Operación manual 2-3 meses | Sin cambios, sin ejecución automática |
| 11 | BTC/ETH excluidos de alertas, BTC como contexto | Blacklist + feature `btc_context` |
| 12 | Nuevos listings con flag + reglas exigentes | **Nuevo**: campo `is_new_listing` en `symbols`, umbrales override |
| 13 | Guardar datos solo del universo filtrado | Sin cambios |
| 14 | RVOL simple por SMA; estacionalidad futura | Sin cambios |
| 15 | Binance falla >5 min → alerta sistema + pausa señales | **Nuevo**: health monitor en orchestrator |
| 16 | Desarrollo local, producción VPS | Sin cambios |
| 17 | Config versionada, secrets en .env | Sin cambios |
| 18 | Shadow/live mode desde inicio | **Nuevo**: flag `mode` en config + lógica en alert manager |
| 19 | Sin históricos; recolectar desde día 1 | z-scores arrancan con umbrales fijos 48h |
| 20 | Registrar cada alerta + resultado a 1h/4h/12h/24h | **Nuevo**: tabla `alert_outcomes` + job de evaluación |

---

## Cambios al Plan de Arquitectura

### 1. Nuevo: Shadow/Live Mode

```json
// En config
"mode": "shadow"  // "shadow" | "live"
```

- **shadow**: calcula todo, loguea alertas, guarda en DB, **NO envía a Telegram**.
- **live**: envía a Telegram normalmente.
- El alert manager chequea `config.mode` antes de enviar. En shadow, loguea `[SHADOW] Alerta que se habría enviado: ...`.

### 2. Nuevo: Tabla `alert_outcomes`

Para medir el resultado de cada alerta post-facto:

| Campo | Tipo | Descripción |
|---|---|---|
| id | INT PK | FK a `alerts_log.id` |
| symbol | TEXT | |
| alert_state | TEXT | Estado que disparó la alerta |
| alert_price | REAL | Precio al momento de la alerta |
| price_1h | REAL | Precio 1h después |
| price_4h | REAL | Precio 4h después |
| price_12h | REAL | Precio 12h después |
| price_24h | REAL | Precio 24h después |
| return_1h | REAL | % return a 1h |
| return_4h | REAL | % return a 4h |
| return_12h | REAL | % return a 12h |
| return_24h | REAL | % return a 24h |
| max_return_24h | REAL | Max return alcanzado en 24h (high watermark) |
| max_drawdown_24h | REAL | Max drawdown desde alerta en 24h |
| evaluated_at | INT | Timestamp de última evaluación |

Un job periódico (cada 5 min) revisa alertas pendientes de evaluación y llena los campos conforme pasa el tiempo.

### 3. Nuevo: Campos en `symbols`

```sql
ALTER TABLE symbols ADD COLUMN is_new_listing BOOLEAN DEFAULT 0;
ALTER TABLE symbols ADD COLUMN listed_at INT;  -- timestamp de primera detección
```

En la lógica de scoring, si `is_new_listing = true`:
- Multiplicar umbrales de entrada a WATCH por 1.5x.
- Requiere 3 ciclos consecutivos (en vez de 2) para entrar a WATCH.
- Flag se remueve automáticamente después de 7 días.

### 4. Nuevo: Health Monitor en Orchestrator

```
consecutiveApiFailures = 0

en cada ciclo:
  if (API falla):
    consecutiveApiFailures++
    if consecutiveApiFailures >= 5:  // ~5 min con ciclos de 60s
      enviar alerta sistema "⚠️ API UNREACHABLE desde hace X min"
      pausar nuevas transiciones de estado
  else:
    if consecutiveApiFailures >= 5:
      enviar alerta sistema "✅ API recuperada"
    consecutiveApiFailures = 0
```

### 5. BTC como Contexto

BTC y ETH en blacklist de alertas (decisión 11), pero BTC se escanea siempre para calcular:
- `btc_return_1h`: si < -2% → penalización -5, si < -5% → penalización -10.
- `btc_return_4h`: contexto adicional en alertas.

Implementación: BTC no está en `universe.blacklist` sino en una lista separada `universe.contextSymbols: ["BTCUSDT"]`. Se recolectan datos pero no se procesan por scoring/state machine.

---

## Alcance de Implementación

### Fase 0 — Fundación (3-5 días)

#### [NEW] package.json + estructura de carpetas
- Proyecto Node.js con ESM (`"type": "module"`)
- Dependencias: `better-sqlite3`, `pino`, `dotenv`, `node-fetch` (o built-in fetch), `ajv`
- Scripts: `start`, `setup-db`, `test`

#### [NEW] [src/utils/logger.js](file:///f:/Proyecto%20PUMP-bot/src/utils/logger.js)
- Pino configurado con rotación de archivos
- Niveles: error, warn, info, debug
- Formato JSON con timestamp, module, symbol

#### [NEW] [src/config/index.js](file:///f:/Proyecto%20PUMP-bot/src/config/index.js)
- Carga `config/default.json` + merge con `config/production.json` si existe
- Override por variables de entorno para secrets
- Validación con AJV contra schema
- **Incluye campo `mode: "shadow" | "live"`**
- Exporta objeto inmutable (Object.freeze)

#### [NEW] [src/config/defaults.js](file:///f:/Proyecto%20PUMP-bot/src/config/defaults.js)
- Todos los valores por defecto del plan de arquitectura (parte 4, sección 15)
- Incluye `pumpDefinitions` para tracking:
  ```json
  "pumpDefinitions": {
    "extreme": { "returnPct": 100, "windowHours": 24 },
    "strong": { "returnPct": 50, "windowHours": 12 },
    "postAlertTargets": [20, 30, 50]
  }
  ```

#### [NEW] [src/config/schema.js](file:///f:/Proyecto%20PUMP-bot/src/config/schema.js)
- Schema AJV para validar config

#### [NEW] [src/storage/database.js](file:///f:/Proyecto%20PUMP-bot/src/storage/database.js)
- Inicialización SQLite con `better-sqlite3`
- WAL mode activado
- Creación de todas las tablas (incluyendo `alert_outcomes` y campos nuevos de `symbols`)
- Migraciones básicas (versión de schema)

#### [NEW] [src/storage/candles.js](file:///f:/Proyecto%20PUMP-bot/src/storage/candles.js)
- UPSERT candles, query por símbolo/intervalo/rango

#### [NEW] [src/storage/openInterest.js](file:///f:/Proyecto%20PUMP-bot/src/storage/openInterest.js)
- UPSERT OI snapshots, query histórico

#### [NEW] [src/storage/funding.js](file:///f:/Proyecto%20PUMP-bot/src/storage/funding.js)
- UPSERT funding rates

#### [NEW] [src/storage/features.js](file:///f:/Proyecto%20PUMP-bot/src/storage/features.js)
- Guardar/leer features calculados (JSON)

#### [NEW] [src/storage/states.js](file:///f:/Proyecto%20PUMP-bot/src/storage/states.js)
- CRUD symbol_states + state_transitions

#### [NEW] [src/storage/alerts.js](file:///f:/Proyecto%20PUMP-bot/src/storage/alerts.js)
- CRUD alerts_log + alert_outcomes

#### [NEW] [src/utils/math.js](file:///f:/Proyecto%20PUMP-bot/src/utils/math.js)
- SMA, z-score, lerp, clamp, percentile

#### [NEW] [src/utils/time.js](file:///f:/Proyecto%20PUMP-bot/src/utils/time.js)
- Helpers de timestamps, conversiones

#### [NEW] [config/default.json](file:///f:/Proyecto%20PUMP-bot/config/default.json)
- Config completa del plan parte 4, ajustada con decisiones del usuario

#### [NEW] [config/.env.example](file:///f:/Proyecto%20PUMP-bot/config/.env.example)
- Template de variables de entorno

#### [NEW] [scripts/setup-db.js](file:///f:/Proyecto%20PUMP-bot/scripts/setup-db.js)
- Inicializar/resetear DB

---

### Fase 1 — Scanner + Features + Scoring + Alertas (5-7 días)

#### [NEW] src/exchanges/binance.js
- Client REST para todos los endpoints de la tabla de fuentes de datos
- Rate limiter integrado

#### [NEW] src/exchanges/rateLimiter.js
- Queue con concurrencia limitada, tracking de weight

#### [NEW] src/scanner/marketScanner.js
- Orquesta ciclo de escaneo

#### [NEW] src/scanner/universe.js
- Filtrado de universo + detección de nuevos listings + `contextSymbols`

#### [NEW] src/features/ (todos los archivos)
- volume.js, priceAction.js, derivatives.js, helpers.js

#### [NEW] src/scoring/ (todos los archivos)
- index.js, weights.js, penalties.js

#### [NEW] src/state/stateMachine.js
- Estados MVP: NORMAL, WATCH, PRE_PUMP, IGNITION
- Histéresis, cooldowns, timeouts
- Reglas de new_listing más exigentes

#### [NEW] src/alerts/telegram.js
- Client Telegram Bot API

#### [NEW] src/alerts/formatter.js
- Formatos diferenciados por estado

#### [NEW] src/alerts/rateLimiter.js
- Control de spam, deduplicación, agrupamiento

#### [NEW] src/main.js
- Orchestrator: loop principal
- Health monitor de API
- Shadow/live mode check
- Job de evaluación de alert_outcomes
- Graceful shutdown

---

## Verificación

### Fase 0
- `npm start` arranca sin errores, crea la DB con todas las tablas
- Config carga correctamente con defaults y valida
- Logger escribe a archivo y consola
- Script `setup-db.js` crea/resetea la DB

### Fase 1
- Bot corre 24h sin crash
- Escanea ~150-200 símbolos por ciclo en <60s
- Calcula features correctamente (verificar con datos manuales)
- Score produce rangos coherentes
- En shadow mode: loguea alertas que habría enviado
- En live mode: envía alertas a Telegram
- `alert_outcomes` se llenan progresivamente
- BTC excluido de alertas pero presente como contexto
- Nuevos listings detectados con flag
- API failure >5 min genera alerta de sistema

### Tests unitarios
- Features con datos sintéticos
- Scoring con fixtures conocidos
- State machine con secuencias de scores
- Math helpers (SMA, z-score, lerp)

---

## Open Questions

> [!IMPORTANT]
> **¿Algún ajuste a los umbrales de la state machine?** El plan propone WATCH a score ≥ 40 (2 ciclos), PRE_PUMP a ≥ 70, IGNITION a ≥ 80. ¿Estos valores iniciales te parecen razonables para empezar en shadow mode, o preferís arrancar con umbrales más altos para menos ruido?

> [!NOTE]
> **Nuevos listings**: propongo que un símbolo sea `is_new_listing = true` durante 7 días desde su primera detección. ¿Te parece bien ese período, o preferís otro?
