import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCurrentPublishSlotAt,
  calculateNextAlignedPublishSlotAt,
  calculateNextPublishAt,
} from "../src/utils/automation.js";
import { AutomationService } from "../src/services/automation.service.js";

const config = { timezone: "Asia/Tehran" };
const atIran = (isoUtc) => Date.parse(isoUtc);
const timeInIran = (timestamp) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(timestamp));

class MemorySettings {
  constructor(values = {}, updatedAt = 1) {
    this.values = new Map();
    for (const [key, value] of Object.entries(values)) this.seed(key, value, updatedAt);
  }
  seed(key, value, updatedAt) { this.values.set(key, { value: String(value), updatedAt }); }
  async get(key, fallback = null) { return this.values.get(key)?.value ?? fallback; }
  async getManyWithMeta(keys) {
    return Object.fromEntries(keys.filter((key) => this.values.has(key)).map((key) => [key, this.values.get(key)]));
  }
  async set(key, value) { this.seed(key, value, Date.now()); }
  async setMany(values) { const now = Date.now(); for (const [key, value] of Object.entries(values)) this.seed(key, value ?? "", now); }
}

class MemoryLock {
  constructor() { this.token = null; }
  async acquire() { if (this.token) return null; this.token = "token"; return this.token; }
  async release(_key, token) { if (token === this.token) this.token = null; }
  expire() { this.token = null; }
}

function baseSettings(scheduleChangedAt) {
  return new MemorySettings({
    bot_enabled: "1", auto_publish_enabled: "1", publish_interval_minutes: "5",
    quiet_hours_enabled: "0", quiet_hours_start: "01:00", quiet_hours_end: "10:30",
    auto_publish_last_run_at: "0", auto_publish_last_success_at: "0",
    auto_publish_last_success_slot_at: "0", auto_publish_retry_slot_at: "0",
    auto_publish_last_tick_at: "0", auto_publish_last_attempt_at: "0",
    auto_publish_last_error_at: "0", auto_publish_last_error: "", auto_publish_last_skip_reason: "",
  }, scheduleChangedAt);
}

function makeService({ settings, publish, locks = new MemoryLock() }) {
  const service = new AutomationService(
    {}, config, settings,
    { async getSnapshot() { return { ok: true }; } },
    { async publish(snapshot) { return publish(snapshot); } },
    locks,
  );
  return { service, locks };
}

test("12:06 aligns to 12:10 and then 12:15", () => {
  const now = atIran("2026-10-05T08:36:00Z");
  const automation = {
    enabled: true, timezone: "Asia/Tehran", intervalMinutes: 5,
    scheduleChangedAt: now, lastRunAt: 0, lastSuccessSlotAt: 0,
    quietHours: { enabled: false },
  };
  const first = calculateNextPublishAt(automation, now);
  assert.equal(timeInIran(first), "12:10");
  assert.equal(timeInIran(calculateNextAlignedPublishSlotAt(config, 5, first)), "12:15");
});

test("current aligned slot is floored without drift", () => {
  const now = atIran("2026-10-05T08:36:41Z");
  assert.equal(timeInIran(calculateCurrentPublishSlotAt(config, 5, now)), "12:05");
});

test("23:58 rolls to 00:00 next day", () => {
  const now = atIran("2026-10-05T20:28:00Z");
  assert.equal(timeInIran(calculateNextAlignedPublishSlotAt(config, 5, now)), "00:00");
});

test("quiet hours ending at 10:32 select 10:35 rather than stale 10:30 slot", () => {
  const now = atIran("2026-10-05T07:03:00Z");
  const automation = {
    enabled: true, timezone: "Asia/Tehran", intervalMinutes: 5,
    scheduleChangedAt: atIran("2026-10-05T06:00:00Z"), lastRunAt: 0, lastSuccessSlotAt: 0,
    quietHours: { enabled: true, start: "01:00", end: "10:32" },
  };
  assert.equal(timeInIran(calculateNextPublishAt(automation, now)), "10:35");
});

test("35 minute intervals stay aligned to local midnight", () => {
  const now = atIran("2026-10-05T08:36:00Z");
  const current = calculateCurrentPublishSlotAt(config, 35, now);
  assert.equal(timeInIran(current), "11:40");
  assert.equal(timeInIran(calculateNextAlignedPublishSlotAt(config, 35, current)), "12:15");
});

test("setting changed at 12:06 waits until aligned 12:10 slot", async () => {
  const changedAt = atIran("2026-10-05T08:36:00Z");
  const settings = baseSettings(changedAt);
  let publishes = 0;
  const { service, locks } = makeService({ settings, publish: async () => { publishes += 1; } });
  await service.tick(atIran("2026-10-05T08:37:00Z"));
  assert.equal(publishes, 0);
  await service.tick(atIran("2026-10-05T08:40:05Z"));
  assert.equal(publishes, 1);
  locks.expire();
  await service.tick(atIran("2026-10-05T08:41:00Z"));
  assert.equal(publishes, 1);
});

test("change at 12:09:50 still allows the 12:10 slot", async () => {
  const changedAt = atIran("2026-10-05T08:39:50Z");
  const settings = baseSettings(changedAt);
  let publishes = 0;
  const { service } = makeService({ settings, publish: async () => { publishes += 1; } });
  await service.tick(atIran("2026-10-05T08:40:05Z"));
  assert.equal(publishes, 1);
});

test("change after 12:10 boundary waits for 12:15", async () => {
  const changedAt = atIran("2026-10-05T08:40:02Z");
  const settings = baseSettings(changedAt);
  let publishes = 0;
  const { service } = makeService({ settings, publish: async () => { publishes += 1; } });
  await service.tick(atIran("2026-10-05T08:40:05Z"));
  assert.equal(publishes, 0);
  await service.tick(atIran("2026-10-05T08:45:05Z"));
  assert.equal(publishes, 1);
});

test("failed 12:10 publish retries at 12:11 in the same slot", async () => {
  const settings = baseSettings(atIran("2026-10-05T08:36:00Z"));
  let attempts = 0;
  const { service } = makeService({ settings, publish: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("telegram failed");
  } });
  await assert.rejects(service.tick(atIran("2026-10-05T08:40:05Z")), /telegram failed/);
  assert.equal(timeInIran(Number(await settings.get("auto_publish_retry_slot_at"))), "12:10");
  await service.tick(atIran("2026-10-05T08:41:00Z"));
  assert.equal(attempts, 2);
  assert.equal(await settings.get("auto_publish_retry_slot_at"), "0");
});

test("quiet slot is skipped and first valid slot publishes", async () => {
  const settings = baseSettings(atIran("2026-10-05T06:00:00Z"));
  settings.seed("quiet_hours_enabled", "1", atIran("2026-10-05T06:00:00Z"));
  settings.seed("quiet_hours_start", "01:00", atIran("2026-10-05T06:00:00Z"));
  settings.seed("quiet_hours_end", "10:32", atIran("2026-10-05T06:00:00Z"));
  let publishes = 0;
  const { service } = makeService({ settings, publish: async () => { publishes += 1; } });
  await service.tick(atIran("2026-10-05T07:03:00Z"));
  assert.equal(publishes, 0);
  await service.tick(atIran("2026-10-05T07:05:00Z"));
  assert.equal(publishes, 1);
});

test("concurrent cron ticks publish a slot only once", async () => {
  const settings = baseSettings(atIran("2026-10-05T08:36:00Z"));
  let publishes = 0;
  let releasePublish;
  const gate = new Promise((resolve) => { releasePublish = resolve; });
  const locks = new MemoryLock();
  const make = () => makeService({
    settings, locks,
    publish: async () => { publishes += 1; await gate; },
  }).service;
  const now = atIran("2026-10-05T08:40:05Z");
  const first = make().tick(now);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = make().tick(now);
  releasePublish();
  await Promise.all([first, second]);
  assert.equal(publishes, 1);
});
