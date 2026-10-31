import {
  configSchema,
  hourlyTargets,
  isNight,
  type Contact,
  type SessionConfig,
} from '../src/domain';
export type PlannedEvent = {
  sender_id: string;
  kind: 'message' | 'image' | 'reply';
  reply_id: string | null;
  scheduled_at: string;
};
export function pick<T>(items: T[], weights: number[], random: () => number): T {
  let n = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    n -= weights[i];
    if (n < 0) return items[i];
  }
  return items[items.length - 1];
}
/** Jittered strata limit bursts; rejection by mean activity preserves per-contact night reduction. */
export function createSchedule(
  input: SessionConfig,
  contacts: Contact[],
  start: Date,
  random: () => number = Math.random,
): PlannedEvent[] {
  const config = configSchema.parse(input);
  const selected = config.selected.map((id) => contacts.find((c) => c.id === id && c.enabled));
  if (selected.some((c) => !c)) throw new Error('A selected contact is missing or disabled');
  const senders = selected as Contact[];
  const events: PlannedEvent[] = [];
  let previous = '';
  let repeats = 0;
  hourlyTargets(config).forEach((count, hour) => {
    for (let i = 0; i < count; i++) {
      const time = new Date(
        start.getTime() + hour * 3600000 + ((i + 0.15 + random() * 0.7) * 3600000) / count,
      );
      const weights = senders.map((c) => (isNight(c.timezone, time) ? 0.15 : 1));
      if (random() >= weights.reduce((a, b) => a + b, 0) / senders.length) continue;
      const adjusted = weights.map((w, j) =>
        senders[j].id === previous && repeats >= 2 ? w * 0.85 : w,
      );
      const sender = pick(senders, adjusted, random);
      repeats = sender.id === previous ? repeats + 1 : 1;
      previous = sender.id;
      const kind = pick(
        ['message', 'image', 'reply'] as const,
        [config.distribution.message, config.distribution.image, config.distribution.reply],
        random,
      );
      const replies = contacts.filter((c) => c.id !== sender.id);
      const reply =
        kind === 'reply'
          ? pick([null, ...replies.map((c) => c.id)], Array(replies.length + 1).fill(1), random)
          : null;
      events.push({
        sender_id: sender.id,
        kind,
        reply_id: reply,
        scheduled_at: time.toISOString(),
      });
    }
  });
  return events;
}
export function notificationBody(kind: string, name: string, target?: string) {
  if (kind === 'test') return 'DXB test notification. Background delivery check.';
  return `Simulation · ${kind === 'reply' ? `${name} replied to ${target || 'You'}` : `${name} sent you ${kind === 'image' ? 'an image' : 'a message'}`}`;
}
