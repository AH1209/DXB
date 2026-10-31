import { z } from 'zod';
import ct from 'countries-and-timezones';
export const countries = Object.values(ct.getAllCountries()).sort((a, b) =>
  a.name.localeCompare(b.name),
);
export const timezoneSchema = z.string().refine((v) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
  } catch {
    return false;
  }
}, 'Choose a valid IANA time zone');
export const distributionSchema = z
  .object({
    message: z.number().int().min(0).max(100),
    image: z.number().int().min(0).max(100),
    reply: z.number().int().min(0).max(100),
  })
  .refine((v) => v.message + v.image + v.reply === 100, 'Notification percentages must total 100');
export const configSchema = z.object({
  duration: z.number().int().min(1).max(9),
  frequency: z.number().int().min(5).max(99),
  overrides: z.array(z.number().int().min(5).max(99).nullable()).max(9),
  selected: z
    .array(z.string().uuid())
    .min(1)
    .refine((v) => new Set(v).size === v.length, 'Duplicate contacts'),
  distribution: distributionSchema,
});
export const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  country: z.string().refine((v) => !!ct.getCountry(v), 'Choose a country'),
  city: z.string().trim().max(100).default(''),
  timezone: timezoneSchema,
  age: z.number().int().min(1).max(120).nullable().default(null),
  description: z.string().trim().max(300).default(''),
  enabled: z.boolean().default(true),
});
export const settingsSchema = z.object({
  accent: z.enum(['#ffffff', '#b7cbbf', '#c7b9a5']),
  profileName: z.string().trim().min(1).max(60),
  duration: z.number().int().min(1).max(9),
  frequency: z.number().int().min(5).max(99),
  distribution: distributionSchema,
  badge: z.boolean(),
  selected: z.array(z.string().uuid()),
});
export type Contact = z.infer<typeof contactSchema> & {
  id: string;
  avatar_path: string | null;
  last_activity: string | null;
};
export type SessionConfig = z.infer<typeof configSchema>;
export type Preferences = z.infer<typeof settingsSchema>;
export const defaults: Preferences = {
  accent: '#ffffff',
  profileName: 'My space',
  duration: 3,
  frequency: 20,
  distribution: { message: 70, image: 20, reply: 10 },
  badge: true,
  selected: [],
};
export type Session = {
  id: string;
  status: 'active' | 'stopped' | 'completed';
  starts_at: string;
  ends_at: string;
  config: SessionConfig;
  planned: number;
  submitted: number;
  failed: number;
  cancelled: number;
  pending: number;
};
export type Bootstrap = {
  contacts: Contact[];
  settings: Preferences;
  session: Session | null;
  subscriptions: { id: string; device_id: string; status: string; last_success: string | null }[];
  publicKey: string;
  serverNow: string;
  authExpires: string;
};
const hourFormatters = new Map<string, Intl.DateTimeFormat>();
export function localHour(zone: string, date: Date) {
  let formatter = hourFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      hourCycle: 'h23',
    });
    hourFormatters.set(zone, formatter);
  }
  return Number(formatter.format(date));
}
export function isNight(zone: string, date = new Date()) {
  const h = localHour(zone, date);
  return h >= 1 && h < 7;
}
export function localTime(zone: string, date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
export function hourlyTargets(c: Pick<SessionConfig, 'duration' | 'frequency' | 'overrides'>) {
  return Array.from({ length: c.duration }, (_, i) => c.overrides[i] ?? c.frequency);
}
