import { describe, it, expect } from 'vitest';
import { parseAuditDate, relativeAge, toIsoDate } from '../utils/format';

describe('toIsoDate', () => {
  it('passes through ISO dates', () => {
    expect(toIsoDate('2026-06-24')).toBe('2026-06-24');
  });

  it('converts MM/DD/YYYY without timezone drift', () => {
    expect(toIsoDate('06/24/2026')).toBe('2026-06-24');
    expect(toIsoDate('12/31/2025')).toBe('2025-12-31');
  });

  it('returns null for unparseable input', () => {
    expect(toIsoDate('not a date')).toBeNull();
    expect(toIsoDate('')).toBeNull();
  });
});

describe('relativeAge', () => {
  const now = new Date('2026-07-02T06:00:00Z').getTime();

  it('is "today" only for same-day dates', () => {
    expect(relativeAge('2026-07-02', now)).toBe('today');
  });

  it('reports a past audit relative to the given clock, not the build clock', () => {
    // Saturn re-audit: 2026-06-24 viewed on 2026-07-02 → 8 days → "1w ago"
    expect(relativeAge('06/24/2026', now)).toBe('1w ago');
    expect(relativeAge('2026-06-24', now)).toBe('1w ago');
  });

  it('handles month and year scales', () => {
    expect(relativeAge('2026-04-15', now)).toBe('3mo ago');
    expect(relativeAge('2024-07-02', now)).toBe('2.0y ago');
  });
});

describe('parseAuditDate', () => {
  it('parses both metadata formats', () => {
    expect(parseAuditDate('06/24/2026')).not.toBeNull();
    expect(parseAuditDate('2026-06-24')).not.toBeNull();
    expect(parseAuditDate('garbage')).toBeNull();
  });
});
