# PUMP-BOT: Plan de Arquitectura — Parte 5/5

## 16. RIESGOS Y LIMITACIONES

### Señales que pueden llegar tarde
- **OI histórico:** Solo disponible en intervalos de 5m mínimo. Si el OI sube y baja en 2 minutos, no lo vemos.
- **Funding:** Se actualiza cada 8h. El funding estimado (premiumIndex) ayuda, pero tiene lag.
- **Volume z-score:** Necesita ventana de historia. Un símbolo nuevo no tendrá z-score confiable por días.
- **Breakout:** Se detecta después de que la candle cierra. En timeframe 1h, puede ser hasta 59 minutos tarde. Mitigar con 1m/5m.

### Falsos positivos esperados
- **Volumen anormal sin pump:** Liquidaciones, noticias negativas, manipulación de mercado generan volumen sin pump. ~60-70% de alertas WATCH serán FP.
- **OI subiendo sin pump:** Hedging, arbitraje, market makers rebalanceando. No todo OI creciente es posicionamiento direccional.
- **Compresión sin breakout:** Muchas compresiones se resuelven hacia abajo o lateralmente.
- **Objetivo realista de precisión:** 15-25% en WATCH, 30-50% en PRE-PUMP, 50-70% en IGNITION.

### Datos ruidosos
- **OI en monedas ilíquidas:** Puede tener spikes por una sola orden grande. Ruido alto.
- **Volume en horarios muertos:** Vol bajo en Asia genera RVOL altos falsos cuando entra Europa.
- **Funding rate en monedas pequeñas:** Puede ser volátil sin significar nada real.

### Cuándo el bot puede fallar
- **Pump por noticia repentina:** Listing en Coinbase, tweet de influencer, hack → no hay señales previas de acumulación. El bot las detectará tarde (IGNITION, no PRE-PUMP).
- **Pump coordinado (pump & dump groups):** Pueden no tener acumulación previa detectable. El pump empieza y termina en minutos.
- **Flash crash de BTC que arrastra todo:** El bot puede estar en PRE-PUMP de un altcoin que luego se desploma por BTC.
- **API down / rate limited:** Binance puede tener outages justo en el momento crítico.

### Por qué detectar +100% es difícil
- Son eventos raros: quizás 5-15 por mes en todo Binance Futures.
- Muchos tienen poca o ninguna señal previa detectable (pump por noticia).
- La mayoría ocurren en monedas de muy baja capitalización donde los datos son más ruidosos.
- El sesgo de supervivencia hace que parezcan más predecibles en retrospectiva.
- **Expectativa realista:** Detectar 20-30% de pumps +100% en etapa de WATCH, con ratio de FP aceptable.

### Cómo evitar sobreoptimización
- No ajustar más de 2-3 parámetros a la vez.
- Validación walk-forward: optimizar en período A, validar en B.
- Priorizar robustez sobre precisión: umbrales que funcionan en ±30% de su valor son mejores que umbrales exactos.
- Si un parámetro solo funciona en un rango muy estrecho, probablemente está sobreoptimizado.

### Monedas ilíquidas
- Filtrar universo por volumen mínimo ($1M/24h). Monedas por debajo son imposibles de operar y generan señales falsas.
- Incluso con filtro, algunas monedas tienen spreads altos → penalizar en scoring.

### Manipulación y spoofing
- Spoofing es común en crypto, especialmente en monedas medianas.
- Detección real de spoofing requiere order book en tiempo real (Fase 4).
- Mientras tanto: volumen extremo (>20x RVOL) sin movimiento de precio significativo → penalizar como sospechoso.

### Alert spam
- Sin control, el bot puede enviar 50+ alertas/día si los umbrales son bajos.
- Solución: max alerts/hora, deduplicación, agrupamiento de WATCH, quiet hours.
- **Meta:** <10 alertas WATCH/día, <3 PRE-PUMP/día, <1 IGNITION/día.

---

## 17. DECISIONES TÉCNICAS IMPORTANTES

### ¿SQLite o PostgreSQL para el MVP?

**→ SQLite.**

| Criterio | SQLite | PostgreSQL |
|---|---|---|
| Setup | Zero-config, un archivo | Requiere servidor/Docker |
| Performance MVP | Sobra para 200 símbolos × 1 ciclo/min | Overkill |
| Portabilidad | Copiar un archivo | Dump/restore |
| Concurrent writes | Una sola → WAL mode alcanza | Nativo |
| Queries complejas | Bien para MVP | Mejor para analytics |

Migrar a PostgreSQL/TimescaleDB cuando: se necesite concurrencia real, datos de múltiples exchanges, o queries analíticas complejas (Fase 5-6).

### ¿REST polling o WebSocket?

**→ REST para MVP. WebSocket desde Fase 3.**

- REST es debuggable, predecible, suficiente para intervalos de 60s.
- WebSocket se agrega para trades y order book (datos que necesitan latencia baja).
- No mezclar ambos para los mismos datos (ej: no tener REST y WS para candles).

### ¿Guardar todos los trades o solo agregados?

**→ Solo agregados en MVP.** Guardar aggTrades individuales genera GB por día. Agregar en ventanas de 1m (CVD_1m, taker_buy_vol_1m) y guardar solo los agregados. Trades crudos solo si se necesitan para replay exacto (Fase 5+ con almacenamiento externo).

### ¿Escanear todos los símbolos o filtrar universo?

**→ Filtrar.** Pasos:
1. Obtener todos los pares USDT-M activos (~200-300).
2. Filtrar por volumen 24h > $1M (~150-200).
3. Excluir stablecoins (BUSD, DAI, etc.).
4. Excluir blacklist manual.
5. Resultado: ~120-180 símbolos.

Refresh del universo cada 1h (pueden listarse nuevos pares).

### ¿Cada cuánto recalcular features?

| Dato | Recolección | Features recalculados |
|---|---|---|
| Candles 1m | Cada 60s | RVOL_1m, vol_zscore al cierre de candle |
| Candles 5m/15m/1h | Cada 5m (cuando cierran) | Compresión, breakout, extension |
| OI | Cada 60s | OI change, OI z-score |
| Funding | Cada 5m (premium index) | Funding score |
| **Score total** | **Cada 60s** | Después de recalcular features |

### ¿Cuándo abrir monitoreo intensivo?

Cuando `symbol_state.current_state` entra a WATCH o superior:
- Scan cada 30s en lugar de 60s.
- En Fase 3+: abrir WebSocket de aggTrades.
- En Fase 4+: abrir WebSocket de depth.
- Max simultáneos: 20 símbolos en monitoreo intensivo (configurable).

### ¿Cómo manejar reconexiones WebSocket?

(Aplica desde Fase 3)
1. Detectar desconexión (ping timeout, close event, error).
2. Backoff exponencial: 1s → 2s → 4s → 8s → 16s → max 60s.
3. Al reconectar, pedir snapshot REST para cubrir el gap.
4. Loguear cada desconexión/reconexión.
5. Si falla 5 veces consecutivas, marcar símbolo como "datos incompletos" y no alertar.

### ¿Cómo manejar rate limits?

1. Queue de requests con concurrencia limitada (ej: max 10 requests simultáneos).
2. Trackear weight consumido por minuto (header `X-MBX-USED-WEIGHT-1M`).
3. Si weight > 80% del límite, pausar 5 segundos.
4. Si recibe 429, pausar el tiempo indicado en `Retry-After`.
5. Priorizar requests: OI y candles de hot symbols > candles de símbolos normales.

### ¿Cómo diseñar logs?

- **Logger:** Pino (más rápido que Winston, JSON nativo).
- **Niveles:** error (crash, API fail), warn (rate limit hit, datos faltantes), info (ciclo completado, transiciones), debug (features calculados, scores).
- **Formato:** JSON para parseo. Campos: timestamp, level, module, symbol (si aplica), message, data.
- **Rotación:** Max 50MB por archivo, 5 archivos.
- **Métricas por ciclo:** duración, símbolos procesados, requests hechos, transiciones, errores.

### ¿Cómo testear módulos críticos?

| Módulo | Estrategia de test |
|---|---|
| Features | Unit tests con datos sintéticos. Verificar que RVOL=3 cuando vol es 3x la media. |
| Scoring | Unit tests con features conocidos → score esperado. Edge cases (todo 0, todo max). |
| State Machine | Unit tests con secuencias de scores → transiciones esperadas. Histéresis. Cooldowns. |
| Exchange Client | Integration tests contra Binance testnet (o mocks para CI). |
| Alert Formatter | Unit tests: features → formato de mensaje esperado. |
| Storage | Integration tests: insert → query → verificar datos. |

---

## 18. QUÉ NO CONSTRUIR TODAVÍA

| No construir | Por qué |
|---|---|
| **Machine learning** | No hay datos etiquetados. No hay baseline. Sin backtesting serio, ML va a overfitear. Primero: reglas simples → datos → backtest → solo entonces evaluar si ML aporta. |
| **Dashboard web** | Consume semanas de desarrollo. Telegram cubre el 90% de las necesidades iniciales. Dashboard es para Fase 7+. |
| **Ejecución automática** | Riesgo financiero real sin validación. Primero operar manualmente con alertas durante 2-3 meses mínimo. |
| **Social scraping** | APIs caras, rate limits agresivos, datos ruidosos. No es core para detectar acumulación/compresión. Fase 7. |
| **On-chain complejo** | Requiere infraestructura de indexación (Dune, The Graph). Alto costo y complejidad. Valor incierto para futures. |
| **Multi-exchange día 1** | Normalización de datos entre exchanges es trabajo significativo. Binance cubre >50% del volumen. Suficiente para MVP. |
| **Optimización de parámetros** | Sin backtesting, cualquier optimización es ilusoria. Usar valores teóricos razonables y ajustar con observación. |
| **Persistencia de order book** | Genera TB de datos. Solo guardar snapshots agregados (imbalance, depth) si se implementa. |
| **Pattern recognition visual** | Detectar "cup and handle", "ascending triangle" etc. es ruidoso y poco confiable sin ML entrenado. Las features numéricas (compresión, breakout) capturan lo esencial. |
| **Alertas multi-canal** | Discord, email, SMS, webhook. Telegram es suficiente. Agregar canales después si hay demanda. |

---

## 19. PLAN DE IMPLEMENTACIÓN PASO A PASO

### Fase 0 — Fundación

| # | Tarea | Dependencia |
|---|---|---|
| 1 | Crear proyecto Node.js (package.json, ESM, .gitignore) | — |
| 2 | Crear estructura de carpetas completa | 1 |
| 3 | Configurar Pino logger | 2 |
| 4 | Crear config manager: carga JSON + .env + validación + defaults | 2 |
| 5 | Crear storage layer: init SQLite, crear tablas, WAL mode | 3, 4 |
| 6 | Escribir tests: config carga bien, DB se inicializa | 5 |
| 7 | Script `setup-db.js` para reset de DB | 5 |

### Fase 1 — Scanner + Features + Scoring + Alertas

| # | Tarea | Dependencia |
|---|---|---|
| 8 | Crear exchange client Binance: exchangeInfo, ticker24h | 4 |
| 9 | Implementar rate limiter con queue | 8 |
| 10 | Implementar universe filter (vol, stablecoins, blacklist) | 8 |
| 11 | Script `test-binance.js` para verificar conectividad | 8 |
| 12 | Recolectar y guardar klines (1m, 5m, 1h) para todos los símbolos | 9, 5 |
| 13 | Recolectar y guardar OI snapshots | 9, 5 |
| 14 | Recolectar y guardar funding rates | 9, 5 |
| 15 | Feature: RVOL (1m, 5m, 1h) | 12 |
| 16 | Feature: volume z-score (5m, 1h) | 12 |
| 17 | Feature: OI change %, OI z-score | 13 |
| 18 | Feature: OI-Price divergence | 17, 12 |
| 19 | Feature: funding rate, funding regime | 14 |
| 20 | Feature: price return, price extension | 12 |
| 21 | Tests unitarios de todos los features | 15-20 |
| 22 | Scoring engine: pesos + penalizaciones + breakdown | 21 |
| 23 | Tests de scoring con fixtures | 22 |
| 24 | Crear Telegram client + formatter para WATCH | — |
| 25 | Script `test-telegram.js` | 24 |
| 26 | Orchestrator: loop principal scan→features→scoring→alert | 22, 24 |
| 27 | Correr bot 24h, observar alertas, ajustar umbrales | 26 |

### Fase 2 — State Machine + Compresión + Breakout

| # | Tarea | Dependencia |
|---|---|---|
| 28 | Feature: BBW compresión, ATR% | 12 |
| 29 | Feature: rango lateral prolongado | 12 |
| 30 | Feature: breakout de highs (1h/4h/12h/24h/72h) | 12 |
| 31 | Tests de features Fase 2 | 28-30 |
| 32 | State machine: estados, transiciones, histéresis, cooldowns | 22 |
| 33 | Tests de state machine con secuencias | 32 |
| 34 | Hot symbols manager: monitoreo intensivo | 32 |
| 35 | Formatter de alertas para cada estado | 32, 24 |
| 36 | Integrar state machine en orchestrator | 32, 26 |
| 37 | Correr 48h, validar transiciones, ajustar | 36 |

### Fases 3-7 (resumen)

| # | Tarea |
|---|---|
| 38 | WebSocket manager + aggTrades para hot symbols |
| 39 | CVD, taker buy ratio real-time |
| 40 | WebSocket depth, imbalance, ask thinning |
| 41 | Spoofing detection |
| 42 | Backtester engine |
| 43 | Event labeler + reporter |
| 44 | Walk-forward validation |
| 45 | CoinGlass client + OI multi-exchange |
| 46 | Social API client + social z-score |

---

## 20. PREGUNTAS CRÍTICAS ANTES DE CONSTRUIR

### Mercado y estrategia

1. **¿Solo Binance Futures o también Spot?**
   Spot puede dar señales tempranas (acumulación antes de que se mueva el perp). Pero duplica la complejidad. *Recomendación: solo Futures para MVP.*

2. **¿Qué definición exacta de pump extremo voy a usar?**
   Propuesta: +100% en 24h desde un mínimo local, con drawdown previo < 10%. Pero quizás +50% en 12h es más útil operativamente. *Decidir antes del backtesting.*

3. **¿Qué timeframe quiero anticipar?**
   ¿Quiero detectar 12h antes? ¿4h antes? ¿1h antes? A mayor anticipación, más falsos positivos. *Recomendación: apuntar a 2-6h de anticipación.*

4. **¿Prefiero alertas tempranas (más FP) o tardías (más confiables)?**
   Esto define los umbrales. Alertas WATCH tempranas → mucho ruido. Alertas solo en PRE-PUMP → menos ruido pero menos tiempo para reaccionar. *Recomendación: WATCH con ruido tolerable, PRE-PUMP como filtro fuerte.*

### Operativo

5. **¿Cuántas alertas por día son aceptables?**
   Si son >20, las voy a ignorar. Si son <3, quizás estoy perdiendo oportunidades. *Recomendación: 5-10 WATCH/día, 1-3 PRE-PUMP/día, 0-1 IGNITION/día.*

6. **¿Cuánta latencia acepto?**
   Si el pump ocurre en 5 minutos y el scanner corre cada 60s, puedo detectarlo en IGNITION pero no en PRE-PUMP. *Con REST polling cada 60s, latencia promedio de detección: 30-90 segundos.*

7. **¿Qué liquidez mínima exijo?**
   Monedas con $200K de volumen 24h generan señales pero son inoperables. *$1M de volumen 24h como mínimo razonable. Considerar $5M para mayor calidad.*

8. **¿Voy a operar manualmente o automatizar?**
   *Recomendación firme: manual durante 2-3 meses mínimo.* Usar alertas para tomar decisiones humanas.

### Técnico

9. **¿Excluyo BTC y ETH del universo?**
   No hacen pump de +100%. Pero pueden servir como contexto (BTC override). *Recomendación: excluir de alertas, incluir BTC como indicador de contexto.*

10. **¿Cómo manejo nuevos listings?**
    Monedas nuevas en Binance Futures suelen tener pumps iniciales. ¿Las incluyo inmediatamente o espero N días para tener baseline? *Recomendación: incluir pero con flag "new_listing" y umbrales más altos.*

11. **¿Guardo datos para todas las monedas o solo las del universo filtrado?**
    *Recomendación: solo universo filtrado.* Guardar todas consume storage innecesariamente.

12. **¿Cómo manejo el timezone del volumen?**
    Volumen varía por hora del día. RVOL debería comparar con la misma hora de días previos, no con las últimas 20 candles. *Para MVP: SMA simple es aceptable. Mejora futura: RVOL por hora del día.*

13. **¿Qué hago si Binance tiene outage?**
    *Log el error, esperar, reintentar. No alertar sobre símbolos con datos incompletos. Enviar alerta de sistema "⚠️ API UNREACHABLE" si falla >5 min.*

14. **¿Corro el bot en mi máquina local o en un VPS?**
    *Local para desarrollo. VPS (ej: Hetzner, DigitalOcean $5-10/mes) para producción. Necesita uptime 24/7.*

15. **¿Versionado de configuración?**
    *Sí. Guardar config.json en Git. Secrets en .env (no en Git).*

### Validación

16. **¿Cómo sé que el bot no envía basura?**
    *Correr 48h en modo "shadow" (calcula todo pero no alerta). Revisar manualmente los scores y compararlos con lo que pasó. Si los WATCH de ayer efectivamente subieron, el sistema está calibrado.*

17. **¿Cómo mido el éxito?**
    *Métrica principal: de las alertas PRE-PUMP, ¿qué % hizo +30% o más en las siguientes 12h? Si > 25%, el sistema es útil.*

18. **¿Cada cuánto recalibro umbrales?**
    *Cada 2 semanas en las primeras fases. Después, mensualmente. Nunca sin datos de backtesting o al menos observación manual.*

19. **¿Necesito históricos antes de arrancar?**
    *No estrictamente. Los z-scores necesitan ~48h de datos para ser confiables. El bot puede arrancar con umbrales fijos los primeros 2 días.*

20. **¿Qué pasa si detecto un pump real pero tarde?**
    *Registrar como LATE/DANGER. Analizar por qué llegó tarde: ¿faltó OI? ¿volumen muy bajo previo? ¿pump por noticia? Usar para mejorar el sistema.*

---

## RESUMEN EJECUTIVO

Este documento cubre el diseño completo del PUMP-BOT. El proyecto está dividido en 5 partes:

| Parte | Secciones | Archivo |
|---|---|---|
| 1/5 | Visión, MVP, Alcance, Arquitectura, Flujo de Datos | `implementation_plan_part1.md` |
| 2/5 | Fuentes de Datos, Features, Scoring | `implementation_plan_part2.md` |
| 3/5 | State Machine, Alertas Telegram, Backtesting | `implementation_plan_part3.md` |
| 4/5 | Roadmap, Carpetas, Modelo de Datos, Config | `implementation_plan_part4.md` |
| 5/5 | Riesgos, Decisiones, No-Build, Implementación, Preguntas | `implementation_plan_part5.md` |

**Siguiente paso:** Responder las 20 preguntas críticas y luego empezar con Fase 0 (pasos 1-7).
