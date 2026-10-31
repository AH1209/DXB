import { describe, it, expect } from 'vitest';
import {
  configSchema,
  contactSchema,
  hourlyTargets,
  isNight,
  localHour,
  type Contact,
  type SessionConfig,
} from '../src/domain';
import { createSchedule, notificationBody } from '../server/schedule';
const a = '00000000-0000-4000-8000-000000000001',
  b = '00000000-0000-4000-8000-000000000002';
const contact = (id = a, timezone = 'UTC'): Contact => ({
  id,
  name: 'Alex',
  country: 'GB',
  city: '',
  timezone,
  age: null,
  description: '',
  enabled: true,
  avatar_path: null,
  last_activity: null,
});
const config: SessionConfig = {
  duration: 3,
  frequency: 20,
  overrides: [],
  selected: [a],
  distribution: { message: 70, image: 20, reply: 10 },
};
function rng(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
describe('configuration', () => {
  it.each([0, 10, 1.5])('rejects duration %s', (duration) =>
    expect(configSchema.safeParse({ ...config, duration }).success).toBe(false),
  );
  it.each([4, 100, 10.5])('rejects frequency %s', (frequency) =>
    expect(configSchema.safeParse({ ...config, frequency }).success).toBe(false),
  );
  it('validates overrides, selection and distribution', () => {
    for (const change of [
      { overrides: [100] },
      { selected: [] },
      { selected: [a, a] },
      { distribution: { message: 60, image: 20, reply: 10 } },
    ])
      expect(configSchema.safeParse({ ...config, ...change }).success).toBe(false);
  });
  it('inherits updated baseline and ignores shortened hours', () => {
    expect(hourlyTargets({ ...config, frequency: 30, overrides: [null, 40, null, 99] })).toEqual([
      30, 40, 30,
    ]);
    expect(hourlyTargets({ ...config, duration: 1, overrides: [null, 40] })).toEqual([20]);
  });
  it('validates countries, zones and required names', () => {
    expect(contactSchema.safeParse({ ...contact(), name: '' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...contact(), country: 'ZZ' }).success).toBe(false);
    expect(contactSchema.safeParse({ ...contact(), timezone: 'Mars/Olympus' }).success).toBe(false);
  });
});
describe('local time and DST', () => {
  it('uses inclusive 01:00 and exclusive 07:00', () => {
    expect(isNight('UTC', new Date('2026-01-01T00:59:59Z'))).toBe(false);
    expect(isNight('UTC', new Date('2026-01-01T01:00:00Z'))).toBe(true);
    expect(isNight('UTC', new Date('2026-01-01T07:00:00Z'))).toBe(false);
  });
  it('handles both DST transitions', () => {
    expect(localHour('America/New_York', new Date('2026-03-08T06:30Z'))).toBe(1);
    expect(localHour('America/New_York', new Date('2026-03-08T07:30Z'))).toBe(3);
    expect(localHour('America/New_York', new Date('2026-11-01T05:30Z'))).toBe(1);
    expect(localHour('America/New_York', new Date('2026-11-01T06:30Z'))).toBe(1);
  });
});
describe('persistent schedule planning', () => {
  it('has exact daytime targets, stable timestamps and nonmechanical gaps', () => {
    const start = new Date('2026-01-01T10:00Z');
    const events = createSchedule(config, [contact()], start, rng());
    expect(events).toHaveLength(60);
    expect(events).toEqual(createSchedule(config, [contact()], start, rng()));
    expect(
      events.every(
        (e) =>
          new Date(e.scheduled_at) > start &&
          new Date(e.scheduled_at) < new Date('2026-01-01T13:00Z'),
      ),
    ).toBe(true);
    const gaps = events
      .slice(1)
      .map((e, i) => +new Date(e.scheduled_at) - +new Date(events[i].scheduled_at));
    expect(new Set(gaps).size).toBeGreaterThan(30);
    expect(Math.min(...gaps)).toBeGreaterThan(40000);
  });
  it('honors hourly overrides', () => {
    expect(
      createSchedule(
        { ...config, overrides: [5, 99, null] },
        [contact()],
        new Date('2026-01-01T10:00Z'),
        rng(),
      ),
    ).toHaveLength(124);
  });
  it('reduces all-sleeping activity to about 15%', () => {
    let count = 0;
    const random = rng();
    for (let i = 0; i < 200; i++)
      count += createSchedule(
        { ...config, duration: 1, frequency: 99 },
        [contact()],
        new Date('2026-01-01T02:00Z'),
        random,
      ).length;
    expect(count / (200 * 99)).toBeGreaterThan(0.13);
    expect(count / (200 * 99)).toBeLessThan(0.17);
  });
  it('weights sleeping senders while preserving awake activity', () => {
    const random = rng();
    let asleep = 0,
      awake = 0;
    for (let i = 0; i < 100; i++) {
      const events = createSchedule(
        { ...config, duration: 1, frequency: 99, selected: [a, b] },
        [contact(a, 'UTC'), contact(b, 'Asia/Tokyo')],
        new Date('2026-01-01T02:00Z'),
        random,
      );
      asleep += events.filter((e) => e.sender_id === a).length;
      awake += events.filter((e) => e.sender_id === b).length;
    }
    expect(asleep / awake).toBeGreaterThan(0.1);
    expect(asleep / awake).toBeLessThan(0.3);
    expect(awake).toBeGreaterThan(3500);
  });
  it('transitions across midnight and nighttime start', () => {
    const events = createSchedule(
      { ...config, duration: 3, frequency: 99 },
      [contact()],
      new Date('2026-01-01T23:00Z'),
      rng(),
    );
    expect(events.filter((e) => new Date(e.scheduled_at).getUTCHours() === 0)).toHaveLength(99);
    expect(events.filter((e) => new Date(e.scheduled_at).getUTCHours() === 1).length).toBeLessThan(
      30,
    );
  });
  it('validates missing and disabled contacts', () => {
    expect(() => createSchedule(config, [], new Date())).toThrow();
    expect(() => createSchedule(config, [{ ...contact(), enabled: false }], new Date())).toThrow();
  });
  it('reply-only with one contact targets You', () => {
    const events = createSchedule(
      { ...config, distribution: { message: 0, image: 0, reply: 100 } },
      [contact()],
      new Date('2026-01-01T10:00Z'),
      rng(),
    );
    expect(events.every((e) => e.kind === 'reply' && e.reply_id === null)).toBe(true);
    expect(notificationBody('reply', 'Alex')).toBe('Simulation · Alex replied to You');
  });
  it('approximately respects content weights', () => {
    const random = rng();
    const counts = { message: 0, image: 0, reply: 0 };
    for (let i = 0; i < 100; i++)
      for (const e of createSchedule(config, [contact()], new Date('2026-01-01T10:00Z'), random))
        counts[e.kind]++;
    expect(counts.message / 6000).toBeCloseTo(0.7, 1);
    expect(counts.image / 6000).toBeCloseTo(0.2, 1);
    expect(counts.reply / 6000).toBeCloseTo(0.1, 1);
  });
});
