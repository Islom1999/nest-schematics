import { BadRequestException } from '@nestjs/common';

/** `YYYY-MM-DD` that is a real calendar day. */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest `from`..`to` window the admin queries accept. */
export const MAX_RANGE_DAYS = 366;

/** UTC midnight of a `YYYY-MM-DD` string; 400 for anything else (`2026-02-30` included). */
export function parseDay(value: string, name: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!DAY_RE.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${name} must be a day as YYYY-MM-DD`);
  }
  return date;
}

export const dayKey = (date: Date): string => date.toISOString().slice(0, 10);
export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

/** Every UTC day from `from` to `to`, both included. */
export function eachDay(from: Date, to: Date): string[] {
  const days: string[] = [];
  for (let day = from; day.getTime() <= to.getTime(); day = addDays(day, 1)) days.push(dayKey(day));
  return days;
}

/**
 * The inclusive UTC day window of `from`/`to` (`YYYY-MM-DD`). Missing `to` =
 * today, missing `from` = `fallbackDays` days up to `to` (the window then has
 * that many days). 400 when `from` is after `to` or the window is longer than
 * {@link MAX_RANGE_DAYS}.
 */
export function dayWindow(from: string | undefined, to: string | undefined, fallbackDays: number): { from: Date; to: Date } {
  const end = to ? parseDay(to, 'to') : parseDay(dayKey(new Date()), 'to');
  const start = from ? parseDay(from, 'from') : addDays(end, -(fallbackDays - 1));
  if (start.getTime() > end.getTime()) throw new BadRequestException('from must not be after to');
  if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
    throw new BadRequestException(`The window is at most ${MAX_RANGE_DAYS} days`);
  }
  return { from: start, to: end };
}
