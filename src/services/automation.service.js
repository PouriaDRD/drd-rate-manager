import { APP } from "../config/app.js";
import {
  calculateCurrentPublishSlotAt,
  calculateNextAlignedPublishSlotAt,
  normalizePublishInterval,
} from "../utils/automation.js";
import { isInsideQuietHours } from "../utils/datetime.js";
import { errorMessage, normalizeTimestamp, parseBoolean, validTime } from "../utils/core.js";

const AUTOMATION_LOCK_KEY = "auto_publish_slot";
const SCHEDULE_SETTING_KEYS = Object.freeze([
  "bot_enabled",
  "auto_publish_enabled",
  "publish_interval_minutes",
  "quiet_hours_enabled",
  "quiet_hours_start",
  "quiet_hours_end",
]);
const AUTOMATION_SETTING_KEYS = Object.freeze([
  ...SCHEDULE_SETTING_KEYS,
  "auto_publish_last_run_at",
  "auto_publish_last_success_at",
  "auto_publish_last_success_slot_at",
  "auto_publish_retry_slot_at",
  "auto_publish_last_error",
  "auto_publish_last_tick_at",
  "auto_publish_last_attempt_at",
  "auto_publish_last_error_at",
  "auto_publish_last_skip_reason",
]);

/** Automatic publishing settings and aligned scheduled execution. */
export class AutomationService {
  constructor(env, config, settings, market, publisher, locks) {
    Object.assign(this, { env, config, settings, market, publisher, locks });
  }

  async getSettings() {
    const rows = await this.#settingsRows(AUTOMATION_SETTING_KEYS);
    const value = (key) => rows[key]?.value;
    return {
      enabled: parseBoolean(value("auto_publish_enabled"), false),
      timezone: this.config.timezone,
      intervalMinutes: normalizePublishInterval(value("publish_interval_minutes")),
      quietHours: {
        enabled: parseBoolean(value("quiet_hours_enabled"), false),
        start: validTime(value("quiet_hours_start"))
          ? value("quiet_hours_start")
          : APP.defaultQuietHours.start,
        end: validTime(value("quiet_hours_end"))
          ? value("quiet_hours_end")
          : APP.defaultQuietHours.end,
      },
      scheduleChangedAt: this.#scheduleChangedAt(rows),
      lastRunAt: normalizeTimestamp(value("auto_publish_last_run_at")),
      lastSuccessAt: normalizeTimestamp(value("auto_publish_last_success_at")),
      lastSuccessSlotAt: normalizeTimestamp(value("auto_publish_last_success_slot_at")),
      retrySlotAt: normalizeTimestamp(value("auto_publish_retry_slot_at")),
      lastError: value("auto_publish_last_error") || "",
      lastTickAt: normalizeTimestamp(value("auto_publish_last_tick_at")),
      lastAttemptAt: normalizeTimestamp(value("auto_publish_last_attempt_at")),
      lastErrorAt: normalizeTimestamp(value("auto_publish_last_error_at")),
      lastSkipReason: value("auto_publish_last_skip_reason") || "",
    };
  }

  async tick(now = Date.now()) {
    const rows = await this.#settingsRows(AUTOMATION_SETTING_KEYS);
    const value = (key) => rows[key]?.value;
    const lastTick = normalizeTimestamp(value("auto_publish_last_tick_at"));
    if (now - lastTick >= 5 * 60 * 1000) {
      await this.settings.set("auto_publish_last_tick_at", now);
    }

    if (!parseBoolean(value("bot_enabled"), true)) return this.#skip("bot_disabled");
    if (!parseBoolean(value("auto_publish_enabled"), false)) {
      return this.#skip("automation_disabled");
    }

    const interval = normalizePublishInterval(value("publish_interval_minutes"));
    const quiet = {
      enabled: parseBoolean(value("quiet_hours_enabled"), false),
      start: validTime(value("quiet_hours_start"))
        ? value("quiet_hours_start")
        : APP.defaultQuietHours.start,
      end: validTime(value("quiet_hours_end"))
        ? value("quiet_hours_end")
        : APP.defaultQuietHours.end,
    };
    const scheduleChangedAt = this.#scheduleChangedAt(rows);
    const lastRun = normalizeTimestamp(value("auto_publish_last_run_at"));
    const lastSuccessSlot = normalizeTimestamp(value("auto_publish_last_success_slot_at"));
    const retrySlot = normalizeTimestamp(value("auto_publish_retry_slot_at"));
    const anchor = Math.max(scheduleChangedAt, lastRun);

    if (!anchor && !lastSuccessSlot && !retrySlot) {
      await this.settings.setMany({
        auto_publish_last_run_at: now,
        auto_publish_last_skip_reason: "waiting_for_next_slot",
      });
      return;
    }

    const slotAt = calculateCurrentPublishSlotAt(this.config, interval, now);
    if (lastSuccessSlot && slotAt <= lastSuccessSlot) return this.#skip("already_published");
    if (slotAt <= anchor) return this.#skip("interval_not_due");
    if (quiet.enabled && isInsideQuietHours(this.config, quiet, slotAt)) {
      return this.#skip("quiet_hours");
    }

    const nextSlotAt = calculateNextAlignedPublishSlotAt(this.config, interval, slotAt);
    const lockTtlMs = Math.max(1000, nextSlotAt - now);
    const token = await this.locks.acquire(AUTOMATION_LOCK_KEY, lockTtlMs);
    if (!token) return this.#skip("already_claimed");

    let successful = false;
    await this.settings.setMany({
      auto_publish_last_attempt_at: now,
      auto_publish_last_skip_reason: "",
    });
    try {
      const snapshot = await this.market.getSnapshot();
      await this.publisher.publish(snapshot);
      successful = true;
      await this.settings.setMany({
        auto_publish_last_run_at: slotAt,
        auto_publish_last_success_at: now,
        auto_publish_last_success_slot_at: slotAt,
        auto_publish_retry_slot_at: 0,
        auto_publish_last_error: "",
        auto_publish_last_error_at: 0,
        auto_publish_last_skip_reason: "success",
      });
    } catch (error) {
      await this.settings.setMany({
        auto_publish_retry_slot_at: slotAt,
        auto_publish_last_error: errorMessage(error).slice(0, 1000),
        auto_publish_last_error_at: now,
        auto_publish_last_skip_reason: "error",
      });
      throw error;
    } finally {
      if (!successful) await this.locks.release(AUTOMATION_LOCK_KEY, token);
    }
  }

  async #settingsRows(keys) {
    if (typeof this.settings.getManyWithMeta === "function") {
      return this.settings.getManyWithMeta(keys);
    }
    if (typeof this.settings.getMany !== "function") {
      throw new Error("Settings repository must implement getManyWithMeta() or getMany().");
    }
    const values = await this.settings.getMany(keys);
    return Object.fromEntries(
      keys.map((key) => [key, { value: values?.[key], updatedAt: 0 }]),
    );
  }

  #scheduleChangedAt(rows) {
    return SCHEDULE_SETTING_KEYS.reduce(
      (latest, key) => Math.max(latest, normalizeTimestamp(rows[key]?.updatedAt)),
      0,
    );
  }

  async #skip(reason) {
    if (["bot_disabled", "automation_disabled", "quiet_hours"].includes(reason)) {
      await this.settings.set("auto_publish_last_skip_reason", reason);
    }
  }
}
