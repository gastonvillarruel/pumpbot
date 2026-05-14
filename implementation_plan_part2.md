# PUMP-BOT: Plan de Arquitectura — Parte 2/4

## 6. FUENTES DE DATOS

### Fase 1 — Binance Futures (MVP)

| Endpoint | Datos | Señal que alimenta | Frecuencia | Criticidad | Rate limit |
|---|---|---|---|---|---|
| `GET /fapi/v1/klines` | OHLCV por timeframe | RVOL, z-score vol, compresión, breakout, price extension | 1m: cada ciclo, 5m/15m/1h/4h: cada 5min | **Crítica** | Weight 1-5 según limit |
| `GET /fapi/v1/openInterest` | OI snapshot actual | OI change, OI z-score | Cada ciclo (60s) | **Crítica** | Weight 1 |
| `GET /futures/data/openInterestHist` | OI histórico 5m/15m/1h | OI change multi-TF, OI z-score | Cada 5min | **Crítica** | Weight 1 |
| `GET /fapi/v1/premiumIndex` | Funding rate actual | Funding regime, penalización | Cada 5min | **Alta** | Weight 1 |
| `GET /fapi/v1/fundingRate` | Funding histórico | Funding trend | Cada 1h | Media | Weight 1 |
| `GET /fapi/v1/ticker/24hr` | Vol 24h, price change | Filtro universo, contexto | Cada 5min | **Alta** | Weight 40 (todos) |
| `GET /fapi/v1/exchangeInfo` | Símbolos activos, filtros | Lista de universo | Cada 1h | Baja | Weight 1 |

**Problemas potenciales Fase 1:**
- OI histórico (`openInterestHist`) tiene rate limit más estricto y solo retorna datos en intervalos de 5m mínimo.
- Klines de 1m con limit alto consumen más weight. Solución: pedir solo las últimas 5-10 candles.
- Funding rate solo se actualiza cada 8h; entre actualizaciones, usar `premiumIndex` que da el funding rate estimado actual.

### Fase 2 — Datos enriquecidos Binance

| Endpoint | Datos | Señal | Frecuencia |
|---|---|---|---|
| `GET /futures/data/topLongShortPositionRatio` | Long/Short ratio | Sesgo de mercado | Cada 5min |
| `GET /futures/data/takerlongshortRatio` | Taker buy/sell ratio | Presión compradora | Cada 5min |
| WebSocket `aggTrade` (por símbolo hot) | Trades individuales | CVD, taker buy ratio real, sweeps | Streaming |
| WebSocket `depth@100ms` (por símbolo hot) | Order book L2 | Bid/ask imbalance, ask thinning | Streaming |

### Fase 3 — CoinGlass / APIs externas

| Fuente | Datos | Señal | Criticidad |
|---|---|---|---|
| CoinGlass API | Liquidaciones aggregadas, OI multi-exchange, funding multi-exchange | Liquidaciones short, OI real total | Alta |
| CoinGlass | Long/Short ratio global, basis perp/spot | Sesgo real, estructura de precios | Media |

**Problema:** CoinGlass API tiene planes pagos. Plan gratuito limitado a ~10 req/min. Evaluar costo/beneficio.

### Fase 4 — Social / Sentiment

| Fuente | Datos | Señal |
|---|---|---|
| LunarCrush | Social volume, social dominance, engagement | Social z-score |
| Santiment | Dev activity, social volume, whale txs | Smart money, hype |

### Fase 5 — On-chain

| Fuente | Datos | Señal |
|---|---|---|
| Nansen / Arkham | Labeled wallet flows | Smart money tracking |
| DexScreener | DEX volume, new pools | Early activity pre-CEX |
| Dune | Custom queries on-chain | Exchange netflows, holder growth |

---

## 7. FEATURES A CALCULAR

### A. Price / Volume

#### A1. Relative Volume (RVOL)
- **Definición:** Ratio entre volumen actual y volumen promedio del mismo período.
- **Fórmula:** `RVOL = volume_current / SMA(volume, N)` donde N = 20 períodos del mismo timeframe.
- **Timeframes:** 1m (rolling 20 candles), 5m (rolling 20), 1h (rolling 24).
- **Uso:** RVOL > 3x en 1m o > 2x en 1h = señal de actividad anormal.
- **Umbral inicial:** RVOL_1m > 3.0, RVOL_5m > 2.5, RVOL_1h > 2.0.
- **Nota:** Usar SMA del mismo horario/día de la semana es ideal pero innecesario para MVP. SMA simple de últimos N períodos es suficiente.

#### A2. Volume Z-Score
- **Definición:** Cuántas desviaciones estándar el volumen actual está respecto a la media.
- **Fórmula:** `z = (volume_current - mean(volume, N)) / std(volume, N)` con N = 50-100 períodos.
- **Timeframes:** 5m (N=100), 1h (N=48).
- **Uso:** z > 2.5 = anormal, z > 4 = muy anormal. Complementa RVOL con contexto de dispersión.
- **Umbral inicial:** z > 2.5 para señal, z > 4.0 para señal fuerte.

#### A3. Price Return
- **Definición:** Cambio porcentual del precio en ventana determinada.
- **Fórmula:** `return = (close_now - close_N_ago) / close_N_ago * 100`
- **Timeframes:** 5m, 15m, 1h, 4h, 24h.
- **Uso dual:**
  - Return positivo moderado (1-5% en 1h) + señales de acumulación = bullish.
  - Return > 15-20% en 1h = precio ya extendido → penalización.
- **Umbral de extensión:** > 10% en 1h o > 20% en 4h → penalizar score.

#### A4. ATR% (Average True Range relativo)
- **Definición:** Volatilidad normalizada por precio.
- **Fórmula:** `ATR% = ATR(14) / close * 100`
- **Timeframe:** 1h.
- **Uso:** ATR% bajo indica compresión. ATR% cayendo → precio se está comprimiendo.
- **Umbral:** ATR% actual < 50% del ATR% promedio de 7 días → compresión detectada.

#### A5. Bollinger Band Width (compresión)
- **Definición:** Ancho de las bandas de Bollinger como proxy de volatilidad.
- **Fórmula:** `BBW = (upper_band - lower_band) / middle_band * 100` con período 20, desviación 2.
- **Timeframe:** 1h, 4h.
- **Uso:** BBW en mínimos de N períodos indica compresión extrema → potencial explosión.
- **Umbral:** BBW actual < percentil 10 de últimas 168 horas (7 días) → compresión.

#### A6. Breakout de Highs
- **Definición:** ¿El precio actual está rompiendo máximos de ventanas temporales clave?
- **Fórmula:** `breakout_Xh = close > max(high, últimas X horas)`
- **Ventanas:** 1h, 4h, 12h, 24h, 72h.
- **Uso:** Breakout de high de 24h+ con volumen = señal de ignición. Breakout de 72h+ = muy significativo.
- **Scoring:** Breakout de 1h = +2pts, 4h = +4pts, 12h = +6pts, 24h = +8pts, 72h = +10pts.
- **Importante:** Verificar que el breakout sea con cierre, no solo mecha. `close > prev_high`, no `high > prev_high`.

#### A7. Price Extension (distancia a MA)
- **Definición:** Qué tan lejos está el precio de su media móvil.
- **Fórmula:** `extension = (close - SMA(close, 20)) / SMA(close, 20) * 100`
- **Timeframe:** 1h.
- **Uso:** Si el precio ya está >15% sobre su MA20 1h, es probable que el pump ya arrancó → penalización.
- **Umbral penalización:** extension > 10% → penalización leve, > 20% → penalización fuerte.

#### A8. Rango lateral prolongado
- **Definición:** Cuánto tiempo lleva el precio dentro de un rango estrecho.
- **Fórmula:** `range_pct = (max(high, N) - min(low, N)) / min(low, N) * 100` para ventanas crecientes.
- **Uso:** Si range_pct < 5% durante 24h+, el activo está en compresión lateral → setup ideal para breakout.
- **Umbral:** range < 5% en 24h Y range < 8% en 72h → compresión confirmada.

### B. Derivatives

#### B1. OI Change %
- **Definición:** Cambio porcentual del Open Interest en ventana temporal.
- **Fórmula:** `oi_change = (OI_now - OI_N_ago) / OI_N_ago * 100`
- **Timeframes:** 5min, 15min, 1h, 4h.
- **Uso:** OI subiendo >10% en 1h mientras precio lateral = acumulación fuerte.
- **Umbral:** oi_change_1h > 5% = notable, > 10% = anormal, > 20% = extremo.

#### B2. OI Z-Score
- **Definición:** Z-score del OI actual vs histórico.
- **Fórmula:** `z_oi = (OI_now - mean(OI, 48h)) / std(OI, 48h)`
- **Timeframe:** Calculado sobre snapshots de 1h de últimas 48h.
- **Uso:** z_oi > 2.0 con precio lateral = acumulación silenciosa. Señal de alta calidad.
- **Umbral:** z_oi > 1.5 = señal, > 2.5 = señal fuerte.

#### B3. OI-Price Divergence
- **Definición:** OI sube pero precio no sube (o sube poco). Señal de posicionamiento previo.
- **Fórmula:** `divergence = oi_change_1h - abs(price_return_1h)`. Si divergence > 0 y price_return cercano a 0, hay divergencia.
- **Uso:** La señal más valiosa del MVP. OI subiendo 15% con precio plano = alguien se está posicionando.
- **Umbral:** oi_change_1h > 8% AND abs(price_return_1h) < 2% → divergencia fuerte.

#### B4. Funding Rate
- **Definición:** Tasa de funding actual del perpetuo.
- **Fórmula:** Dato directo de API.
- **Uso dual:**
  - Funding neutro (-0.005% a 0.01%) o levemente negativo = sano, no hay euforia → positivo para pump.
  - Funding > 0.05% = mercado eufórico → penalización (riesgo de reversión).
  - Funding muy negativo (< -0.02%) = shorts pagando premium → posible short squeeze → señal.
- **Umbrales:** funding ∈ [-0.01%, 0.01%] = neutro (bueno). funding > 0.03% = caliente. funding > 0.05% = peligro.

#### B5. Funding Regime
- **Definición:** Tendencia del funding en últimas 3-5 actualizaciones (24-40h).
- **Fórmula:** `regime = trend(funding_rates, last_5)`. Clasificar como: NEGATIVE, NEUTRAL, WARMING, HOT.
- **Uso:** Régimen NEUTRAL o NEGATIVE con OI subiendo = la mejor combinación.

### C. Microestructura (Fase 2-4, diseño previo)

#### C1. Taker Buy/Sell Ratio
- **Fuente MVP:** `GET /futures/data/takerlongshortRatio` (agregado cada 5min).
- **Fórmula:** Dato directo. Ratio > 1 = más compras agresivas.
- **Uso:** Ratio > 1.2 sostenido = presión compradora real.

#### C2. CVD (Cumulative Volume Delta)
- **Fuente:** aggTrades WebSocket (Fase 3).
- **Fórmula:** `CVD = Σ(volume_buy) - Σ(volume_sell)` acumulado en ventana.
- **Uso:** CVD positivo y creciente durante breakout = compras reales, no manipulación.

#### C3. Bid/Ask Imbalance
- **Fuente:** Order book depth WebSocket (Fase 4).
- **Fórmula:** `imbalance = (bid_depth_5levels - ask_depth_5levels) / (bid_depth_5levels + ask_depth_5levels)`
- **Uso:** Imbalance positivo + ask depth thin = path of least resistance hacia arriba.

#### C4. Ask Depth Thinning
- **Fuente:** Order book (Fase 4).
- **Fórmula:** `ask_thin = ask_depth_current / mean(ask_depth, 1h)`. Si < 0.5, el order book se vació arriba.
- **Uso:** Order book fino hacia arriba = el precio puede subir rápido con poco volumen.

#### C5. Spoofing Score (penalización)
- **Fuente:** Order book snapshots consecutivos (Fase 4).
- **Fórmula:** Detectar órdenes grandes que aparecen y desaparecen en <5 snapshots.
- **Uso:** Penalizar score si se detecta spoofing. Indica manipulación, no demanda real.

### D. Social / On-chain (Fase 6-7, diseño previo)

| Feature | Fórmula conceptual | Uso |
|---|---|---|
| Social volume z-score | z-score de menciones vs media 7d | Hype temprano |
| Social dominance | % de menciones vs total crypto | Token ganando atención |
| Smart money inflow | Net flow de wallets etiquetadas | Acumulación institucional |
| Exchange netflow | Depósitos - retiros en exchanges | Netflow negativo = acumulación |
| Fresh wallets | Wallets nuevas comprando | Distribución/adopción temprana |
| Holder growth rate | Cambio % de holders únicos | Adopción orgánica |

---

## 8. SCORING SYSTEM 0-100

### Distribución de pesos (MVP)

| Categoría | Peso | Justificación |
|---|---|---|
| **Acumulación / Divergencia OI-Precio** | 30 pts | La señal más predictiva de pumps extremos: posicionamiento silencioso |
| **Volumen / Anomalía** | 25 pts | Volumen creciendo desde niveles bajos es precursor directo |
| **Price Action / Compresión / Breakout** | 25 pts | Compresión + breakout es el trigger mecánico del pump |
| **Derivados (Funding + contexto)** | 15 pts | Funding sano confirma que el pump no está agotado |
| **Microestructura** (Fase 2+) | 5 pts | Inicialmente bajo, crece a 15 cuando se implementa |

### Desglose detallado

#### Acumulación / Divergencia (30 pts)

| Sub-feature | Max pts | Condición para max |
|---|---|---|
| OI change 1h | 10 | oi_change_1h > 15% |
| OI z-score | 8 | z_oi > 3.0 |
| OI-Price divergence | 12 | oi_change > 10% AND price_change < 2% |

Escalado lineal: por ejemplo, OI change de 5% = 3pts, 10% = 7pts, 15% = 10pts.

#### Volumen / Anomalía (25 pts)

| Sub-feature | Max pts | Condición para max |
|---|---|---|
| RVOL 5m | 8 | RVOL > 5x |
| Volume z-score 1h | 8 | z > 4.0 |
| Volumen creciendo (tendencia) | 5 | Vol de última 1h > Vol de hora previa, 3 horas consecutivas |
| Volumen desde nivel bajo | 4 | Vol 24h previo en percentil < 30 de últimos 7d, ahora subiendo |

#### Price Action (25 pts)

| Sub-feature | Max pts | Condición para max |
|---|---|---|
| Compresión (BBW) | 8 | BBW en percentil < 10 de 7 días |
| Rango lateral prolongado | 5 | Range < 5% en últimas 24h |
| Breakout de high | 8 | Breakout de high de 24h+ con cierre |
| Return moderado (no extendido) | 4 | Return 1h entre 2-8% (ni flat ni sobreextendido) |

#### Derivados (15 pts)

| Sub-feature | Max pts | Condición para max |
|---|---|---|
| Funding neutro/negativo | 6 | funding ∈ [-0.02%, 0.005%] |
| Funding regime sano | 4 | Últimas 3-5 lecturas neutras o negativas |
| Taker buy ratio > 1 | 5 | ratio > 1.3 (disponible Fase 2) |

#### Microestructura (5 pts MVP → 15 pts Fase 4)

| Sub-feature | Max pts | Condición para max |
|---|---|---|
| Bid/Ask imbalance | 2 | imbalance > 0.3 |
| Ask thinning | 3 | ask_depth < 50% del promedio |

### Sistema de penalizaciones

Las penalizaciones se **restan** del score total después de sumarlo.

| Penalización | Resta | Condición |
|---|---|---|
| **Precio ya extendido** | -10 a -25 | extension > 10%: -10, > 20%: -20, > 30%: -25 |
| **Funding eufórico** | -10 a -20 | funding > 0.03%: -10, > 0.05%: -15, > 0.1%: -20 |
| **Volumen 24h muy bajo** | -5 a -10 | vol_24h < $500K: -10, < $1M: -5 |
| **Spread alto** | -5 | spread > 0.1% |
| **Spoofing detectado** | -10 | spoofing_score > umbral (Fase 4) |
| **BTC en contra** | -5 a -10 | BTC return_1h < -2%: -5, < -5%: -10 |
| **Volumen sospechoso** | -10 | RVOL extremo (>20x) sin movimiento de precio = posible wash trading |
| **Mecha superior fuerte** | -5 | (high - close) / (high - low) > 0.6 en última candle |

### Clasificación por score

| Rango | Estado | Acción |
|---|---|---|
| 0-39 | Sin interés | NORMAL, no monitorear especialmente |
| 40-54 | Watch débil | WATCH, monitoreo standard, alerta informativa |
| 55-69 | Watch fuerte | WATCH alto, aumentar frecuencia de escaneo |
| 70-79 | Pre-pump | PRE-PUMP, monitoreo intensivo, alerta prioritaria |
| 80-89 | Ignition probable | IGNITION, alerta urgente |
| 90-100 | Señal extrema | IGNITION/CONFIRMED, alerta máxima |

### Pseudocódigo del scoring

```
function calculateScore(features, config):
  score = 0
  breakdown = {}

  // Acumulación (30 pts)
  score += lerp(features.oi_change_1h, 0, 15, 0, 10)  // 0-10 pts
  score += lerp(features.oi_zscore, 0, 3, 0, 8)        // 0-8 pts
  if features.oi_change_1h > 8 AND abs(features.price_return_1h) < 2:
    score += lerp(features.oi_change_1h, 8, 20, 4, 12) // divergence bonus

  // Volumen (25 pts)
  score += lerp(features.rvol_5m, 1, 5, 0, 8)
  score += lerp(features.vol_zscore_1h, 0, 4, 0, 8)
  score += features.vol_trend_score  // 0-5
  score += features.vol_from_low_score // 0-4

  // Price Action (25 pts)
  score += lerp(1 - features.bbw_percentile, 0, 1, 0, 8)
  score += features.range_compression_score // 0-5
  score += features.breakout_score // 0-8
  score += features.return_moderate_score // 0-4

  // Derivados (15 pts)
  score += fundingScore(features.funding_rate) // 0-6
  score += fundingRegimeScore(features.funding_regime) // 0-4
  score += lerp(features.taker_buy_ratio, 1, 1.3, 0, 5) // 0-5

  // Penalizaciones
  penalties = calculatePenalties(features, config)
  score -= penalties.total

  return clamp(score, 0, 100)
```
