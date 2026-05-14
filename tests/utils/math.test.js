import { sma, zscore, lerp, clamp, pctChange } from '../../src/utils/math.js';

describe('Math Utils', () => {
  test('sma calculates simple moving average', () => {
    const values = [10, 20, 30, 40, 50];
    expect(sma(values, 3)).toBe(40); // (30+40+50)/3
    expect(sma(values, 5)).toBe(30);
    expect(sma([10, 20], 3)).toBeNull();
  });

  test('zscore detects anomalies', () => {
    const history = [10, 10, 10, 10, 10];
    // mean 10, std 0. Si current es 10, z es 0.
    expect(zscore(10, history, 5)).toBe(0);
    
    const history2 = [10, 12, 11, 9, 10]; // mean 10.4, std ~1.01
    const z = zscore(20, history2, 5);
    expect(z).toBeGreaterThan(3); // 20 es una anomalía clara
  });

  test('lerp maps values correctly', () => {
    expect(lerp(5, 0, 10, 0, 100)).toBe(50);
    expect(lerp(15, 0, 10, 0, 100)).toBe(100); // clamped
    expect(lerp(-5, 0, 10, 0, 100)).toBe(0);   // clamped
  });

  test('pctChange calculates percentage difference', () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(90, 100)).toBe(-10);
    expect(pctChange(100, 0)).toBeNull();
  });
});
