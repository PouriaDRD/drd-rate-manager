import { APP } from "../config/app.js";
import { normalizePublishInterval } from "../utils/automation.js";
import { isInsideQuietHours } from "../utils/datetime.js";
import {
	errorMessage,
	normalizeTimestamp,
	parseBoolean,
	validTime,
} from "../utils/core.js";

/** Automatic publishing settings and scheduled execution. */
export class AutomationService {
	constructor(env, config, settings, market, publisher) {
		Object.assign(this, { env, config, settings, market, publisher });
	}

	async getSettings() {
		const keys = [
			"auto_publish_enabled",
			"publish_interval_minutes",
			"quiet_hours_enabled",
			"quiet_hours_start",
			"quiet_hours_end",
			"auto_publish_last_run_at",
			"auto_publish_last_success_at",
			"auto_publish_last_error",
			"auto_publish_last_tick_at",
			"auto_publish_last_attempt_at",
			"auto_publish_last_error_at",
			"auto_publish_last_skip_reason",
		];
		const map = await this.settings.getMany(keys);
		return {
			enabled: parseBoolean(map.auto_publish_enabled, false),
			intervalMinutes: normalizePublishInterval(map.publish_interval_minutes),
			quietHours: {
				enabled: parseBoolean(map.quiet_hours_enabled, false),
				start: validTime(map.quiet_hours_start)
					? map.quiet_hours_start
					: APP.defaultQuietHours.start,
				end: validTime(map.quiet_hours_end)
					? map.quiet_hours_end
					: APP.defaultQuietHours.end,
			},
			lastRunAt: normalizeTimestamp(map.auto_publish_last_run_at),
			lastSuccessAt: normalizeTimestamp(map.auto_publish_last_success_at),
			lastError: map.auto_publish_last_error || "",
			lastTickAt: normalizeTimestamp(map.auto_publish_last_tick_at),
			lastAttemptAt: normalizeTimestamp(map.auto_publish_last_attempt_at),
			lastErrorAt: normalizeTimestamp(map.auto_publish_last_error_at),
			lastSkipReason: map.auto_publish_last_skip_reason || "",
		};
	}

	async tick() {
		const now = Date.now();
		const map = await this.settings.getMany([
			"bot_enabled",
			"auto_publish_enabled",
			"publish_interval_minutes",
			"quiet_hours_enabled",
			"quiet_hours_start",
			"quiet_hours_end",
			"auto_publish_last_run_at",
			"auto_publish_last_tick_at",
		]);
		const heartbeatDue = now - normalizeTimestamp(map.auto_publish_last_tick_at) >= 5 * 60 * 1000;
		if (heartbeatDue) await this.settings.set("auto_publish_last_tick_at", now);
		if (!parseBoolean(map.bot_enabled, true)) return this.#skip("bot_disabled");
		if (!parseBoolean(map.auto_publish_enabled, false)) return this.#skip("automation_disabled");
		const interval = normalizePublishInterval(map.publish_interval_minutes);
		const quiet = {
			enabled: parseBoolean(map.quiet_hours_enabled, false),
			start: validTime(map.quiet_hours_start) ? map.quiet_hours_start : APP.defaultQuietHours.start,
			end: validTime(map.quiet_hours_end) ? map.quiet_hours_end : APP.defaultQuietHours.end,
		};
		if (quiet.enabled && isInsideQuietHours(this.config, quiet, now)) {
			return this.#skip("quiet_hours");
		}
		const lastRun = normalizeTimestamp(map.auto_publish_last_run_at);
		if (lastRun && now - lastRun < interval * 60 * 1000) {
			return this.#skip("interval_not_due");
		}

		const claimed = await this.#claim(lastRun, now);
		if (!claimed) return this.#skip("already_claimed");
		await this.settings.setMany({
			auto_publish_last_attempt_at: now,
			auto_publish_last_skip_reason: "",
		});
		try {
			const snapshot = await this.market.getSnapshot();
			await this.publisher.publish(snapshot);
			await this.settings.setMany({
				auto_publish_last_success_at: now,
				auto_publish_last_error: "",
				auto_publish_last_error_at: 0,
				auto_publish_last_skip_reason: "success",
			});
		} catch (error) {
			await this.settings.setMany({
				auto_publish_last_error: errorMessage(error).slice(0, 1000),
				auto_publish_last_error_at: now,
				auto_publish_last_skip_reason: "error",
			});
			throw error;
		}
	}

	async #claim(expectedLastRun, now) {
		const result = await this.env.DB.prepare(`UPDATE settings SET value = ?, updated_at = ?
			WHERE key = 'auto_publish_last_run_at' AND value = ?`)
			.bind(String(now), now, String(expectedLastRun || 0))
			.run();
		if (Number(result?.meta?.changes || 0) > 0) return true;
		if (!expectedLastRun) {
			const insert = await this.env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value, created_at, updated_at)
				VALUES ('auto_publish_last_run_at', ?, ?, ?)`)
				.bind(String(now), now, now)
				.run();
			return Number(insert?.meta?.changes || 0) > 0;
		}
		return false;
	}

	async #skip(reason) {
		if (["bot_disabled", "automation_disabled", "quiet_hours"].includes(reason)) {
			await this.settings.set("auto_publish_last_skip_reason", reason);
		}
	}
}
