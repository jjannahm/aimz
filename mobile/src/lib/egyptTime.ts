/**
 * Kickoff times are Egypt local times that we store as UTC instants.
 *
 * The offset comes from `Intl` rather than a hard-coded +03:00, so the day
 * Egypt reintroduces summer time this keeps converting correctly.
 */
export const EGYPT_TIME_ZONE = 'Africa/Cairo';

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const parts = (date: Date) => {
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: EGYPT_TIME_ZONE, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date);
  const found = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  return { year: Number(found.year), month: Number(found.month), day: Number(found.day), hour: Number(found.hour) % 24, minute: Number(found.minute), second: Number(found.second) };
};

/** How far Egypt is ahead of UTC at a given instant, in milliseconds. */
const offsetAt = (date: Date) => {
  const local = parts(date);
  return Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - date.getTime();
};

/** The Egypt wall clock reading of an instant. */
export function toEgyptWallClock(date: Date): WallClock {
  const local = parts(date);
  return { year: local.year, month: local.month, day: local.day, hour: local.hour, minute: local.minute };
}

/** The instant an Egypt wall clock reading refers to. */
export function fromEgyptWallClock({ year, month, day, hour, minute }: WallClock): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // One pass lands near the answer; the second settles the reading on the far
  // side of an offset change, where the first guess used the wrong offset.
  const first = new Date(naive - offsetAt(new Date(naive)));
  return new Date(naive - offsetAt(first));
}

/** What the admin reads back, for example `Aug 21, 2026 · 4:39 PM`. */
export function formatEgyptDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Not set';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: EGYPT_TIME_ZONE, dateStyle: 'medium' }).format(date);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: EGYPT_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
  return `${day} · ${time}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` in Egypt time, which is what `datetime-local` speaks. */
export function toEgyptInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = toEgyptWallClock(date);
  return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
}

/** The stored instant for a `datetime-local` reading, which has no zone of its own. */
export function fromEgyptInputValue(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return fromEgyptWallClock({ year: Number(year), month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) }).toISOString();
}
