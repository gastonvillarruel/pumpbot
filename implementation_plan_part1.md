# PUMP-BOT: Plan de Arquitectura — Parte 1/4

## 1. VISIÓN GENERAL DEL PROYECTO

### Qué estamos construyendo
Un radar de anomalías en tiempo real para criptomonedas en Binance Futures. El sistema escanea continuamente todos los pares USDT perpetuos, detecta patrones de acumulación y actividad anormal **antes** de que el precio explote, y envía alertas clasificadas a Telegram.

### Qué problema resuelve
Los pumps extremos (+100%) no ocurren de la nada. Antes de la explosión hay señales detectables: volumen creciendo desde niveles bajos, Open Interest acumulándose mientras el precio sigue lateral, order book adelgazándose por arriba, funding todavía neutro. Un humano no puede monitorear 200+ pares simultáneamente buscando estas convergencias. El bot sí.

### Qué NO intenta resolver
- **No es un bot de ejecución automática.** No compra ni vende. Es un sistema de alerta.
- **No detecta pumps de 3-10%.** Esos son ruido. El foco es movimientos de +50% a +100%+.
- **No predice con certeza.** Ningún sistema puede. Busca convergencias de señales que históricamente preceden pumps extremos.
- **No reemplaza el juicio del trader.** Presenta datos procesados y un score; la decisión final es humana.

### Lógica central
```
Escaneo continuo → Detección de anomalías → Clasificación por score →
Máquina de estados (NORMAL→WATCH→PRE-PUMP→IGNITION→CONFIRMED→LATE/DANGER) →
Alerta contextualizada a Telegram
```

El sistema prioriza **sensibilidad temprana sobre precisión perfecta** en las fases iniciales (WATCH), y va ganando confianza a medida que las señales convergen (PRE-PUMP → IGNITION).

---

## 2. OBJETIVO REALISTA DEL MVP

El MVP debe lograr exactamente esto:

1. **Escanear todos los pares USDT perpetuos de Binance Futures** cada 60 segundos.
2. **Calcular 8-10 features core** por símbolo: RVOL, z-score de volumen, cambio de OI, funding rate, compresión de volatilidad, breakout de highs, retorno de precio, extensión del precio.
3. **Generar un score 0-100** basado en pesos configurables.
4. **Clasificar símbolos en estados** usando una máquina de estados simplificada (NORMAL/WATCH/PRE-PUMP/IGNITION).
5. **Enviar alertas a Telegram** cuando un símbolo cambia de estado, con datos claros.
6. **Persistir datos** en SQLite para análisis posterior y backtesting básico.

### Qué NO hace el MVP
- No analiza order book profundo.
- No procesa trades individuales ni CVD.
- No incluye datos sociales ni on-chain.
- No tiene dashboard web.
- No hace backtesting automatizado (solo guarda datos para hacerlo después).
- No soporta múltiples exchanges.

### Criterio de éxito del MVP
> Si en una semana de operación, el bot detecta al menos 1-2 candidatos reales en estado WATCH o PRE-PUMP que luego efectivamente hacen pump significativo, el MVP cumple su objetivo. Es aceptable tener falsos positivos (5-10 alertas WATCH por día), siempre que las señales PRE-PUMP/IGNITION sean más selectivas.

---

## 3. ALCANCE DEL MVP

### Incluido en MVP (Fase 1)

| Componente | Detalle |
|---|---|
| **Exchange** | Binance Futures USDT-M solamente |
| **Datos** | Klines (1m, 5m, 15m, 1h, 4h), OI cada 5min, funding cada 8h, ticker 24h |
| **Features** | RVOL, volume z-score, OI change %, OI z-score, funding rate, BB width (compresión), breakout de highs (1h/4h/24h), price extension vs MA20 |
| **Scoring** | Ponderado simple con pesos configurables |
| **Estados** | NORMAL, WATCH, PRE-PUMP, IGNITION (simplificados) |
| **Alertas** | Telegram con formato estructurado |
| **Storage** | SQLite con tablas para candles, OI, funding, features, estados, alertas |
| **Config** | Archivo JSON/YAML con todos los umbrales editables |
| **Filtro universo** | Solo pares con volumen 24h > umbral configurable (ej: > $1M) |

### Excluido del MVP (con justificación)

| Componente | Razón para postergar |
|---|---|
| **Order book profundo** | Requiere WebSocket dedicado por símbolo, alta complejidad de procesamiento. Fase 3-4. |
| **Trades/CVD/Taker ratio** | Requiere stream de aggTrades por símbolo, mucho volumen de datos. Fase 3. |
| **Liquidaciones** | API de Binance limitada; mejor vía CoinGlass. Fase 3. |
| **Social/Sentiment** | Requiere APIs adicionales (LunarCrush, Santiment), scraping. Fase 6+. |
| **On-chain** | Complejidad alta, relevancia secundaria para futures. Fase 7. |
| **Multi-exchange** | Agregar complejidad de normalización. Fase 5-6. |
| **ML/AI** | Prematuro sin datos etiquetados. Solo después de backtesting serio. |
| **Dashboard web** | Nice-to-have, no crítico. El canal de Telegram es suficiente al inicio. |
| **Ejecución automática** | Riesgo alto sin validación extensa del sistema de señales. |
| **CONFIRMED / LATE-DANGER** | Estados que requieren monitoreo intensivo (trades, order book). Se agregan en Fase 2-3. |

### Decisión crítica: REST polling vs WebSocket

**Para el MVP: REST polling.** Razones:
- Simplicidad de implementación y debugging.
- Binance permite ~1200 requests/minuto con API key. Con 200 símbolos y 4-5 endpoints, cabe bien.
- Los features del MVP (candles, OI, funding) se actualizan cada 1-5 minutos; no necesitan latencia de ms.
- WebSocket se introduce en Fase 3 cuando se necesiten trades y order book en tiempo real.

---

## 4. ARQUITECTURA GENERAL

### Diagrama de módulos

```
┌─────────────────────────────────────────────────────────┐
│                    PUMP-BOT SYSTEM                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Config   │  │  Logger  │  │  Utils   │  (transversal)│
│  └──────────┘  └──────────┘  └──────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │           DATA LAYER                          │        │
│  │  ┌────────────┐  ┌────────────┐              │        │
│  │  │ Exchange    │  │  Storage   │              │        │
│  │  │ Client     │  │  (SQLite)  │              │        │
│  │  └────────────┘  └────────────┘              │        │
│  └──────────────────────────────────────────────┘        │
│                       │                                   │
│                       ▼                                   │
│  ┌──────────────────────────────────────────────┐        │
│  │           PROCESSING LAYER                    │        │
│  │  ┌────────────┐  ┌────────────┐              │        │
│  │  │ Market     │  │  Feature   │              │        │
│  │  │ Scanner    │  │  Engine    │              │        │
│  │  └────────────┘  └────────────┘              │        │
│  └──────────────────────────────────────────────┘        │
│                       │                                   │
│                       ▼                                   │
│  ┌──────────────────────────────────────────────┐        │
│  │           DECISION LAYER                      │        │
│  │  ┌────────────┐  ┌────────────┐              │        │
│  │  │ Scoring    │  │  State     │              │        │
│  │  │ Engine     │  │  Machine   │              │        │
│  │  └────────────┘  └────────────┘              │        │
│  └──────────────────────────────────────────────┘        │
│                       │                                   │
│                       ▼                                   │
│  ┌──────────────────────────────────────────────┐        │
│  │           OUTPUT LAYER                        │        │
│  │  ┌────────────┐                              │        │
│  │  │ Alert      │                              │        │
│  │  │ Manager    │ → Telegram                   │        │
│  │  └────────────┘                              │        │
│  └──────────────────────────────────────────────┘        │
│                                                          │
│  ┌──────────────────────────────────────────────┐        │
│  │  Orchestrator (main loop)                     │        │
│  └──────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### Descripción de cada módulo

#### 4.1 Config Manager
- **Qué hace:** Carga y valida la configuración del sistema desde archivo JSON/YAML. Expone un objeto inmutable con todos los parámetros.
- **Recibe:** Archivo `config.json` del disco.
- **Devuelve:** Objeto de configuración tipado con valores por defecto para parámetros faltantes.
- **Responsabilidades:** Validar rangos de parámetros, proveer defaults sensatos, permitir override por variable de entorno para secrets (API keys, Telegram token).
- **NO debe:** Persistir cambios en runtime, ni recargar automáticamente (eso es futuro).

#### 4.2 Exchange Client (`exchanges/binance.js`)
- **Qué hace:** Abstrae toda la comunicación con Binance Futures API. Maneja autenticación, rate limits, retries y normalización de respuestas.
- **Recibe:** Parámetros de consulta (símbolo, intervalo, límite).
- **Devuelve:** Datos normalizados en formato interno (objetos JS con campos consistentes).
- **Responsabilidades:**
  - GET klines (velas OHLCV).
  - GET open interest (history y snapshot).
  - GET funding rate.
  - GET ticker 24h (para filtrar universo).
  - GET exchange info (para lista de símbolos activos).
  - Manejar rate limiting con queue + delay adaptativo.
  - Reintentar en errores 429/5xx con backoff exponencial.
- **NO debe:** Calcular features, decidir qué símbolos escanear, ni almacenar datos.

#### 4.3 Storage Layer (`storage/`)
- **Qué hace:** CRUD sobre SQLite. Abstrae queries SQL detrás de funciones semánticas.
- **Recibe:** Datos normalizados del Exchange Client o features calculados.
- **Devuelve:** Resultados de queries (arrays de objetos).
- **Responsabilidades:**
  - Inicializar esquema (crear tablas si no existen).
  - Insertar candles, OI, funding con UPSERT (evitar duplicados).
  - Consultar datos históricos para cálculo de features (ej: últimas 24 candles de 1h).
  - Guardar features calculados, estados, alertas.
  - Proveer datos para backtesting futuro.
  - Manejar WAL mode para rendimiento de escritura.
- **NO debe:** Contener lógica de negocio ni cálculos de features.

#### 4.4 Market Scanner (`scanner/`)
- **Qué hace:** Orquesta el ciclo de escaneo. Determina qué símbolos escanear, en qué orden, y coordina la recolección de datos.
- **Recibe:** Lista de símbolos del universo filtrado, configuración de frecuencias.
- **Devuelve:** Datos frescos almacenados en storage, listos para calcular features.
- **Responsabilidades:**
  - Filtrar universo: excluir stablecoins, pares con volumen < umbral, blacklist.
  - Ciclo de escaneo general (todos los símbolos, cada 60s).
  - Ciclo de monitoreo intensivo (símbolos en WATCH+, cada 15-30s) — Fase 2.
  - Distribuir requests para no saturar rate limits.
  - Reportar errores de recolección sin detener el ciclo.
- **NO debe:** Calcular features ni tomar decisiones sobre estados.

#### 4.5 Feature Engine (`features/`)
- **Qué hace:** Calcula todas las métricas derivadas a partir de datos crudos.
- **Recibe:** Datos históricos de candles, OI, funding desde storage.
- **Devuelve:** Objeto de features por símbolo con todas las métricas calculadas.
- **Responsabilidades:**
  - Calcular cada feature de forma independiente y testeable.
  - Manejar datos faltantes (ej: símbolo nuevo con pocas candles).
  - Normalizar features a rangos comparables cuando sea necesario.
  - Ser puramente funcional: misma entrada → misma salida.
- **NO debe:** Acceder directamente a APIs externas, ni decidir umbrales.

#### 4.6 Scoring Engine (`scoring/`)
- **Qué hace:** Combina features en un score 0-100 usando pesos configurables. Aplica penalizaciones.
- **Recibe:** Objeto de features calculados para un símbolo.
- **Devuelve:** Score total (0-100), desglose por categoría, lista de penalizaciones aplicadas.
- **Responsabilidades:**
  - Aplicar pesos por categoría.
  - Aplicar penalizaciones (funding eufórico, precio extendido, etc.).
  - Clampear resultado final a [0, 100].
  - Generar breakdown legible del score para incluir en alertas.
- **NO debe:** Decidir estados, enviar alertas, ni modificar pesos en runtime.

#### 4.7 State Machine (`state/`)
- **Qué hace:** Mantiene el estado actual de cada símbolo y gestiona transiciones basadas en el score y condiciones adicionales.
- **Recibe:** Score actual, features actuales, estado previo del símbolo.
- **Devuelve:** Nuevo estado, flag de si hubo transición, metadata de la transición.
- **Responsabilidades:**
  - Aplicar reglas de transición (condiciones de entrada/salida por estado).
  - Implementar histéresis: no oscilar entre estados por ruido (ej: requiere N ciclos consecutivos para subir de estado).
  - Implementar cooldown: si un símbolo baja a NORMAL después de IGNITION, no volver a WATCH por X minutos.
  - Persistir estado actual e historial de transiciones.
  - Implementar timeout: si un símbolo está en WATCH por >2h sin progresar, volver a NORMAL.
- **NO debe:** Calcular features ni enviar alertas directamente.

#### 4.8 Alert Manager (`alerts/`)
- **Qué hace:** Formatea y envía alertas a Telegram cuando hay transiciones de estado relevantes.
- **Recibe:** Transición de estado, score, features, símbolo.
- **Devuelve:** Confirmación de envío o error.
- **Responsabilidades:**
  - Formatear mensaje según el tipo de transición (formato diferente para WATCH vs IGNITION).
  - Rate limiting propio: no enviar más de N alertas por minuto.
  - Deduplicación: no enviar la misma alerta repetida.
  - Agrupar alertas WATCH de baja prioridad si hay muchas.
  - Manejar errores de Telegram API con retry.
- **NO debe:** Decidir cuándo alertar (eso lo decide la State Machine + Orchestrator).

#### 4.9 Orchestrator (`main.js`)
- **Qué hace:** Loop principal que coordina todo el flujo.
- **Responsabilidades:**
  - Inicializar todos los módulos.
  - Ejecutar ciclo: scan → features → scoring → state → alerts.
  - Manejar errores globales sin crashear.
  - Logging de cada ciclo (duración, símbolos procesados, transiciones).
  - Graceful shutdown en SIGINT/SIGTERM.

#### 4.10 Backtesting Module (Fase 5, diseño previo)
- **Qué hace:** Reproduce el pipeline de scoring/state sobre datos históricos.
- **NO se construye en MVP**, pero el storage y feature engine se diseñan para soportarlo.

---

## 5. FLUJO DE DATOS

### 5.1 Ciclo de escaneo general (cada 60 segundos)

```
1. Orchestrator dispara ciclo
2. Market Scanner obtiene lista de símbolos activos (cacheada, refresh cada 1h)
3. Market Scanner filtra universo (volumen > $1M, no stablecoins, no blacklist)
   → Resultado: ~150-200 símbolos

4. Para cada símbolo (en batches para respetar rate limits):
   a. Exchange Client → GET klines 1m (últimas 5) + 5m (últimas 3) + 1h (últimas 24)
   b. Exchange Client → GET OI snapshot
   c. Exchange Client → GET premium index (funding)
   d. Storage ← UPSERT datos crudos

5. Para cada símbolo:
   a. Feature Engine ← lee datos de Storage (candles + OI + funding históricos)
   b. Feature Engine → calcula features (RVOL, z-scores, compresión, breakout, etc.)
   c. Storage ← guarda features calculados

6. Para cada símbolo:
   a. Scoring Engine ← recibe features
   b. Scoring Engine → genera score 0-100 + breakdown

7. Para cada símbolo:
   a. State Machine ← recibe score + features + estado previo
   b. State Machine → determina nuevo estado
   c. Si hay transición → emite evento

8. Para cada transición:
   a. Alert Manager ← recibe evento de transición
   b. Alert Manager → formatea y envía a Telegram
   c. Storage ← guarda registro de alerta

9. Orchestrator logea resumen del ciclo:
   "Ciclo #1234 | 187 símbolos | 42s | 3 en WATCH | 1 en PRE-PUMP | 0 transiciones"
```

### 5.2 Optimización del ciclo con rate limits

Binance permite ~1200 req/min con API key. Con 200 símbolos:

| Endpoint | Requests/ciclo | Weight | Frecuencia |
|---|---|---|---|
| Klines 1m (últimas 5) | 200 | 1 c/u | Cada ciclo |
| Klines 1h (últimas 24) | 200 | 1 c/u | Cada 5 min |
| OI snapshot | 200 | 1 c/u | Cada ciclo |
| Funding | 200 | 1 c/u | Cada 8h (o menos) |
| Ticker 24h | 1 (todos) | 40 | Cada 5 min |
| **Total por ciclo completo** | **~400-600** | | |

Cabe cómodamente. Los klines de 1h y ticker se pueden hacer cada 5 ciclos.

### 5.3 Monitoreo intensivo (Fase 2)

Cuando un símbolo pasa a WATCH o superior:
- Se agrega a una lista de "hot symbols".
- Se escanea cada 15-30 segundos en lugar de cada 60.
- Se agregan klines de 5m y 15m.
- En Fase 3+: se abre WebSocket de aggTrades y depth para ese símbolo.

### 5.4 Flujo de almacenamiento para backtesting

Todo dato crudo y feature calculado se persiste con timestamp. El backtester podrá:
1. Leer candles históricas.
2. Reconstruir features tick-by-tick simulando el pipeline.
3. Aplicar scoring y comparar contra eventos de pump etiquetados.

Importante: **los features se recalculan en backtesting**, no se usan los guardados, para evitar que cambios en la fórmula de features requieran re-guardar todo.
