import { describe, expect, it } from 'vitest';
import { describeSchedule } from '../../components/obs/automations';

describe('describeSchedule', () => {
  it('reads cron schedules as plain English', () => {
    expect(describeSchedule('USING CRON 0 9 * * 1 America/New_York')).toBe('Mondays at 09:00 America/New_York');
    expect(describeSchedule('USING CRON 0 8 * * * America/New_York')).toBe('Daily at 08:00 America/New_York');
    expect(describeSchedule('USING CRON 30 7 * * 1-5 UTC')).toBe('Weekdays at 07:30 UTC');
    expect(describeSchedule('USING CRON 0 6 1 * * UTC')).toBe('Monthly on day 1 at 06:00 UTC');
    expect(describeSchedule('USING CRON 0 9 * * 2,5 UTC')).toBe('Tuesdays, Fridays at 09:00 UTC');
  });
  it('handles intervals and empty schedules', () => {
    expect(describeSchedule('60 MINUTES')).toBe('Every 60 minutes');
    expect(describeSchedule(null)).toBe('Manual');
  });
});
