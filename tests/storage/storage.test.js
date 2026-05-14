import { initDatabase, closeDatabase, _resetDb } from '../../src/storage/database.js';
import { upsertCandles, getCandles } from '../../src/storage/candles.js';
import { logAlert, getRecentAlerts } from '../../src/storage/alerts.js';
import { resolve } from 'path';
import { unlinkSync, existsSync } from 'fs';

const TEST_DB = './data/test_pumpbot.db';

describe('Storage Integration', () => {
  beforeAll(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    initDatabase(TEST_DB, false); // No WAL para tests simples
  });

  afterAll(() => {
    closeDatabase();
    _resetDb();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  test('Candles UPSERT and Query', () => {
    const symbol = 'TESTBTC';
    const interval = '1m';
    const now = Date.now();
    const candle = {
      openTime: now,
      open: 50000,
      high: 51000,
      low: 49000,
      close: 50500,
      volume: 10,
      quoteVolume: 500000
    };

    upsertCandles(symbol, interval, [candle]);
    const stored = getCandles(symbol, interval, 1);
    
    expect(stored.length).toBe(1);
    expect(stored[0].symbol).toBe(symbol);
    expect(stored[0].close).toBe(50500);
  });

  test('Alert Logging and Retrieval', () => {
    const id = logAlert('TESTBTC', 'WATCH', 45, 'Test message', 'shadow');
    expect(id).toBeDefined();

    const alerts = getRecentAlerts(5);
    expect(alerts.find(a => a.symbol === 'TESTBTC')).toBeDefined();
    expect(alerts[0].state).toBe('WATCH');
  });
});
