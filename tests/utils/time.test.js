import { intervalToMs, candleOpenTime } from '../../src/utils/time.js';

describe('Time Utils', () => {
  test('intervalToMs converts strings correctly', () => {
    expect(intervalToMs('1m')).toBe(60000);
    expect(intervalToMs('1h')).toBe(3600000);
    expect(intervalToMs('1d')).toBe(86400000);
  });

  test('candleOpenTime rounds to the start of interval', () => {
    const ts = 1715560050000; // Un momento cualquiera
    const open1m = candleOpenTime(ts, '1m');
    expect(open1m % 60000).toBe(0);
    expect(open1m).toBeLessThanOrEqual(ts);

    const open1h = candleOpenTime(ts, '1h');
    expect(open1h % 3600000).toBe(0);
  });
});
