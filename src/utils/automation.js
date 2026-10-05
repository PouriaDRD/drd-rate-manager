import { APP } from "../config/app.js";
import { isInsideQuietHours } from "./datetime.js";

const zonedFormatterCache = new Map();

export function normalizePublishInterval(value) {
  const number = Number(value);
  return APP.publishIntervals.includes(number) ? number : APP.defaultPublishIntervalMinutes;
}

function zonedFormatter(timezone) {
  if (zonedFormatterCache.has(timezone)) return zonedFormatterCache.get(timezone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  zonedFormatterCache.set(timezone, formatter);
  return formatter;
}

function getZonedParts(config, timestamp) {
  const parts = zonedFormatter(config.timezone).formatToParts(new Date(timestamp));
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function shiftLocalDate(year, month, day, days) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function localWallTimeToTimestamp(config, year, month, day, hour, minute) {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = getZonedParts(config, guess);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, 0, 0);
    const delta = desired - actualAsUtc;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
}

function localSlotTimestamp(config, timestamp, intervalMinutes, offsetSlots = 0) {
  const interval = normalizePublishInterval(intervalMinutes);
  const local = getZonedParts(config, timestamp);
  const minuteOfDay = local.hour * 60 + local.minute;
  let slotMinute = Math.floor(minuteOfDay / interval) * interval + offsetSlots * interval;
  let dayOffset = 0;
  while (slotMinute >= 1440) { slotMinute -= 1440; dayOffset += 1; }
  while (slotMinute < 0) { slotMinute += 1440; dayOffset -= 1; }
  const date = shiftLocalDate(local.year, local.month, local.day, dayOffset);
  return localWallTimeToTimestamp(
    config,
    date.year,
    date.month,
    date.day,
    Math.floor(slotMinute / 60),
    slotMinute % 60,
  );
}

export function calculateCurrentPublishSlotAt(config, intervalMinutes, timestamp = Date.now()) {
  return localSlotTimestamp(config, timestamp, intervalMinutes, 0);
}

export function calculateNextAlignedPublishSlotAt(config, intervalMinutes, timestamp = Date.now()) {
  return localSlotTimestamp(config, timestamp, intervalMinutes, 1);
}

export function calculateNextPublishAt(automation, now = Date.now()) {
  if (!automation.enabled) return 0;
  const config = { timezone: automation.timezone || "Asia/Tehran" };
  const interval = normalizePublishInterval(automation.intervalMinutes);
  const anchor = Math.max(
    Number(automation.scheduleChangedAt || 0),
    Number(automation.lastRunAt || 0),
    Number(automation.lastSuccessSlotAt || 0),
  );
  let candidate = calculateCurrentPublishSlotAt(config, interval, now);
  if (candidate <= anchor) candidate = calculateNextAlignedPublishSlotAt(config, interval, candidate);

  for (let attempt = 0; attempt < 1440; attempt += 1) {
    if (!automation.quietHours?.enabled || !isInsideQuietHours(config, automation.quietHours, candidate)) {
      return candidate;
    }
    candidate = calculateNextAlignedPublishSlotAt(config, interval, candidate);
  }
  return 0;
}
