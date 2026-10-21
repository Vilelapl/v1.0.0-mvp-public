import { describe, expect, it } from 'vitest';
import { formatAmount, formatDate, fromLimaInput, localDateRange, toLimaInput, validAmount } from '../src/features/transactions/format';

describe('dinero exacto', () => {
  it.each(['1', '1.1', '1.10', '1.01', '0.10', '0.20', '1250.00', '999999999999.99'])('conserva %s como decimal textual válido', (amount) => { expect(validAmount(amount)).toBe(true); expect(typeof amount).toBe('string'); });
  it.each(['0', '0.00', '-1.00', '1.234', '1e3', 'NaN', '1,25', '1000000000000', ''])('rechaza %s', (amount) => expect(validAmount(amount)).toBe(false));
  it('formatea sin convertir a punto flotante, también sumas grandes', () => {
    expect(formatAmount('9007199254740993.01')).toBe('9,007,199,254,740,993.01');
    expect(formatAmount('-1250.10')).toBe('-1,250.10');
    expect(formatAmount('0.10')).toBe('0.10');
    expect(formatAmount('1.1')).toBe('1.10');
    expect(formatAmount('1.01')).toBe('1.01');
  });
});
describe('UTC y America/Lima', () => {
  it('UTC de madrugada se muestra en el día anterior de Lima', () => {
    expect(formatDate('2026-09-11T04:30:00.000Z')).toBe('10/09/2026, 23:30');
    expect(formatDate('2026-09-11T05:00:00.000Z')).toBe('11/09/2026, 00:00');
  });
  it('round trip del formulario conserva el instante y milisegundos', () => {
    const instant = '2026-09-11T04:30:45.123Z';
    expect(toLimaInput(instant)).toBe('2026-09-10T23:30:45.123');
    expect(fromLimaInput(toLimaInput(instant))).toBe(instant);
  });
  it('un día local incluye desde medianoche hasta medianoche siguiente exclusiva', () => {
    expect(localDateRange('2026-09-11', '2026-09-11')).toEqual({ from: '2026-09-11T05:00:00.000Z', to: '2026-09-12T05:00:00.000Z' });
  });
  it('respeta fin de mes, año y días bisiestos', () => {
    expect(localDateRange('', '2026-12-31').to).toBe('2027-01-01T05:00:00.000Z');
    expect(localDateRange('2024-02-29', '2024-02-29')).toEqual({ from: '2024-02-29T05:00:00.000Z', to: '2024-03-01T05:00:00.000Z' });
  });
  it('admite extremos opcionales y rechaza fechas ambiguas o imposibles', () => {
    expect(localDateRange('', '')).toEqual({});
    expect(localDateRange('2026-09-11', '')).toEqual({ from: '2026-09-11T05:00:00.000Z' });
    expect(() => localDateRange('2026-09-12', '2026-09-11')).toThrow();
    expect(() => localDateRange('2026-02-30', '')).toThrow();
    expect(() => fromLimaInput('2026-02-30T10:00')).toThrow();
  });
});
