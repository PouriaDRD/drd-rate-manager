import { APP } from "../config/app.js";
import {
	calculateCurrentPublishSlotAt,
	calculateNextAlignedPublishSlotAt,
	calculateNextPublishAt,
	normalizePublishInterval,
} from "../utils/automation.js";
import { isInsideQuietHours } from "../utils/datetime.js";
import { errorMessage, parseBoolean, validTime } from "../utils/core.js";

const MANUAL_LOCK_KEY = "automation_manual_publish";
const MANUAL_LOCK_TTL_MS = 60_000;

function requireBoolean(value, field) {
	if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
	return value;
}

function optionalActor(actor = {}) {
	return {
		actorType: String(actor.type || "web"),
		actorId: actor.id == null ? null : String(actor.id),
	};
}

export class AutomationManagementService {
	constructor(config, settings, automation, market, publisher, postBuilder, locks, runs) {
		Object.assign(this, {
			config,
			settings,
			automation,
			market,
			publisher,
			postBuilder,
			locks,
			runs,
		});
	}

	async state(now = Date.now(), historyLimit = 20) {
		const [settings, botEnabledRaw, history] = await Promise.all([
			this.automation.getSettings(),
			this.settings.get("bot_enabled", "1"),
			this.history(historyLimit),
		]);
		const botEnabled = parseBoolean(botEnabledRaw, true);
		return {
			botEnabled,
			settings,
			diagnostics: this.diagnostics(settings, botEnabled, now),
			history,
		};
	}

	diagnostics(settings, botEnabled = true, now = Date.now()) {
		const interval = normalizePublishInterval(settings.intervalMinutes);
		const currentSlotAt = calculateCurrentPublishSlotAt(this.config, interval, now);
		const nextAlignedSlotAt = calculateNextAlignedPublishSlotAt(this.config, interval, now);
		const nextPublishAt = calculateNextPublishAt(
			{ ...settings, timezone: this.config.timezone },
			now,
		);
		const anchor = Math.max(
			Number(settings.scheduleChangedAt || 0),
			Number(settings.lastRunAt || 0),
		);
		const insideQuietHours = Boolean(
			settings.quietHours?.enabled &&
			isInsideQuietHours(this.config, settings.quietHours, currentSlotAt),
		);

		let reason = "ready";
		let canPublishNow = true;
		if (!botEnabled) {
			reason = "bot_disabled";
			canPublishNow = false;
		} else if (!settings.enabled) {
			reason = "automation_disabled";
			canPublishNow = false;
		} else if (
			Number(settings.lastSuccessSlotAt || 0) &&
			currentSlotAt <= Number(settings.lastSuccessSlotAt)
		) {
			reason = "already_published";
			canPublishNow = false;
		} else if (currentSlotAt <= anchor) {
			reason = "waiting_for_next_slot";
			canPublishNow = false;
		} else if (insideQuietHours) {
			reason = "quiet_hours";
			canPublishNow = false;
		} else if (
			Number(settings.retrySlotAt || 0) &&
			currentSlotAt === Number(settings.retrySlotAt)
		) {
			reason = "retry_pending";
		}

		return {
			reason,
			canPublishNow,
			insideQuietHours,
			currentSlotAt,
			nextAlignedSlotAt,
			nextPublishAt,
			secondsUntilNext: nextPublishAt
				? Math.max(0, Math.ceil((nextPublishAt - now) / 1000))
				: null,
			retryPending: reason === "retry_pending",
			lastErrorPending: Boolean(settings.lastError && settings.retrySlotAt),
		};
	}

	async updateSettings(input = {}) {
		const values = {};
		if (Object.hasOwn(input, "enabled")) {
			values.auto_publish_enabled = requireBoolean(input.enabled, "enabled") ? "1" : "0";
		}
		if (Object.hasOwn(input, "interval_minutes")) {
			const interval = Number(input.interval_minutes);
			if (!APP.publishIntervals.includes(interval)) {
				throw new Error(`interval_minutes must be one of: ${APP.publishIntervals.join(", ")}.`);
			}
			values.publish_interval_minutes = interval;
		}
		if (Object.hasOwn(input, "quiet_hours")) {
			if (!input.quiet_hours || typeof input.quiet_hours !== "object" || Array.isArray(input.quiet_hours)) {
				throw new Error("quiet_hours must be an object.");
			}
			const quiet = input.quiet_hours;
			if (Object.hasOwn(quiet, "enabled")) {
				values.quiet_hours_enabled = requireBoolean(quiet.enabled, "quiet_hours.enabled") ? "1" : "0";
			}
			if (Object.hasOwn(quiet, "start")) {
				if (!validTime(quiet.start)) throw new Error("quiet_hours.start must use HH:MM.");
				values.quiet_hours_start = quiet.start;
			}
			if (Object.hasOwn(quiet, "end")) {
				if (!validTime(quiet.end)) throw new Error("quiet_hours.end must use HH:MM.");
				values.quiet_hours_end = quiet.end;
			}
		}
		if (!Object.keys(values).length) throw new Error("No automation settings were provided.");
		await this.settings.setMany(values);
		return this.state();
	}

	async dryRun({ actor = {}, refreshMarket = false } = {}) {
		const startedAt = Date.now();
		try {
			const snapshot = await this.market.getSnapshot({ forceRefresh: Boolean(refreshMarket) });
			const rich = this.postBuilder.buildRichMessage(snapshot);
			const fallbackHtml = this.postBuilder.buildFallbackHtml(snapshot);
			await this.#record({
				mode: "dry_run",
				status: "preview",
				reason: "dry_run",
				startedAt,
				finishedAt: Date.now(),
				partial: Boolean(snapshot.partial),
				...optionalActor(actor),
				details: { refreshMarket: Boolean(refreshMarket) },
			});
			return {
				mode: "dry_run",
				partial: Boolean(snapshot.partial),
				generatedAt: Number(snapshot.createdAt || Date.now()),
				rich,
				fallbackHtml,
			};
		} catch (error) {
			await this.#record({
				mode: "dry_run",
				status: "error",
				reason: "error",
				startedAt,
				finishedAt: Date.now(),
				error: errorMessage(error),
				...optionalActor(actor),
			});
			throw error;
		}
	}

	async forceRun({ actor = {}, refreshMarket = false } = {}) {
		const token = await this.locks.acquire(MANUAL_LOCK_KEY, MANUAL_LOCK_TTL_MS);
		if (!token) throw new Error("A manual automation run is already in progress.");
		const startedAt = Date.now();
		try {
			const snapshot = await this.market.getSnapshot({ forceRefresh: Boolean(refreshMarket) });
			const result = await this.publisher.publish(snapshot);
			await this.#record({
				mode: "manual",
				status: "success",
				reason: "forced",
				startedAt,
				finishedAt: Date.now(),
				messageId: result?.message_id ?? null,
				partial: Boolean(snapshot.partial),
				...optionalActor(actor),
				details: { refreshMarket: Boolean(refreshMarket) },
			});
			return {
				mode: "manual",
				messageId: result?.message_id ?? null,
				partial: Boolean(snapshot.partial),
			};
		} catch (error) {
			await this.#record({
				mode: "manual",
				status: "error",
				reason: "error",
				startedAt,
				finishedAt: Date.now(),
				error: errorMessage(error),
				...optionalActor(actor),
			});
			throw error;
		} finally {
			await this.locks.release(MANUAL_LOCK_KEY, token);
		}
	}

	async history(limit = 20) {
		if (!this.runs?.list) return [];
		return this.runs.list(limit);
	}

	async #record(record) {
		if (!this.runs?.add) return;
		try {
			await this.runs.add(record);
		} catch (error) {
			console.warn("automation.history_write_failed", errorMessage(error));
		}
	}
}

export const AUTOMATION_MANUAL_LOCK = Object.freeze({
	key: MANUAL_LOCK_KEY,
	ttlMs: MANUAL_LOCK_TTL_MS,
});
