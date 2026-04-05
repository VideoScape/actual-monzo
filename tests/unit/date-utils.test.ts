/**
 * Unit Tests: Date Utilities
 * Tests for date parsing and validation functions
 */

import { describe, it, expect } from 'vitest';
import { parseDateRange, formatDate, validateDateString } from '../../src/utils/date-utils';

describe('Unit: Date Utilities', () => {
  describe('formatDate', () => {
    it('should format ISO timestamp to YYYY-MM-DD', () => {
      expect(formatDate('2025-10-02T14:30:00.000Z')).toBe('2025-10-02');
      expect(formatDate('2025-01-01T00:00:00.000Z')).toBe('2025-01-01');
      expect(formatDate('2025-12-31T23:59:59.999Z')).toBe('2025-12-31');
    });
  });

  describe('validateDateString', () => {
    it('should validate correct date format', () => {
      const date = validateDateString('2025-10-02');
      expect(date).toBeInstanceOf(Date);
      expect(date.toISOString()).toContain('2025-10-02');
    });

    it('should reject invalid date format', () => {
      expect(() => validateDateString('2025-10-2')).toThrow('Invalid date format');
      expect(() => validateDateString('10-02-2025')).toThrow('Invalid date format');
      expect(() => validateDateString('2025/10/02')).toThrow('Invalid date format');
    });

    it('should reject invalid dates', () => {
      expect(() => validateDateString('2025-02-30')).toThrow('does not exist in calendar');
      expect(() => validateDateString('2025-13-01')).toThrow('Invalid date');
    });
  });

  describe('parseDateRange', () => {
    it('should parse valid date range', () => {
      const range = parseDateRange('2025-10-01', '2025-10-05');
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
      expect(range.start.toISOString()).toContain('2025-10-01');
      expect(range.end.toISOString()).toContain('2025-10-05');
    });

    it('should make end date inclusive by setting time to end of day', () => {
      // This is the key test - end date should be set to 23:59:59.999
      // so that Monzo API's exclusive 'before' parameter includes all of that day
      const range = parseDateRange('2025-10-01', '2025-10-02');

      // Check that end date is set to end of day
      expect(range.end.getUTCHours()).toBe(23);
      expect(range.end.getUTCMinutes()).toBe(59);
      expect(range.end.getUTCSeconds()).toBe(59);
      expect(range.end.getUTCMilliseconds()).toBe(999);

      // Verify the date is still correct
      expect(range.end.getUTCFullYear()).toBe(2025);
      expect(range.end.getUTCMonth()).toBe(9); // October is month 9 (0-indexed)
      expect(range.end.getUTCDate()).toBe(2);
    });

    it('should include transactions from today when end date is today', () => {
      const today = new Date();
      const startDate = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const todayStr = today.toISOString().split('T')[0];
      const startStr = startDate.toISOString().split('T')[0];
      const range = parseDateRange(startStr, todayStr);

      // End date should be set to end of day to include all of today's transactions
      expect(range.end.getUTCHours()).toBe(23);
      expect(range.end.getUTCMinutes()).toBe(59);
      expect(range.end.getUTCSeconds()).toBe(59);
      expect(range.end.getUTCMilliseconds()).toBe(999);
    });

    it('should reject start date after end date', () => {
      expect(() => parseDateRange('2025-10-05', '2025-10-01')).toThrow(
        'Start date (2025-10-05) must be before or equal to end date (2025-10-01)'
      );
    });

    it('should reject future start date', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      expect(() => parseDateRange(futureDate, futureDate)).toThrow('cannot be in the future');
    });

    it('should reject date range larger than 90 days', () => {
      expect(() => parseDateRange('2025-01-01', '2025-04-15')).toThrow('Date range too large');
    });

    it('should allow exactly 90 day range', () => {
      const range = parseDateRange('2025-01-01', '2025-04-01'); // Exactly 90 days
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
    });
  });
});
