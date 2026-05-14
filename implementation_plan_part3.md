# PUMP-BOT: Plan de Arquitectura — Parte 3/4

## 9. STATE MACHINE

### Diagrama de estados

```
                    score >= 40
        ┌──────────── & condiciones ────────────┐
        │                                        ▼
   ┌─────────┐    score >= 70       ┌───────────────┐
   │ NORMAL  │◄──── timeout ───────│    WATCH      │
   └─────────┘    score < 35       └───────────────┘
        ▲          (2h sin progreso)       │
        │                                   │ score >= 70
        │ cooldown                          │ & compresión
        │ reset                             │ & OI diverge
        │                                   ▼
        │                          ┌───────────────┐
        │◄──── score < 50 ────────│  PRE-PUMP     │
        │      o timeout 1h       └───────────────┘
        │                                   │
        │                                   │ breakout + vol
        │                                   │ & score >= 80
        │                                   ▼
        │                          ┌───────────────┐
        │◄──── pierde VWAP ───────│  IGNITION     │
        │      o score < 60       └───────────────┘
        │                                   │
        │                                   │ mantiene nivel
        │                                   │ & score >= 85
        │                                   ▼
        │                          ┌───────────────┐
        │◄──── score < 70 ────────│  CONFIRMED    │
        │                         └───────────────┘
        │
        │         Desde cualquier estado:
        │         funding > 0.05% │ extension > 25%
        │         │ mecha > 60% │ vol desaparece
        │                    ▼
        │            ┌───────────────┐
        └────────────│ LATE/DANGER   │
                     └───────────────┘
```

### Detalle por estado

#### NORMAL
- **Condiciones de entrada:** Estado por defecto. Se vuelve a NORMAL si el score cae por debajo del umbral o por timeout.
- **Score:** 0-39.
- **Módulos activos:** Escaneo general cada 60s.
- **Alerta:** Ninguna.
- **Salida hacia WATCH:** Score >= 40 durante al menos 2 ciclos consecutivos (histéresis anti-ruido).

#### WATCH
- **Condiciones de entrada:**
  - Score >= 40 durante 2+ ciclos consecutivos.
  - Al menos una señal significativa activa: RVOL > 2x O oi_change_1h > 5% O vol_zscore > 2.0.
- **Score:** 40-69.
- **Módulos activos:** Escaneo cada 60s (igual, pero se registra como hot symbol para futuro monitoreo intensivo).
- **Alerta:** Informativa. Se envía al entrar a WATCH. No se repite salvo que el score suba significativamente (>10 pts).
- **Salida hacia PRE-PUMP:** Score >= 70 Y al menos 2 de:
  - Compresión detectada (BBW percentil < 20).
  - OI-Price divergence activa.
  - Funding neutro o negativo.
  - RVOL > 3x sostenido.
- **Salida hacia NORMAL:** Score < 35 durante 3+ ciclos O timeout de 2 horas sin progresar (score no sube).
- **Cooldown al volver a NORMAL:** 30 minutos antes de poder volver a WATCH.

#### PRE-PUMP
- **Condiciones de entrada:** Desde WATCH con score >= 70 y condiciones multi-señal.
- **Score:** 70-79.
- **Módulos activos:**
  - Escaneo cada 30s (monitoreo intensivo).
  - En Fase 3+: se abre WebSocket de trades para CVD.
- **Alerta:** Prioritaria. Se envía inmediatamente al entrar. Update cada 5min si el score cambia >5 pts.
- **Salida hacia IGNITION:** Score >= 80 Y breakout confirmado (close > high de 4h+) Y RVOL > 4x en última candle Y OI sigue subiendo.
- **Salida hacia NORMAL:** Score < 50 durante 3+ ciclos O timeout de 1 hora sin ruptura.
- **Salida hacia LATE/DANGER:** Precio se extiende >20% sin haber pasado por IGNITION detectada (pump se escapó).

#### IGNITION
- **Condiciones de entrada:** Desde PRE-PUMP con breakout + volumen + confirmación.
- **Score:** 80-89.
- **Módulos activos:**
  - Escaneo cada 15s.
  - Monitoreo de extensión de precio.
  - Monitoreo de funding (puede escalar rápido).
- **Alerta:** Urgente. Se envía inmediatamente. Update cada 2-3 min.
- **Salida hacia CONFIRMED:** Score >= 85 Y precio mantiene nivel post-breakout (no pierde 50% del move) Y volumen se mantiene elevado Y OI no colapsa.
- **Salida hacia LATE/DANGER:** Funding > 0.05% O extensión > 25% O mecha superior > 60% de la candle.
- **Salida hacia NORMAL:** Score < 60 (colapso de señales, breakout fallido).

#### CONFIRMED
- **Condiciones de entrada:** Desde IGNITION con confirmación de continuidad.
- **Score:** 85+.
- **Módulos activos:** Monitoreo continuo con foco en señales de agotamiento.
- **Alerta:** Confirmación. Se envía una vez. Updates solo si hay cambio a LATE/DANGER.
- **Salida hacia LATE/DANGER:** Cualquier señal de agotamiento (funding extremo, extensión extrema, volumen cayendo).
- **Salida hacia NORMAL:** Score < 70 (momentum perdido).

#### LATE / DANGER
- **Condiciones de entrada desde cualquier estado:**
  - Funding > 0.05%.
  - Precio extendido > 25% sobre MA20 1h.
  - Mecha superior > 60% en candle reciente.
  - Volumen colapsa (RVOL cae de >4x a <1x).
  - OI colapsa abruptamente (posibles liquidaciones en masa).
  - Spread se amplía significativamente.
- **Score:** Cualquiera (este estado se activa por condiciones, no solo por score).
- **Alerta:** Advertencia. Se envía inmediatamente.
- **Salida hacia NORMAL:** Automática después de 30 minutos. Cooldown de 2 horas antes de poder entrar a WATCH de nuevo.

### Reglas transversales

1. **Histéresis:** Para subir de estado, mantener condiciones durante N ciclos (2-3). Para bajar, solo 3 ciclos. Esto evita oscilaciones.
2. **Cooldown:** Después de caer de IGNITION/CONFIRMED/LATE a NORMAL, cooldown de 1-2h.
3. **Max simultáneos:** Alertar como máximo 5 símbolos en PRE-PUMP+ simultáneamente (si hay más, priorizar por score).
4. **BTC override:** Si BTC cae >3% en 1h, suspender nuevas transiciones a IGNITION (los pumps de alts en crash de BTC son poco confiables).

---

## 10. ALERTAS A TELEGRAM

### Principios de diseño
- Cada alerta debe ser **autocontenida**: leer la alerta debe dar toda la información necesaria.
- Usar **emojis** como marcadores visuales rápidos.
- Incluir siempre el **score**, las **señales activas**, y una **lectura** interpretativa.
- Links directos a TradingView y Binance.

### Formato WATCH

```
🔍 WATCH — XYZUSDT

Score: 47/100  ██████░░░░
Precio: $0.4523 (+1.2% 1h)

📊 Señales activas:
• Volumen: RVOL 3.2x (5m) | z-score 2.8
• OI: +7.4% en 1h (z: 1.8)
• Funding: 0.003% (neutral) ✅
• Compresión: BBW percentil 15

⚠️ Penalizaciones: ninguna

📖 Lectura: Volumen despertando con OI creciente.
Funding sano. Sin breakout todavía. Monitorear.

🔗 TV: https://tradingview.com/chart/?symbol=BINANCE:XYZUSDT.P
⏰ 2024-01-15 14:32 UTC
```

### Formato PRE-PUMP

```
🟡 PRE-PUMP — XYZUSDT

Score: 76/100  █████████░
Precio: $0.4580 (+2.5% 1h)

📊 Señales activas:
• Volumen: RVOL 4.8x (5m) | z-score 3.5 🔥
• OI: +14.2% en 1h (z: 2.6) 🔥
• Divergencia OI-Precio: OI +14%, precio +2.5%
• Funding: -0.002% (negativo) ✅✅
• Compresión: 8h lateral, BBW pctl 8 🔥
• Breakout: Cerca de high 24h ($0.4610)

⚠️ Penalizaciones: ninguna
📈 Precio NO extendido: +3.2% vs MA20

📖 Lectura: Acumulación fuerte con OI divergente.
8h de compresión lateral. Funding negativo ideal.
Breakout de 24h inminente. Setup de alta calidad.

🔗 TV: https://tradingview.com/chart/?symbol=BINANCE:XYZUSDT.P
⏰ 2024-01-15 14:47 UTC
```

### Formato IGNITION

```
🟠 IGNITION — XYZUSDT

Score: 84/100  ████████████░
Precio: $0.4820 (+7.8% 1h) 🚀

📊 Señales activas:
• Volumen: RVOL 8.3x (1m) | z-score 5.1 🔥🔥
• OI: +22% en 1h (z: 3.4) 🔥🔥
• Funding: 0.008% (neutral) ✅
• Breakout: HIGH 24h ROTO ✅ | HIGH 72h ROTO ✅
• Cierre sobre nivel: SÍ (no solo mecha)
• Taker buy ratio: 1.35 🔥

⚠️ Penalizaciones:
• Extensión leve: -3 pts (precio +7.8% vs MA20)

📖 Lectura: BREAKOUT CONFIRMADO con volumen masivo.
OI explotó. Funding todavía sano.
Rompió high de 72h con cierre. Momentum real.

🔗 TV: https://tradingview.com/chart/?symbol=BINANCE:XYZUSDT.P
⏰ 2024-01-15 15:03 UTC
```

### Formato CONFIRMED

```
🟢 CONFIRMED — XYZUSDT

Score: 88/100  █████████████░
Precio: $0.5240 (+16.8% desde WATCH)

📊 Status:
• Mantiene nivel post-breakout ✅
• Volumen sostenido (RVOL 5.2x) ✅
• OI estable/creciendo ✅
• Funding: 0.015% (warming, monitorear) ⚡
• No pierde VWAP ✅

⏱️ Timeline:
• WATCH: 14:32 ($0.4523)
• PRE-PUMP: 14:47 ($0.4580)
• IGNITION: 15:03 ($0.4820)
• CONFIRMED: 15:18 ($0.5240)
• Move acumulado: +15.8%

📖 Lectura: Pump en progreso con estructura sana.
Funding aún controlado. Monitorear extensión.

🔗 TV: https://tradingview.com/chart/?symbol=BINANCE:XYZUSDT.P
⏰ 2024-01-15 15:18 UTC
```

### Formato LATE / DANGER

```
🔴 LATE/DANGER — XYZUSDT

Score: 72/100  ██████████░░
Precio: $0.7830 (+73% desde WATCH)

⚠️ SEÑALES DE PELIGRO:
• Funding: 0.085% 🔴 EUFÓRICO
• Extensión: +38% vs MA20 🔴
• Última candle: mecha superior 65% 🔴
• Volumen: cayendo (RVOL 1.8x vs 8x previo) ⚠️

📖 Lectura: PROBABLE ZONA DE TECHO.
Funding extremo, precio sobreextendido, mecha de rechazo.
ALTO RIESGO de reversión violenta. No entrar.

🔗 TV: https://tradingview.com/chart/?symbol=BINANCE:XYZUSDT.P
⏰ 2024-01-15 16:45 UTC
```

### Control de spam

| Regla | Detalle |
|---|---|
| Max alertas/hora | 15 (configurable) |
| Deduplicación | No repetir misma alerta para mismo símbolo en mismo estado durante 10 min |
| Agrupamiento | Si hay >5 WATCH nuevos en un ciclo, agrupar en un solo mensaje resumen |
| Quiet hours | Configurable (ej: no alertar WATCH entre 02:00-06:00 UTC, sí PRE-PUMP+) |
| Prioridad | IGNITION/CONFIRMED siempre se envían. WATCH puede suprimirse si hay mucho ruido |

---

## 11. BACKTESTING

### Definición de evento pump

| Tipo | Definición | Uso |
|---|---|---|
| **Pump extremo** | Price return >= +100% en ventana de 24h desde un mínimo local | Objetivo principal |
| **Pump fuerte** | Price return >= +50% en 12h | Objetivo secundario |
| **Pump rápido** | Price return >= +30% en 1h | Señal de ignición |
| **Mínimo local** | Low de las últimas 24h antes del movimiento, con drawdown < 5% previo | Punto de referencia |

### Cómo etiquetar eventos

1. Tomar datos históricos de candles 1m para todos los pares de Binance Futures.
2. Para cada par, para cada ventana deslizante de 24h:
   - Calcular `max_return = (max_price_in_window - open_price_of_window) / open_price_of_window`.
   - Si `max_return >= 100%`, marcar como evento pump extremo.
   - Registrar: símbolo, timestamp de inicio de la ventana, timestamp del máximo, return máximo, drawdown máximo previo.
3. Filtrar: solo conservar eventos donde el drawdown previo (caída desde el inicio de la ventana hasta el mínimo antes del pump) sea < 10%. Esto evita confundir recuperaciones de crash con pumps reales.

### Qué ventanas analizar (pre-pump)

Para cada evento etiquetado, mirar hacia atrás:
- **-1h a 0:** ¿Hubo breakout? ¿Volumen explotó?
- **-4h a -1h:** ¿Hubo compresión? ¿OI subiendo?
- **-12h a -4h:** ¿Hubo acumulación silenciosa? ¿Rango lateral?
- **-24h a -12h:** ¿Volumen era bajo? ¿Funding era neutro?

### Datos históricos necesarios

| Dato | Fuente | Disponibilidad |
|---|---|---|
| Candles 1m | Binance API (max 1500 por request) | Sí, gratis, hasta ~30 días. Para más, Binance Data. |
| Candles 1h/4h | Binance API | Sí, historico extenso |
| OI histórico | Binance `openInterestHist` (5m/15m/1h) | Solo últimos 30 días aprox |
| Funding histórico | Binance `fundingRate` | Sí, extenso |
| Trades | Binance aggTrades dump | Muy pesado, postergar |

**Problema:** OI histórico limitado a 30 días en Binance. Soluciones:
- Empezar a guardar OI desde el día 1 del bot.
- Usar CoinGlass para OI histórico más extenso (plan pago).
- Para backtesting inicial, usar solo los últimos 30 días + datos que el bot vaya acumulando.

### Cómo evitar lookahead bias

1. **Recalcular features en orden cronológico.** El backtester debe simular el pipeline exacto que correría en vivo.
2. **No usar datos futuros para calcular z-scores.** La media y desviación estándar deben calcularse solo con datos previos al punto de evaluación.
3. **Ventanas de entrenamiento/validación separadas.** Si se optimizan umbrales en el período A, validar en período B no visto.
4. **No ajustar pesos mirando el resultado.** Definir pesos teóricos primero, luego validar. Solo ajustar si hay evidencia estadística clara.

### Métricas a evaluar

| Métrica | Definición |
|---|---|
| **True Positives** | Alertas WATCH/PRE-PUMP seguidas de pump >= +50% en 24h |
| **False Positives** | Alertas WATCH/PRE-PUMP donde el pump fue < +10% o negativo |
| **Precision** | TP / (TP + FP). ¿Qué % de alertas fueron útiles? |
| **Recall** | TP / (TP + FN). ¿Qué % de pumps reales detectamos? |
| **Early detection** | Promedio de tiempo entre alerta WATCH y peak del pump |
| **Entry quality** | Return promedio si se entrara en PRE-PUMP vs en IGNITION |
| **Max drawdown post-alert** | Máxima caída entre alerta y peak (riesgo de la entrada) |
| **Alert frequency** | Alertas por día (si > 20, hay mucho ruido) |

### Cómo comparar variantes de scoring

1. Definir 3-5 configuraciones de pesos alternativas.
2. Correr el backtester con cada configuración sobre los mismos datos.
3. Comparar precision, recall, early detection y max drawdown.
4. Elegir la configuración con mejor **precision@recall>=30%** (prefiero no perder demasiados pumps reales, pero cada alerta debe ser útil).

### Implementación progresiva

- **Fase MVP:** No hay backtester automatizado. Solo se guardan datos. Análisis manual en scripts ad-hoc.
- **Fase 5:** Backtester que reproduce el pipeline sobre datos guardados. Genera reporte con métricas.
- **Fase 6+:** Framework de backtesting con grid search de parámetros y validación walk-forward.
