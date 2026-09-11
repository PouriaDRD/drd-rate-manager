/**
 * ============================================================
 * DRD RATE MANAGER
 * Version: 0.10.1
 * Runtime: Cloudflare Workers
 * Database: Cloudflare D1
 *
 * Recommended Cloudflare Cron:
 *
 *     * * * * *
 *
 * ============================================================
 */

const APP = {
	name: "DRD RATE MANAGER",
	displayName: "DRD Rate Manager",
	version: "0.10.2",
	schemaVersion: 6,
	apiVersion: "v1",
};

const USDT_SOURCE_PRIORITY = [
	"wallex",
	"tabdeal",
	"exir",
];

const DEFAULT_COINGECKO_TOP_LIMIT = 20;

const DEFAULT_COINGECKO_ASSETS = [
	"ethereum",
	"solana",
	"ripple",
];

const DEFAULT_PUBLISH_INTERVAL_MINUTES = 10;

const ALLOWED_PUBLISH_INTERVALS = [
	5,
	10,
	15,
	20,
	25,
	30,
	35,
	40,
	45,
	50,
	55,
	60,
];

const QUIET_MINUTE_OPTIONS = [
	0,
	15,
	30,
	45,
];

const DEFAULT_QUIET_HOURS = {
	enabled: false,
	start: "01:00",
	end: "10:30",
};

const ADMIN_INPUT_TTL_MS =
	10 * 60 * 1000;

const COIN_NAMES_FA = {
	bitcoin: "بیت‌کوین",
	ethereum: "اتریوم",
	tether: "تتر",
	binancecoin: "بایننس‌کوین",
	ripple: "ریپل",
	solana: "سولانا",
	"usd-coin": "یو‌اس‌دی کوین",
	dogecoin: "دوج‌کوین",
	cardano: "کاردانو",
	tron: "ترون",
	"staked-ether": "اتریوم استیک‌شده",
	chainlink: "چین‌لینک",
	avalanche: "آوالانچ",
	stellar: "استلار",
	"shiba-inu": "شیبا اینو",
	sui: "سویی",
	toncoin: "تون‌کوین",
	polkadot: "پولکادات",
	litecoin: "لایت‌کوین",
	"bitcoin-cash": "بیت‌کوین کش",
	hedera: "هدرا",
	hyperliquid: "هایپرلیکویید",
	"leo-token": "لئو",
	monero: "مونرو",
	pepe: "پپه",
	uniswap: "یونی‌سواپ",
	aave: "آوه",
	aptos: "آپتوس",
	near: "نیر",
	"internet-computer": "اینترنت کامپیوتر",
	"crypto-com-chain": "کرونوس",
	vechain: "وی‌چین",
	"matic-network": "پالیگان",
	"wrapped-bitcoin": "بیت‌کوین رپد",
	"wrapped-steth": "اتریوم رپد استیک‌شده",
	dai: "دای",
	"ethena-usde": "یو‌اس‌دی‌ای اتنا",
	whitebit: "وایت‌بیت",
	okb: "اوکی‌بی",
	mantle: "منتل",
	bittensor: "بیت‌تنسور",
	"render-token": "رندر",
	filecoin: "فایل‌کوین",
	cosmos: "کازمس",
	arbitrum: "آربیتروم",
	optimism: "آپتیمیزم",
	"injective-protocol": "اینجکتیو",
};

/* ============================================================
 * WORKER
 * ============================================================
 */

export default {
	async fetch(request, env, ctx) {
		try {
			await ensureDatabase(env);

			const url =
				new URL(request.url);

			if (
				request.method ===
				"OPTIONS"
			) {
				return corsResponse();
			}

			if (
				request.method === "GET" &&
				url.pathname === "/"
			) {
				return handleRootApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/market"
			) {
				return handleMarketApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/assets"
			) {
				return handleAssetsApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/sources"
			) {
				return handleSourcesApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/sources/usdt"
			) {
				return handleUsdtApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/automation"
			) {
				return handleAutomationApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/system"
			) {
				return handleSystemApi(env);
			}

			if (
				request.method === "GET" &&
				url.pathname ===
					"/api/v1/system/database"
			) {
				return handleDatabaseApi(env);
			}

			if (
				request.method === "POST" &&
				url.pathname ===
					"/telegram/webhook"
			) {
				return handleTelegramWebhook(
					request,
					env,
					ctx,
				);
			}

			return jsonResponse(
				{
					success: false,
					message: "Not found",
				},
				404,
			);
		} catch (error) {
			console.error(
				"http.unhandled_error",
				{
					message:
						errorMessage(error),

					stack:
						error?.stack ??
						null,
				},
			);

			return jsonResponse(
				{
					success: false,

					message:
						"Internal server error",

					error:
						errorMessage(error),
				},
				500,
			);
		}
	},

	async scheduled(
		controller,
		env,
		ctx,
	) {
		ctx.waitUntil(
			handleScheduledTick(
				controller,
				env,
			),
		);
	},
};

/* ============================================================
 * DATABASE
 * ============================================================
 */

async function ensureDatabase(env) {
	if (!env.DB) {
		throw new Error(
			'D1 binding "DB" is not configured.',
		);
	}

	await env.DB.batch([
		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS app_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				created_at INTEGER NOT NULL DEFAULT 0,
				updated_at INTEGER NOT NULL
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS admins (
				user_id TEXT PRIMARY KEY,
				username TEXT,
				first_name TEXT,
				last_name TEXT,
				is_active INTEGER NOT NULL DEFAULT 1,
				added_by TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL DEFAULT 0
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS source_status (
				source TEXT PRIMARY KEY,
				success INTEGER NOT NULL DEFAULT 0,
				status_code INTEGER,
				latency_ms INTEGER,
				message TEXT,
				last_price REAL,
				last_checked_at INTEGER NOT NULL
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS admin_input_state (
				telegram_user_id TEXT PRIMARY KEY,
				action TEXT NOT NULL,
				payload TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS audit_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				telegram_user_id TEXT,
				action TEXT NOT NULL,
				data TEXT,
				created_at INTEGER NOT NULL
			)
		`),

		env.DB.prepare(`
			CREATE TABLE IF NOT EXISTS coingecko_assets (
				coin_id TEXT PRIMARY KEY,
				symbol TEXT NOT NULL,
				name TEXT NOT NULL,
				is_enabled INTEGER NOT NULL DEFAULT 0,
				market_cap_rank INTEGER,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`),
	]);

	await repairLegacySchema(env);
	await migrateLegacySettings(env);
	await ensureDefaultSettings(env);
	await initializeDefaultCoinGeckoAssets(env);

	await setAppMeta(
		env,
		"schema_version",
		String(
			APP.schemaVersion,
		),
	);
}

async function repairLegacySchema(
	env,
) {
	await ensureColumn(
		env,
		"settings",
		"created_at",
		"INTEGER NOT NULL DEFAULT 0",
	);

	await ensureColumn(
		env,
		"admins",
		"username",
		"TEXT",
	);

	await ensureColumn(
		env,
		"admins",
		"first_name",
		"TEXT",
	);

	await ensureColumn(
		env,
		"admins",
		"last_name",
		"TEXT",
	);

	await ensureColumn(
		env,
		"admins",
		"is_active",
		"INTEGER NOT NULL DEFAULT 1",
	);

	await ensureColumn(
		env,
		"admins",
		"updated_at",
		"INTEGER NOT NULL DEFAULT 0",
	);

	await env.DB
		.prepare(`
			UPDATE settings
			SET created_at =
				CASE
					WHEN created_at IS NULL
						OR created_at = 0
					THEN updated_at
					ELSE created_at
				END
		`)
		.run();

	await env.DB
		.prepare(`
			UPDATE admins
			SET updated_at =
				CASE
					WHEN updated_at IS NULL
						OR updated_at = 0
					THEN created_at
					ELSE updated_at
				END
		`)
		.run();

	await env.DB
		.prepare(`
			UPDATE admins
			SET is_active = 1
			WHERE is_active IS NULL
		`)
		.run();
}

async function ensureColumn(
	env,
	table,
	column,
	definition,
) {
	const allowedTables = [
		"settings",
		"admins",
	];

	if (
		!allowedTables.includes(table)
	) {
		throw new Error(
			`Invalid migration table: ${table}`,
		);
	}

	const schema =
		await env.DB
			.prepare(
				`PRAGMA table_info("${table}")`,
			)
			.all();

	const exists =
		(
			schema.results ??
			[]
		).some(
			(item) =>
				String(item.name) ===
				column,
		);

	if (exists) {
		return;
	}

	await env.DB
		.prepare(
			`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`,
		)
		.run();
}

async function migrateLegacySettings(
	env,
) {
	const current =
		await getSetting(
			env,
			"bot_enabled",
			null,
		);

	if (current !== null) {
		return;
	}

	const legacy =
		await getSetting(
			env,
			"global_enabled",
			null,
		);

	if (legacy === null) {
		return;
	}

	await setSetting(
		env,
		"bot_enabled",
		parseBoolean(legacy)
			? "true"
			: "false",
	);
}

async function ensureDefaultSettings(
	env,
) {
	const defaults = {
		bot_enabled:
			"true",

		auto_publish_enabled:
			"false",

		publish_interval_minutes:
			String(
				DEFAULT_PUBLISH_INTERVAL_MINUTES,
			),

		quiet_hours_enabled:
			DEFAULT_QUIET_HOURS.enabled
				? "true"
				: "false",

		quiet_hours_start:
			DEFAULT_QUIET_HOURS.start,

		quiet_hours_end:
			DEFAULT_QUIET_HOURS.end,

		auto_publish_last_run_at:
			"0",

		auto_publish_last_success_at:
			"0",

		auto_publish_last_error:
			"",
	};

	for (
		const [key, value]
		of Object.entries(defaults)
	) {
		await ensureDefaultSetting(
			env,
			key,
			value,
		);
	}
}

async function setAppMeta(
	env,
	key,
	value,
) {
	await env.DB
		.prepare(`
			INSERT INTO app_meta (
				key,
				value,
				updated_at
			)

			VALUES (?, ?, ?)

			ON CONFLICT(key)
			DO UPDATE SET
				value = excluded.value,
				updated_at = excluded.updated_at
		`)
		.bind(
			key,
			String(value),
			Date.now(),
		)
		.run();
}

async function ensureDefaultSetting(
	env,
	key,
	value,
) {
	const existing =
		await env.DB
			.prepare(`
				SELECT key
				FROM settings
				WHERE key = ?
				LIMIT 1
			`)
			.bind(key)
			.first();

	if (existing) {
		return;
	}

	const now =
		Date.now();

	await env.DB
		.prepare(`
			INSERT INTO settings (
				key,
				value,
				created_at,
				updated_at
			)

			VALUES (?, ?, ?, ?)
		`)
		.bind(
			key,
			String(value),
			now,
			now,
		)
		.run();
}

async function getSetting(
	env,
	key,
	fallback = null,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT value
				FROM settings
				WHERE key = ?
				LIMIT 1
			`)
			.bind(key)
			.first();

	return (
		result?.value ??
		fallback
	);
}

async function setSetting(
	env,
	key,
	value,
) {
	const now =
		Date.now();

	await env.DB
		.prepare(`
			INSERT INTO settings (
				key,
				value,
				created_at,
				updated_at
			)

			VALUES (?, ?, ?, ?)

			ON CONFLICT(key)
			DO UPDATE SET
				value = excluded.value,
				updated_at = excluded.updated_at
		`)
		.bind(
			key,
			String(value),
			now,
			now,
		)
		.run();
}

async function setSettings(
	env,
	values,
) {
	const now =
		Date.now();

	const statements =
		Object.entries(values).map(
			([key, value]) =>
				env.DB
					.prepare(`
						INSERT INTO settings (
							key,
							value,
							created_at,
							updated_at
						)

						VALUES (?, ?, ?, ?)

						ON CONFLICT(key)
						DO UPDATE SET
							value = excluded.value,
							updated_at = excluded.updated_at
					`)
					.bind(
						key,
						String(value),
						now,
						now,
					),
		);

	if (statements.length) {
		await env.DB.batch(
			statements,
		);
	}
}

/* ============================================================
 * GLOBAL STATE
 * ============================================================
 */

async function getGlobalEnabled(
	env,
) {
	return parseBoolean(
		await getSetting(
			env,
			"bot_enabled",
			"true",
		),
	);
}

async function setGlobalEnabled(
	env,
	enabled,
) {
	await setSetting(
		env,
		"bot_enabled",
		enabled
			? "true"
			: "false",
	);
}

/* ============================================================
 * TELEGRAM COMMANDS / MENU BUTTON
 * ============================================================
 */

async function syncTelegramInterface(
	env,
	chatId = null,
) {
	try {
		await telegramApi(
			env,
			"setMyCommands",
			{
				commands: [
					{
						command:
							"start",

						description:
							"شروع و ورود به پنل",
					},

					{
						command:
							"menu",

						description:
							"نمایش پنل مدیریت",
					},

					{
						command:
							"help",

						description:
							"راهنمای کامل ربات",
					},

					{
						command:
							"id",

						description:
							"نمایش شناسه تلگرام",
					},
				],
			},
		);

		await telegramApi(
			env,
			"setChatMenuButton",
			{
				...(chatId
					? {
						chat_id:
							chatId,
					}
					: {}),

				menu_button: {
					type:
						"commands",
				},
			},
		);
	} catch (error) {
		console.error(
			"telegram.ui_sync.error",
			errorMessage(error),
		);
	}
}

/* ============================================================
 * WEBHOOK
 * ============================================================
 */

async function handleTelegramWebhook(
	request,
	env,
	ctx,
) {
	if (
		!verifyTelegramWebhook(
			request,
			env,
		)
	) {
		return jsonResponse(
			{
				success: false,
				message:
					"Unauthorized webhook",
			},
			401,
		);
	}

	let update;

	try {
		update =
			await request.json();
	} catch {
		return jsonResponse(
			{
				success: false,
				message:
					"Invalid JSON",
			},
			400,
		);
	}

	ctx.waitUntil(
		processTelegramUpdate(
			update,
			env,
		),
	);

	return jsonResponse({
		success: true,
	});
}

function verifyTelegramWebhook(
	request,
	env,
) {
	const expected =
		String(
			env.TELEGRAM_WEBHOOK_SECRET ??
				"",
		);

	const received =
		request.headers.get(
			"X-Telegram-Bot-Api-Secret-Token",
		);

	return (
		Boolean(expected) &&
		received === expected
	);
}

async function processTelegramUpdate(
	update,
	env,
) {
	try {
		if (update.message) {
			await handleTelegramMessage(
				update.message,
				env,
			);

			return;
		}

		if (
			update.callback_query
		) {
			await handleCallbackQuery(
				update.callback_query,
				env,
			);
		}
	} catch (error) {
		console.error(
			"telegram.update.error",
			{
				message:
					errorMessage(error),

				stack:
					error?.stack ??
						null,
			},
		);
	}
}

/* ============================================================
 * MESSAGE HANDLER
 * ============================================================
 */

async function handleTelegramMessage(
	message,
	env,
) {
	const user =
		message.from;

	const chatId =
		message.chat?.id;

	const text =
		message.text?.trim();

	if (
		!user ||
		!chatId
	) {
		return;
	}

	if (
		text &&
		text.startsWith("/")
	) {
		const command =
			normalizeCommand(text);

		if (
			![
				"/start",
				"/menu",
				"/help",
				"/id",
			].includes(command)
		) {
			return;
		}
	}

	const admin =
		await resolveAdmin(
			env,
			user,
		);

	if (!admin) {
		await sendAccessDenied(
			env,
			chatId,
		);

		return;
	}

	if (
		admin.role === "admin"
	) {
		await updateAdminProfile(
			env,
			user,
		);
	}

	if (
		text &&
		!text.startsWith("/")
	) {
		const state =
			await getAdminInputState(
				env,
				user.id,
			);

		if (
			state?.action ===
			"add_admin"
		) {
			await handleAddAdminInput(
				env,
				message,
				admin,
				state,
			);
		}

		return;
	}

	if (!text) {
		return;
	}

	const command =
		normalizeCommand(text);

	if (
		[
			"/start",
			"/menu",
			"/help",
		].includes(command)
	) {
		await syncTelegramInterface(
			env,
			chatId,
		);
	}

	const enabled =
		await getGlobalEnabled(
			env,
		);

	if (!enabled) {
		await sendDisabledScreen(
			env,
			chatId,
			admin,
		);

		return;
	}

	if (
		command === "/start"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await sendStartScreen(
			env,
			chatId,
			user,
			admin,
		);

		return;
	}

	if (
		command === "/menu"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await sendMainMenu(
			env,
			chatId,
			admin,
		);

		return;
	}

	if (
		command === "/help"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await sendHelpMessage(
			env,
			chatId,
			admin,
		);

		return;
	}

	if (
		command === "/id"
	) {
		await sendIdMessage(
			env,
			chatId,
			user,
			admin,
		);
	}
}

/* ============================================================
 * CALLBACKS
 * ============================================================
 */

async function handleCallbackQuery(
	query,
	env,
) {
	const user =
		query.from;

	const message =
		query.message;

	if (
		!user ||
		!message
	) {
		return;
	}

	const admin =
		await resolveAdmin(
			env,
			user,
		);

	if (!admin) {
		await safeAnswerCallbackQuery(
			env,
			query.id,
			"دسترسی شما غیرفعال است.",
			true,
		);

		return;
	}

	const data =
		String(
			query.data ??
				"",
		);

	const enabled =
		await getGlobalEnabled(
			env,
		);

	if (!enabled) {
		if (
			data !==
			"global:enable"
		) {
			await safeAnswerCallbackQuery(
				env,
				query.id,
				"ربات غیرفعال است.",
			);

			await showDisabledScreen(
				env,
				message,
				admin,
			);

			return;
		}

		if (
			admin.role !==
			"owner"
		) {
			await safeAnswerCallbackQuery(
				env,
				query.id,
				"فقط مالک اجازه فعال کردن ربات را دارد.",
				true,
			);

			return;
		}

		await setGlobalEnabled(
			env,
			true,
		);

		await addAuditLog(
			env,
			user.id,
			"global.enabled",
		);

		await safeAnswerCallbackQuery(
			env,
			query.id,
			"ربات فعال شد.",
		);

		await showSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		isOwnerOnlyCallback(data) &&
		admin.role !== "owner"
	) {
		await safeAnswerCallbackQuery(
			env,
			query.id,
			"این عملیات فقط برای مالک در دسترس است.",
			true,
		);

		return;
	}

	await safeAnswerCallbackQuery(
		env,
		query.id,
	);

	if (
		data === "menu:home"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await showMainMenu(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "help:home"
	) {
		await showHelpMessage(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "market:home" ||
		data === "market:refresh"
	) {
		await showMarketManager(
			env,
			message,
		);

		return;
	}

	if (
		data === "market:preview"
	) {
		await showMarketPreview(
			env,
			message,
		);

		return;
	}

	if (
		data === "market:publish"
	) {
		await publishMarketNow(
			env,
			message,
			user,
		);

		return;
	}

	if (
		data === "sources:home" ||
		data === "sources:refresh"
	) {
		await showSourceManager(
			env,
			message,
		);

		return;
	}

	if (
		data === "sources:usdt"
	) {
		await showUsdtRoute(
			env,
			message,
		);

		return;
	}

	if (
		data === "coingecko:home" ||
		data === "coingecko:refresh"
	) {
		await showCoinGeckoManager(
			env,
			message,
		);

		return;
	}

	if (
		data.startsWith(
			"coingecko:toggle:",
		)
	) {
		const coinId =
			data.substring(
				"coingecko:toggle:"
					.length,
			);

		await toggleCoinGeckoAsset(
			env,
			coinId,
		);

		await showCoinGeckoManager(
			env,
			message,
		);

		return;
	}

	if (
		data === "settings:home"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await showSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "global:disable"
	) {
		await setGlobalEnabled(
			env,
			false,
		);

		await addAuditLog(
			env,
			user.id,
			"global.disabled",
		);

		await showDisabledScreen(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "automation:home" ||
		data === "automation:refresh"
	) {
		await showAutomationSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "automation:toggle"
	) {
		const automation =
			await getAutomationSettings(
				env,
			);

		const next =
			!automation.enabled;

		await setAutoPublishEnabled(
			env,
			next,
		);

		if (next) {
			await setSetting(
				env,
				"auto_publish_last_run_at",
				"0",
			);
		}

		await addAuditLog(
			env,
			user.id,
			next
				? "automation.enabled"
				: "automation.disabled",
		);

		await showAutomationSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "automation:interval"
	) {
		await showIntervalSettings(
			env,
			message,
		);

		return;
	}

	if (
		data.startsWith(
			"automation:interval:set:",
		)
	) {
		const minutes =
			Number(
				data.substring(
					"automation:interval:set:"
						.length,
				),
			);

		const normalized =
			await setPublishInterval(
				env,
				minutes,
			);

		await addAuditLog(
			env,
			user.id,
			"automation.interval_changed",
			{
				minutes:
					normalized,
			},
		);

		await showIntervalSettings(
			env,
			message,
		);

		return;
	}

	if (
		data === "automation:quiet"
	) {
		await showQuietHoursSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data ===
		"automation:quiet:toggle"
	) {
		const automation =
			await getAutomationSettings(
				env,
			);

		const next =
			!automation
				.quietHours
				.enabled;

		await setQuietHoursEnabled(
			env,
			next,
		);

		await addAuditLog(
			env,
			user.id,
			"automation.quiet_hours_toggled",
			{
				enabled:
					next,
			},
		);

		await showQuietHoursSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data ===
		"automation:quiet:edit"
	) {
		await showQuietStartHourSelector(
			env,
			message,
		);

		return;
	}

	if (
		data.startsWith(
			"quiet:start_hour:",
		)
	) {
		const hour =
			Number(
				data.substring(
					"quiet:start_hour:"
						.length,
				),
			);

		await showQuietStartMinuteSelector(
			env,
			message,
			hour,
		);

		return;
	}

	if (
		data.startsWith(
			"quiet:start_minute:",
		)
	) {
		const parts =
			data.split(":");

		const hour =
			Number(parts[2]);

		const minute =
			Number(parts[3]);

		await showQuietEndHourSelector(
			env,
			message,
			hour,
			minute,
		);

		return;
	}

	if (
		data.startsWith(
			"quiet:end_hour:",
		)
	) {
		const parts =
			data.split(":");

		const startHour =
			Number(parts[2]);

		const startMinute =
			Number(parts[3]);

		const endHour =
			Number(parts[4]);

		await showQuietEndMinuteSelector(
			env,
			message,
			startHour,
			startMinute,
			endHour,
		);

		return;
	}

	if (
		data.startsWith(
			"quiet:end_minute:",
		)
	) {
		const parts =
			data.split(":");

		const startHour =
			Number(parts[2]);

		const startMinute =
			Number(parts[3]);

		const endHour =
			Number(parts[4]);

		const endMinute =
			Number(parts[5]);

		const start =
			buildTimeString(
				startHour,
				startMinute,
			);

		const end =
			buildTimeString(
				endHour,
				endMinute,
			);

		if (start === end) {
			await showQuietEndMinuteSelector(
				env,
				message,
				startHour,
				startMinute,
				endHour,
				"زمان شروع و پایان نمی‌توانند یکسان باشند.",
			);

			return;
		}

		await setQuietHoursRange(
			env,
			start,
			end,
		);

		await addAuditLog(
			env,
			user.id,
			"automation.quiet_hours_changed",
			{
				start,
				end,
			},
		);

		await showQuietHoursSettings(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "system:home" ||
		data === "system:refresh"
	) {
		await showSystemStatus(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "database:home" ||
		data === "database:refresh"
	) {
		await showDatabaseMonitor(
			env,
			message,
		);

		return;
	}

	if (
		data === "admins:home" ||
		data === "admins:refresh"
	) {
		await clearAdminInputState(
			env,
			user.id,
		);

		await showAdmins(
			env,
			message,
			admin,
		);

		return;
	}

	if (
		data === "admins:add"
	) {
		await beginAddAdmin(
			env,
			message,
			user.id,
		);

		return;
	}

	if (
		data.startsWith(
			"admin:view:",
		)
	) {
		await showAdminDetails(
			env,
			message,
			admin,
			data.substring(
				"admin:view:"
					.length,
			),
		);

		return;
	}

	if (
		data.startsWith(
			"admin:toggle:",
		)
	) {
		const targetId =
			data.substring(
				"admin:toggle:"
					.length,
			);

		await toggleAdminActive(
			env,
			targetId,
			user.id,
		);

		await showAdminDetails(
			env,
			message,
			admin,
			targetId,
		);

		return;
	}

	if (
		data.startsWith(
			"admin:delete_confirm:",
		)
	) {
		await showDeleteAdminConfirmation(
			env,
			message,
			data.substring(
				"admin:delete_confirm:"
					.length,
			),
		);

		return;
	}

	if (
		data.startsWith(
			"admin:delete:",
		)
	) {
		const targetId =
			data.substring(
				"admin:delete:"
					.length,
			);

		await deleteAdmin(
			env,
			targetId,
		);

		await addAuditLog(
			env,
			user.id,
			"admin.deleted",
			{
				targetId,
			},
		);

		await showAdmins(
			env,
			message,
			admin,
		);
	}
}

function isOwnerOnlyCallback(
	data,
) {
	return (
		data ===
			"global:disable" ||

		data ===
			"automation:toggle" ||

		data.startsWith(
			"automation:interval:set:",
		) ||

		data ===
			"automation:quiet:toggle" ||

		data ===
			"automation:quiet:edit" ||

		data.startsWith(
			"quiet:",
		) ||

		data ===
			"admins:add" ||

		data.startsWith(
			"admin:toggle:",
		) ||

		data.startsWith(
			"admin:delete_confirm:",
		) ||

		data.startsWith(
			"admin:delete:",
		)
	);
}

/* ============================================================
 * AUTH
 * ============================================================
 */

function getOwnerId(env) {
	return String(
		env.TELEGRAM_OWNER_ID ??
			"",
	).trim();
}

function isOwner(
	env,
	userId,
) {
	return (
		Boolean(
			getOwnerId(env),
		) &&
		String(userId) ===
			getOwnerId(env)
	);
}

async function resolveAdmin(
	env,
	user,
) {
	if (
		isOwner(
			env,
			user.id,
		)
	) {
		return {
			user_id:
				String(user.id),

			role:
				"owner",

			is_active:
				1,

			username:
				user.username ??
					null,

			first_name:
				user.first_name ??
					null,

			last_name:
				user.last_name ??
					null,
		};
	}

	const admin =
		await env.DB
			.prepare(`
				SELECT *
				FROM admins
				WHERE user_id = ?
				LIMIT 1
			`)
			.bind(
				String(user.id),
			)
			.first();

	if (
		!admin ||
		Number(
			admin.is_active,
		) !== 1
	) {
		return null;
	}

	return {
		...admin,
		role:
			"admin",
	};
}

async function updateAdminProfile(
	env,
	user,
) {
	await env.DB
		.prepare(`
			UPDATE admins
			SET
				username = ?,
				first_name = ?,
				last_name = ?,
				updated_at = ?
			WHERE user_id = ?
		`)
		.bind(
			user.username ??
				null,

			user.first_name ??
				null,

			user.last_name ??
				null,

			Date.now(),

			String(user.id),
		)
		.run();
}

function getRoleLabel(
	admin,
) {
	return (
		admin.role ===
			"owner"
			? "مالک"
			: "ادمین"
	);
}

/* ============================================================
 * START / MENU / HELP / ID
 * ============================================================
 */

function getBotDisplayName(
	env,
) {
	return String(
		env.BOT_DISPLAY_NAME ??
			APP.displayName,
	).trim();
}

async function sendStartScreen(
	env,
	chatId,
	user,
	admin,
) {
	const firstName =
		user.first_name ||
		admin.first_name ||
		"کاربر";

	await sendTelegramMessage(
		env,
		chatId,
		[
			`<b>🚀 ${escapeHtml(
				getBotDisplayName(env),
			)}</b>`,

			`سلام <b>${escapeHtml(
				firstName,
			)}</b> 👋`,

			"",

			"<blockquote>" +
				`🔐 دسترسی: ${escapeHtml(
					getRoleLabel(admin),
				)}` +
				"\n" +
				"🟢 سیستم آماده است" +
				"</blockquote>",

			"",

			buildNote(
				"از دکمه ورود به پنل یا Menu کنار کادر پیام برای مدیریت ربات استفاده کن.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"⚡️ ورود به پنل",

						callback_data:
							"menu:home",
					},
				],

				[
					{
						text:
							"❓ راهنما",

						callback_data:
							"help:home",
					},
				],
			],
		},
	);
}

function buildMainMenuText(
	env,
	admin,
) {
	const now =
		Date.now();

	return [
		"<b>⚡️ پنل مدیریت</b>",
		"",
		"<blockquote>" +
			`🔐 دسترسی: ${escapeHtml(
				getRoleLabel(admin),
			)}` +
			"\n" +
			"🟢 ربات فعال" +
			"</blockquote>",
		"",
		`📅 تاریخ: <b>${escapeHtml(
			formatIranDate(
				env,
				now,
			),
		)}</b>`,
		`🕒 ساعت: <b>${escapeHtml(
			formatIranTime(
				env,
				now,
			),
		)}</b>`,
		`🌐 منطقه زمانی: <code>${escapeHtml(
			getTimezone(env),
		)}</code>`,
		"",
		buildNote(
			"از این صفحه به مدیریت بازار، منابع، ادمین‌ها و تنظیمات سیستم دسترسی داری.",
		),
		"",
		`<code>v${escapeHtml(
			getVersion(env),
		)}</code>`,
	].join("\n");
}

function mainMenuKeyboard() {
	return {
		inline_keyboard: [
			[
				{
					text:
						"📈 مدیریت بازار",

					callback_data:
						"market:home",
				},
			],

			[
				{
					text:
						"📡 مدیریت منابع",

					callback_data:
						"sources:home",
				},

				{
					text:
						"👥 مدیریت ادمین‌ها",

					callback_data:
						"admins:home",
				},
			],

			[
				{
					text:
						"⚙️ تنظیمات",

					callback_data:
						"settings:home",
				},

				{
					text:
						"❓ راهنما",

					callback_data:
						"help:home",
				},
			],
		],
	};
}

async function sendMainMenu(
	env,
	chatId,
	admin,
) {
	await sendTelegramMessage(
		env,
		chatId,
		buildMainMenuText(
			env,
			admin,
		),
		mainMenuKeyboard(),
	);
}

async function showMainMenu(
	env,
	message,
	admin,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		buildMainMenuText(
			env,
			admin,
		),
		mainMenuKeyboard(),
	);
}

function buildHelpText(
	env,
	admin,
) {
	return [
		"<b>❓ راهنمای DRD Rate Manager</b>",
		"",
		"<blockquote>این ربات برای دریافت، بررسی و انتشار نرخ‌های بازار در DRD Rate ساخته شده است.</blockquote>",
		"",
		"<b>⌨️ دستورات</b>",
		"",
		"<code>/start</code> — شروع ربات",
		"<code>/menu</code> — پنل مدیریت",
		"<code>/help</code> — نمایش این راهنما",
		"<code>/id</code> — شناسه تلگرام شما",
		"",
		"<b>📈 مدیریت بازار</b>",
		"نمایش قیمت تتر، رمزارزها، طلای 18 عیار، مظنه، انس طلا و نقره.",
		"",
		"<b>📡 مدیریت منابع</b>",
		"بررسی سلامت منابع قیمت و مسیر دریافت تتر.",
		"",
		"<b>🪙 CoinGecko</b>",
		"فعال یا غیرفعال کردن رمزارزهای موردنظر برای انتشار.",
		"",
		"<b>🤖 انتشار خودکار</b>",
		"بازه انتشار بین 5 تا 60 دقیقه با گام 5 دقیقه‌ای قابل انتخاب است.",
		"",
		"<b>🌙 ساعت استراحت</b>",
		"در بازه انتخاب‌شده انتشار خودکار متوقف می‌شود.",
		"",
		"<b>🗄 دیتابیس</b>",
		"سلامت D1، تعداد رکوردها و میزان فضای مصرف‌شده را نمایش می‌دهد.",
		"",
		"<b>👥 ادمین‌ها</b>",
		"مالک می‌تواند ادمین اضافه، فعال، غیرفعال یا حذف کند.",
		"",
		"<b>📊 API عمومی</b>",
		"<code>GET /api/v1/market</code>",
		"<code>GET /api/v1/assets</code>",
		"<code>GET /api/v1/sources</code>",
		"<code>GET /api/v1/sources/usdt</code>",
		"<code>GET /api/v1/automation</code>",
		"<code>GET /api/v1/system</code>",
		"<code>GET /api/v1/system/database</code>",
		"",
		buildNote(
			"Menu کنار کادر پیام، لیست دستورات ربات را باز می‌کند.",
		),
		"",
		`🔐 دسترسی: <b>${escapeHtml(
			getRoleLabel(admin),
		)}</b>`,
		`🌐 Timezone: <code>${escapeHtml(
			getTimezone(env),
		)}</code>`,
		`⚙️ Version: <code>${escapeHtml(
			getVersion(env),
		)}</code>`,
	].join("\n");
}

async function sendHelpMessage(
	env,
	chatId,
	admin,
) {
	await sendTelegramMessage(
		env,
		chatId,
		buildHelpText(
			env,
			admin,
		),
		{
			inline_keyboard: [
				[
					{
						text:
							"⚡️ پنل مدیریت",

						callback_data:
							"menu:home",
					},
				],
			],
		},
	);
}

async function showHelpMessage(
	env,
	message,
	admin,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		buildHelpText(
			env,
			admin,
		),
		{
			inline_keyboard: [
				[
					{
						text:
							"⬅️ پنل مدیریت",

						callback_data:
							"menu:home",
					},
				],
			],
		},
	);
}

async function sendIdMessage(
	env,
	chatId,
	user,
	admin,
) {
	await sendTelegramMessage(
		env,
		chatId,
		[
			"<b>🆔 اطلاعات حساب</b>",
			"",
			`شناسه تلگرام: <code>${escapeHtml(
				user.id,
			)}</code>`,
			"",
			`🔐 دسترسی: <b>${escapeHtml(
				getRoleLabel(admin),
			)}</b>`,
			"",
			buildNote(
				"برای افزودن ادمین جدید، مالک باید Telegram User ID او را وارد کند.",
			),
		].join("\n"),
	);
}

/* ============================================================
 * AUTOMATION
 * ============================================================
 */

async function getAutomationSettings(
	env,
) {
	const [
		autoEnabled,
		interval,
		quietEnabled,
		quietStart,
		quietEnd,
		lastRun,
		lastSuccess,
		lastError,
	] = await Promise.all([
		getSetting(
			env,
			"auto_publish_enabled",
			"false",
		),

		getSetting(
			env,
			"publish_interval_minutes",
			String(
				DEFAULT_PUBLISH_INTERVAL_MINUTES,
			),
		),

		getSetting(
			env,
			"quiet_hours_enabled",
			"false",
		),

		getSetting(
			env,
			"quiet_hours_start",
			DEFAULT_QUIET_HOURS.start,
		),

		getSetting(
			env,
			"quiet_hours_end",
			DEFAULT_QUIET_HOURS.end,
		),

		getSetting(
			env,
			"auto_publish_last_run_at",
			"0",
		),

		getSetting(
			env,
			"auto_publish_last_success_at",
			"0",
		),

		getSetting(
			env,
			"auto_publish_last_error",
			"",
		),
	]);

	return {
		enabled:
			parseBoolean(
				autoEnabled,
			),

		intervalMinutes:
			normalizePublishInterval(
				interval,
			),

		quietHours: {
			enabled:
				parseBoolean(
					quietEnabled,
				),

			start:
				isValidTimeString(
					quietStart,
				)
					? quietStart
					: DEFAULT_QUIET_HOURS.start,

			end:
				isValidTimeString(
					quietEnd,
				)
					? quietEnd
					: DEFAULT_QUIET_HOURS.end,
		},

		lastRunAt:
			normalizeTimestamp(
				lastRun,
			),

		lastSuccessAt:
			normalizeTimestamp(
				lastSuccess,
			),

		lastError:
			String(
				lastError ??
					"",
			),
	};
}

async function setAutoPublishEnabled(
	env,
	enabled,
) {
	await setSetting(
		env,
		"auto_publish_enabled",
		enabled
			? "true"
			: "false",
	);
}

async function setPublishInterval(
	env,
	minutes,
) {
	const normalized =
		normalizePublishInterval(
			minutes,
		);

	await setSetting(
		env,
		"publish_interval_minutes",
		String(
			normalized,
		),
	);

	return normalized;
}

function normalizePublishInterval(
	value,
) {
	const numeric =
		Number(value);

	if (
		ALLOWED_PUBLISH_INTERVALS.includes(
			numeric,
		)
	) {
		return numeric;
	}

	return DEFAULT_PUBLISH_INTERVAL_MINUTES;
}

async function setQuietHoursEnabled(
	env,
	enabled,
) {
	await setSetting(
		env,
		"quiet_hours_enabled",
		enabled
			? "true"
			: "false",
	);
}

async function setQuietHoursRange(
	env,
	start,
	end,
) {
	if (
		!isValidTimeString(start) ||
		!isValidTimeString(end)
	) {
		throw new Error(
			"Invalid quiet hours range",
		);
	}

	if (start === end) {
		throw new Error(
			"Quiet hours start and end cannot be equal.",
		);
	}

	await setSettings(
		env,
		{
			quiet_hours_start:
				start,

			quiet_hours_end:
				end,

			quiet_hours_enabled:
				"true",
		},
	);
}

async function showAutomationSettings(
	env,
	message,
	admin,
) {
	const automation =
		await getAutomationSettings(
			env,
		);

	const next =
		calculateNextPublishAt(
			env,
			automation,
		);

	const lines = [
		"<b>🕒 زمان‌بندی انتشار</b>",
		"",
		automation.enabled
			? "<blockquote>🟢 انتشار خودکار فعال است</blockquote>"
			: "<blockquote>⚪ انتشار خودکار غیرفعال است</blockquote>",
		"",
		`⏱ بازه انتشار: <b>${automation.intervalMinutes} دقیقه</b>`,
		"",
		automation.quietHours.enabled
			? `🌙 ساعت استراحت: <b>${automation.quietHours.start} تا ${automation.quietHours.end}</b>`
			: "🌙 ساعت استراحت: <b>غیرفعال</b>",
		"",
		`📤 آخرین انتشار: <b>${formatOptionalSystemDateTime(
			env,
			automation.lastSuccessAt,
		)}</b>`,
		"",
		`⏭ انتشار بعدی: <b>${
			automation.enabled
				? (
					next
						? formatSystemDateTime(
							env,
							next,
						)
						: "نامشخص"
				)
				: "غیرفعال"
		}</b>`,
		"",
		buildNote(
			"Worker هر دقیقه بررسی می‌شود و فقط وقتی بازه انتشار رسیده باشد و داخل ساعت استراحت نباشیم، پست ارسال می‌شود.",
		),
	];

	if (
		admin.role === "admin"
	) {
		lines.push(
			"",
			"<blockquote>🔒 تنظیمات این بخش فقط توسط مالک قابل تغییر است.</blockquote>",
		);
	}

	const keyboard = [];

	if (
		admin.role === "owner"
	) {
		keyboard.push([
			{
				text:
					automation.enabled
						? "⏸ توقف انتشار خودکار"
						: "▶️ فعال کردن انتشار خودکار",

				callback_data:
					"automation:toggle",
			},
		]);

		keyboard.push([
			{
				text:
					"⏱ بازه انتشار",

				callback_data:
					"automation:interval",
			},

			{
				text:
					"🌙 ساعت استراحت",

				callback_data:
					"automation:quiet",
			},
		]);
	}

	keyboard.push([
		{
			text:
				"🔄 بروزرسانی",

			callback_data:
				"automation:refresh",
		},
	]);

	keyboard.push([
		{
			text:
				"⬅️ تنظیمات",

			callback_data:
				"settings:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

async function showIntervalSettings(
	env,
	message,
) {
	const automation =
		await getAutomationSettings(
			env,
		);

	const keyboard = [];

	for (
		let index = 0;
		index <
		ALLOWED_PUBLISH_INTERVALS.length;
		index += 3
	) {
		const row = [];

		for (
			let offset = 0;
			offset < 3;
			offset++
		) {
			const minutes =
				ALLOWED_PUBLISH_INTERVALS[
					index +
						offset
				];

			if (!minutes) {
				continue;
			}

			row.push({
				text:
					`${automation.intervalMinutes === minutes ? "✅" : "▫️"} ${minutes} دقیقه`,

				callback_data:
					`automation:interval:set:${minutes}`,
			});
		}

		keyboard.push(row);
	}

	keyboard.push([
		{
			text:
				"⬅️ زمان‌بندی انتشار",

			callback_data:
				"automation:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>⏱ بازه انتشار</b>",
			"",
			`بازه فعلی: <b>${automation.intervalMinutes} دقیقه</b>`,
			"",
			buildNote(
				"بازه انتشار از 5 تا 60 دقیقه با گام‌های 5 دقیقه‌ای قابل انتخاب است. مقدار پیش‌فرض 10 دقیقه است.",
			),
		].join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

/* ============================================================
 * QUIET HOURS UI
 * ============================================================
 */

async function showQuietHoursSettings(
	env,
	message,
	admin,
) {
	const automation =
		await getAutomationSettings(
			env,
		);

	const quiet =
		automation.quietHours;

	const lines = [
		"<b>🌙 ساعت استراحت</b>",
		"",
		quiet.enabled
			? "<blockquote>🟢 ساعت استراحت فعال است</blockquote>"
			: "<blockquote>⚪ ساعت استراحت غیرفعال است</blockquote>",
		"",
		`شروع: <b>${quiet.start}</b>`,
		`پایان: <b>${quiet.end}</b>`,
		"",
		buildNote(
			"در این بازه انتشار خودکار انجام نمی‌شود. بازه می‌تواند از نیمه‌شب عبور کند؛ مثل 23:00 تا 08:00.",
		),
	];

	const keyboard = [];

	if (
		admin.role === "owner"
	) {
		keyboard.push([
			{
				text:
					quiet.enabled
						? "⏸ غیرفعال کردن"
						: "▶️ فعال کردن",

				callback_data:
					"automation:quiet:toggle",
			},
		]);

		keyboard.push([
			{
				text:
					"🕒 انتخاب بازه جدید",

				callback_data:
					"automation:quiet:edit",
			},
		]);
	}

	keyboard.push([
		{
			text:
				"⬅️ زمان‌بندی انتشار",

			callback_data:
				"automation:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

async function showQuietStartHourSelector(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🌙 ساعت استراحت</b>",
			"",
			"<blockquote>مرحله 1 از 4</blockquote>",
			"",
			"<b>ساعت شروع را انتخاب کن</b>",
			"",
			buildNote(
				"ابتدا ساعت شروع، بعد دقیقه شروع و سپس زمان پایان انتخاب می‌شود.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				...buildHourKeyboard(
					"quiet:start_hour",
				),

				[
					{
						text:
							"⬅️ ساعت استراحت",

						callback_data:
							"automation:quiet",
					},
				],
			],
		},
	);
}

async function showQuietStartMinuteSelector(
	env,
	message,
	hour,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🌙 ساعت استراحت</b>",
			"",
			"<blockquote>مرحله 2 از 4</blockquote>",
			"",
			`شروع: <b>${pad2(
				hour,
			)}:--</b>`,
			"",
			"<b>دقیقه شروع را انتخاب کن</b>",
			"",
			buildNote(
				"دقیقه‌ها با گام 15 دقیقه‌ای انتخاب می‌شوند.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				buildMinuteRow(
					"quiet:start_minute",
					[
						hour,
					],
				),

				[
					{
						text:
							"⬅️ ساعت شروع",

						callback_data:
							"automation:quiet:edit",
					},
				],
			],
		},
	);
}

async function showQuietEndHourSelector(
	env,
	message,
	startHour,
	startMinute,
) {
	const start =
		buildTimeString(
			startHour,
			startMinute,
		);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🌙 ساعت استراحت</b>",
			"",
			"<blockquote>مرحله 3 از 4</blockquote>",
			"",
			`شروع: <b>${start}</b>`,
			"",
			"<b>ساعت پایان را انتخاب کن</b>",
			"",
			buildNote(
				"پایان می‌تواند مربوط به روز بعد باشد؛ مثل 23:00 تا 08:00.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				...buildHourKeyboard(
					"quiet:end_hour",
					[
						startHour,
						startMinute,
					],
				),

				[
					{
						text:
							"⬅️ دقیقه شروع",

						callback_data:
							`quiet:start_hour:${startHour}`,
					},
				],
			],
		},
	);
}

async function showQuietEndMinuteSelector(
	env,
	message,
	startHour,
	startMinute,
	endHour,
	errorText = null,
) {
	const start =
		buildTimeString(
			startHour,
			startMinute,
		);

	const lines = [
		"<b>🌙 ساعت استراحت</b>",
		"",
		"<blockquote>مرحله 4 از 4</blockquote>",
		"",
		`شروع: <b>${start}</b>`,
		`پایان: <b>${pad2(
			endHour,
		)}:--</b>`,
		"",
		"<b>دقیقه پایان را انتخاب کن</b>",
	];

	if (errorText) {
		lines.push(
			"",
			`⚠️ ${escapeHtml(
				errorText,
			)}`,
		);
	}

	lines.push(
		"",
		buildNote(
			"با انتخاب دقیقه پایان، بازه ذخیره و ساعت استراحت فعال می‌شود.",
		),
	);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				buildMinuteRow(
					"quiet:end_minute",
					[
						startHour,
						startMinute,
						endHour,
					],
				),

				[
					{
						text:
							"⬅️ ساعت پایان",

						callback_data:
							`quiet:start_minute:${startHour}:${startMinute}`,
					},
				],
			],
		},
	);
}

function buildHourKeyboard(
	prefix,
	extraParts = [],
) {
	const keyboard = [];

	for (
		let hour = 0;
		hour < 24;
		hour += 4
	) {
		const row = [];

		for (
			let offset = 0;
			offset < 4;
			offset++
		) {
			const value =
				hour +
				offset;

			row.push({
				text:
					pad2(value),

				callback_data: [
					prefix,
					...extraParts,
					value,
				].join(":"),
			});
		}

		keyboard.push(row);
	}

	return keyboard;
}

function buildMinuteRow(
	prefix,
	extraParts = [],
) {
	return QUIET_MINUTE_OPTIONS.map(
		(minute) => ({
			text:
				pad2(minute),

			callback_data: [
				prefix,
				...extraParts,
				minute,
			].join(":"),
		}),
	);
}

/* ============================================================
 * MARKET MANAGER
 * ============================================================
 */

async function showMarketManager(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>📈 مدیریت بازار</b>",
			"",
			"⏳ در حال دریافت آخرین اطلاعات بازار...",
		].join("\n"),
		backKeyboard(
			"پنل مدیریت",
			"menu:home",
		),
	);

	const [
		snapshot,
		automation,
	] = await Promise.all([
		getMarketSnapshot(env),

		getAutomationSettings(
			env,
		),
	]);

	const nextPublish =
		calculateNextPublishAt(
			env,
			automation,
		);

	const lines = [
		"<b>📈 مدیریت بازار</b>",
		"",
		snapshot.partial
			? "<blockquote>🟡 بخشی از اطلاعات بازار در دسترس نیست\n" +
				`🕒 آخرین بروزرسانی: ${escapeHtml(
					formatIranTime(
						env,
						snapshot.createdAt,
					),
				)}</blockquote>`
			: "<blockquote>🟢 همه‌چیز آماده انتشار است\n" +
				`🕒 آخرین بروزرسانی: ${escapeHtml(
					formatIranTime(
						env,
						snapshot.createdAt,
					),
				)}</blockquote>`,

		"",

		"💵 <b>تتر</b>",
		"",
		formatOptionalToman(
			snapshot.usdt.price,
		),

		"",
		"",

		`🪙 <b>رمزارزها</b>  ·  <b>${snapshot.crypto.length} فعال</b>`,
		"",
	];

	for (
		const coin
		of snapshot.crypto
	) {
		lines.push(
			buildMarketManagerCryptoItem(
				coin,
			),
			"",
		);
	}

	lines.push(
		"",
		"🥇 <b>طلا و فلزات</b>",
		"",
		`طلای ۱۸ عیار  ·  ${formatOptionalToman(
			snapshot.metals.gram18,
		)}`,
		"",
		`مظنه طلا  ·  ${formatOptionalToman(
			snapshot.metals.mazaneh !==
				null
				? roundToNearest(
					snapshot.metals.mazaneh,
					1000,
				)
				: null,
		)}`,
		"",
		`انس طلا  ·  ${formatOptionalUsd(
			snapshot.metals.gold,
		)}`,
		"",
		`نقره  ·  ${formatOptionalUsd(
			snapshot.metals.silver,
		)}`,
		"",
		"━━━━━━━━━━━━",
		"",
		"🤖 <b>انتشار خودکار</b>",
		"",
		automation.enabled
			? "🟢 <b>فعال</b>"
			: "⚪ <b>غیرفعال</b>",
		"",
		`⏱ بازه انتشار: <b>${automation.intervalMinutes} دقیقه</b>`,
		"",
		automation.quietHours.enabled
			? `🌙 ساعت استراحت: <b>${automation.quietHours.start} تا ${automation.quietHours.end}</b>`
			: "🌙 ساعت استراحت: <b>غیرفعال</b>",
	);

	if (
		automation.enabled
	) {
		lines.push(
			"",
			`⏭ انتشار بعدی: <b>${
				nextPublish
					? escapeHtml(
						formatSystemDateTime(
							env,
							nextPublish,
						),
					)
					: "نامشخص"
			}</b>`,
		);
	}

	lines.push(
		"",
		buildNote(
			"قیمت‌ها قبل از پیش‌نمایش یا انتشار دوباره دریافت می‌شوند؛ درصد رمزارزها تغییر 24 ساعته CoinGecko است.",
		),
	);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🚀 انتشار اکنون",

						callback_data:
							"market:publish",
					},

					{
						text:
							"📄 پیش‌نمایش",

						callback_data:
							"market:preview",
					},
				],

				[
					{
						text:
							"🤖 زمان‌بندی انتشار",

						callback_data:
							"automation:home",
					},
				],

				[
					{
						text:
							"🔄 بروزرسانی",

						callback_data:
							"market:refresh",
					},
				],

				[
					{
						text:
							"⬅️ پنل مدیریت",

						callback_data:
							"menu:home",
					},
				],
			],
		},
	);
}

function buildMarketManagerCryptoItem(
	coin,
) {
	const name =
		escapeHtml(
			getPersianCoinName(
				coin.id,
				coin.name,
			),
		);

	if (
		coin.price === null ||
		coin.price === undefined
	) {
		return [
			`<b>${name}</b>`,
			"<b>نامشخص</b>",
			"⚪ 24 ساعته  <b>نامشخص</b>",
		].join("\n");
	}

	const change =
		coin.change24h !== null &&
		coin.change24h !== undefined
			? `${formatChangeIcon(coin.change24h)} 24 ساعته  ${formatFaChangeValue(
				coin.change24h,
			)}`
			: "⚪ 24 ساعته  <b>نامشخص</b>";

	return [
		`${name}  ·  ${formatOptionalUsd(
			coin.price,
		)}`,

		change,
	].join("\n");
}

/* ============================================================
 * PREVIEW
 * ============================================================
 */

async function showMarketPreview(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>📄 پیش‌نمایش</b>",
			"",
			"⏳ در حال دریافت قیمت‌های جدید...",
		].join("\n"),
		backKeyboard(
			"مدیریت بازار",
			"market:home",
		),
	);

	const snapshot =
		await getMarketSnapshot(
			env,
		);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>📄 پیش‌نمایش پست</b>",
			"",
			buildChannelMarketPost(
				env,
				snapshot,
			),
			"",
			buildNote(
				"این پیش‌نمایش هنوز در کانال منتشر نشده است.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🚀 انتشار اکنون",

						callback_data:
							"market:publish",
					},
				],

				[
					{
						text:
							"🔄 پیش‌نمایش جدید",

						callback_data:
							"market:preview",
					},
				],

				[
					{
						text:
							"⬅️ مدیریت بازار",

						callback_data:
							"market:home",
					},
				],
			],
		},
	);
}

/* ============================================================
 * MANUAL PUBLISH
 * ============================================================
 */

async function publishMarketNow(
	env,
	message,
	user,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🚀 انتشار بازار</b>",
			"",
			"⏳ در حال دریافت آخرین قیمت‌ها...",
		].join("\n"),
		backKeyboard(
			"مدیریت بازار",
			"market:home",
		),
	);

	if (
		!env.TELEGRAM_CHANNEL_ID
	) {
		await editTelegramMessage(
			env,
			message.chat.id,
			message.message_id,
			[
				"<b>🚀 انتشار بازار</b>",
				"",
				"🔴 کانال مقصد تنظیم نشده است.",
			].join("\n"),
			backKeyboard(
				"مدیریت بازار",
				"market:home",
			),
		);

		return;
	}

	const snapshot =
		await getMarketSnapshot(
			env,
		);

	try {
		const result =
			await sendTelegramMessage(
				env,
				env.TELEGRAM_CHANNEL_ID,
				buildChannelMarketPost(
					env,
					snapshot,
				),
			);

		await addAuditLog(
			env,
			user.id,
			"market.manual_published",
			{
				messageId:
					result?.message_id ??
						null,

				partial:
					snapshot.partial,

				errors:
					snapshot.errors,
			},
		);

		await editTelegramMessage(
			env,
			message.chat.id,
			message.message_id,
			[
				"<b>🚀 انتشار بازار</b>",
				"",
				"<blockquote>✅ پست با موفقیت منتشر شد</blockquote>",
				"",
				snapshot.partial
					? "🟡 بعضی داده‌ها با «نامشخص» منتشر شدند."
					: "🟢 تمام اطلاعات بازار دریافت شده بود.",
				"",
				buildNote(
					"انتشار دستی روی زمان‌بندی انتشار خودکار اثر نمی‌گذارد.",
				),
			].join("\n"),
			{
				inline_keyboard: [
					[
						{
							text:
								"📄 پیش‌نمایش جدید",

							callback_data:
								"market:preview",
						},
					],

					[
						{
							text:
								"⬅️ مدیریت بازار",

							callback_data:
								"market:home",
						},
					],
				],
			},
		);
	} catch (error) {
		await editTelegramMessage(
			env,
			message.chat.id,
			message.message_id,
			[
				"<b>🚀 انتشار بازار</b>",
				"",
				"🔴 ارسال پیام به کانال ناموفق بود.",
				"",
				`<code>${escapeHtml(
					errorMessage(error),
				)}</code>`,
			].join("\n"),
			backKeyboard(
				"مدیریت بازار",
				"market:home",
			),
		);
	}
}

/* ============================================================
 * SNAPSHOT
 * ============================================================
 */

async function getMarketSnapshot(
	env,
	timestamp = Date.now(),
) {
	const enabledCoins =
		await getEnabledCoinGeckoAssets(
			env,
		);

	const [
		usdt,
		cryptoResult,
		globalMetals,
		wallgold,
	] = await Promise.all([
		resolveUsdtToman(
			env,
			true,
		),

		fetchSelectedCoinGeckoAssets(
			env,
			enabledCoins,
		),

		fetchCoinGeckoMetals(
			env,
		),

		checkWallGold(
			env,
		),
	]);

	const errors = [];

	const usdtData = {
		price: null,
		source: null,
		fallbackLevel: null,
	};

	if (usdt.success) {
		usdtData.price =
			usdt.price;

		usdtData.source =
			usdt.sourceLabel;

		usdtData.fallbackLevel =
			usdt.fallbackLevel;
	} else {
		errors.push({
			source:
				"usdt",

			message:
				usdt.message ??
					"USDT unavailable",
		});
	}

	let crypto = [];

	if (enabledCoins.length) {
		if (cryptoResult.success) {
			const liveMap =
				new Map(
					cryptoResult.assets.map(
						(item) => [
							item.id,
							item,
						],
					),
				);

			crypto =
				enabledCoins.map(
					(stored) => {
						const live =
							liveMap.get(
								stored.coin_id,
							);

						if (!live) {
							return {
								id:
									stored.coin_id,

								symbol:
									stored.symbol,

								name:
									stored.name,

								price:
									null,

								change24h:
									null,

								marketCapRank:
									stored.market_cap_rank ??
										null,
							};
						}

						return live;
					},
				);
		} else {
			errors.push({
				source:
					"coingecko_crypto",

				message:
					cryptoResult.message ??
						"CoinGecko unavailable",
			});

			crypto =
				enabledCoins.map(
					(item) => ({
						id:
							item.coin_id,

						symbol:
							item.symbol,

						name:
							item.name,

						price:
							null,

						change24h:
							null,

						marketCapRank:
							item.market_cap_rank ??
								null,
					}),
				);
		}
	}

	let gold =
		null;

	let silver =
		null;

	let gram18 =
		null;

	let mazaneh =
		null;

	if (
		globalMetals.success
	) {
		gold =
			globalMetals.gold;

		silver =
			globalMetals.silver;
	} else {
		errors.push({
			source:
				"coingecko_metals",

			message:
				globalMetals.message ??
					"Global metals unavailable",
		});
	}

	if (
		wallgold.success
	) {
		gram18 =
			wallgold.price;

		mazaneh =
			calculateMazanehFromGram18(
				gram18,
			);
	} else {
		errors.push({
			source:
				"wallgold",

			message:
				wallgold.message ??
					"WallGold unavailable",
		});
	}

	return {
		success: true,

		partial:
			errors.length > 0,

		errors,

		createdAt:
			timestamp,

		usdt:
			usdtData,

		crypto,

		metals: {
			gram18,
			mazaneh,
			gold,
			silver,
		},
	};
}

function calculateMazanehFromGram18(
	gram18Price,
) {
	const gram18 =
		Number(
			gram18Price,
		);

	if (
		!Number.isFinite(
			gram18,
		) ||
		gram18 <= 0
	) {
		return null;
	}

	return Math.round(
		gram18 *
			4.6083 *
			(705 / 750),
	);
}

/* ============================================================
 * CHANNEL POST
 * ============================================================
 */

function buildChannelMarketPost(
	env,
	snapshot,
) {
	const lines = [
		rtlLine("⚡️ <b>نبض بازار</b>"),
		"",

		rtlLine("💵 <b>تتر</b>"),
		rtlLine(
			formatOptionalToman(
				snapshot.usdt.price,
			),
		),

		"",
		"",
	];

	if (
		snapshot.crypto.length
	) {
		const cryptoLines = [];

		for (
			const coin
			of snapshot.crypto
		) {
			const name =
				escapeHtml(
					getPersianCoinName(
						coin.id,
						coin.name,
					),
				);

			cryptoLines.push(
				rtlLine(
					`<b>${name}</b>`,
				),
			);

			if (
				coin.price === null ||
				coin.price === undefined
			) {
				cryptoLines.push(
					rtlLine(
						"<b>نامشخص</b>",
					),
					rtlLine(
						"⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>",
					),
					"",
				);

				continue;
			}

			cryptoLines.push(
				rtlLine(
					formatOptionalUsd(
						coin.price,
					),
				),

				rtlLine(
					coin.change24h !== null &&
					coin.change24h !== undefined
						? `${formatChangeIcon(
							coin.change24h,
						)} تغییر ۲۴ ساعته: ${formatFaChangeValue(
							coin.change24h,
						)}`
						: "⚪ تغییر ۲۴ ساعته: <b>نامشخص</b>",
				),

				"",
			);
		}

		lines.push(
			rtlLine(
				"🪙 <b>رمزارزها</b>",
			),
			"",
			`<blockquote expandable>${cryptoLines
				.join("\n")
				.trim()}</blockquote>`,
			"",
			"",
		);
	}

	const metalsLines = [
		rtlLine(
			"<b>طلای ۱۸ عیار</b>",
		),
		rtlLine(
			formatOptionalToman(
				snapshot.metals.gram18,
			),
		),
		"",

		rtlLine(
			"<b>مظنه طلا</b>",
		),
		rtlLine(
			formatOptionalToman(
				snapshot.metals.mazaneh !== null
					? roundToNearest(
						snapshot.metals.mazaneh,
						1000,
					)
					: null,
			),
		),
		"",

		rtlLine(
			"<b>انس طلا</b>",
		),
		rtlLine(
			formatOptionalUsd(
				snapshot.metals.gold,
			),
		),
		"",

		rtlLine(
			"<b>نقره</b>",
		),
		rtlLine(
			formatOptionalUsd(
				snapshot.metals.silver,
			),
		),
	];

	lines.push(
		rtlLine(
			"🥇 <b>طلا و فلزات</b>",
		),
		"",
		`<blockquote expandable>${metalsLines.join("\n")}</blockquote>`,
		"",
		rtlLine("━━━━━━━━━━━━"),
		"",

		rtlLine(
			`🕒 <b>${escapeHtml(
				formatIranTime(
					env,
					snapshot.createdAt,
				),
			)}</b>  ·  📅 <b>${escapeHtml(
				formatIranDate(
					env,
					snapshot.createdAt,
				),
			)}</b>`,
		),
	);

	const handle =
		getChannelHandle(
			env,
		);

	if (handle) {
		lines.push(
			"",
			`<blockquote>${rtlLine(
				`🚀 ${escapeHtml(
					handle,
				)}`,
			)}</blockquote>`,
		);
	}

	return lines.join("\n");
}

/* ============================================================
 * SETTINGS
 * ============================================================
 */

async function showSettings(
	env,
	message,
	admin,
) {
	const keyboard = [
		[
			{
				text:
					"🕒 زمان‌بندی انتشار",

				callback_data:
					"automation:home",
			},
		],

		[
			{
				text:
					"📊 وضعیت سیستم",

				callback_data:
					"system:home",
			},
		],
	];

	if (
		admin.role ===
			"owner"
	) {
		keyboard.push([
			{
				text:
					"⏸ غیرفعال کردن ربات",

				callback_data:
					"global:disable",
			},
		]);
	}

	keyboard.push([
		{
			text:
				"⬅️ پنل مدیریت",

			callback_data:
				"menu:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>⚙️ تنظیمات</b>",
			"",
			"<blockquote>🟢 سیستم فعال است</blockquote>",
			"",
			buildNote(
				"زمان‌بندی انتشار و تنظیمات سطح سیستم از این بخش مدیریت می‌شوند.",
			),
		].join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

/* ============================================================
 * SYSTEM STATUS
 * ============================================================
 */

async function showSystemStatus(
	env,
	message,
	admin,
) {
	const now =
		Date.now();

	const [
		database,
		adminStats,
		automation,
	] = await Promise.all([
		getDatabaseStatus(env),
		getAdminStats(env),
		getAutomationSettings(env),
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>📊 وضعیت سیستم</b>",
			"",
			"<blockquote>🟢 سرویس در حال اجراست</blockquote>",
			"",
			`📅 تاریخ: <b>${formatIranDate(
				env,
				now,
			)}</b>`,
			`🕒 ساعت: <b>${formatIranTime(
				env,
				now,
			)}</b>`,
			`🌐 Timezone: <code>${escapeHtml(
				getTimezone(env),
			)}</code>`,
			"",
			"<b>⚙️ سرویس</b>",
			"",
			"🤖 ربات: 🟢 فعال",
			`📤 انتشار خودکار: ${
				automation.enabled
					? "🟢 فعال"
					: "⚪ غیرفعال"
			}`,
			`⏱ Interval: <b>${automation.intervalMinutes} min</b>`,
			"",
			"<b>🗄 دیتابیس</b>",
			"",
			`وضعیت: ${
				database.connected
					? "🟢 متصل"
					: "🔴 خطا"
			}`,
			`Latency: <code>${database.latencyMs}ms</code>`,
			"",
			"<b>👥 دسترسی</b>",
			"",
			`نقش شما: <b>${escapeHtml(
				getRoleLabel(admin),
			)}</b>`,
			`ادمین فعال: <b>${adminStats.active}</b>`,
			`ادمین غیرفعال: <b>${adminStats.inactive}</b>`,
			"",
			buildNote(
				"این صفحه وضعیت لحظه‌ای Worker، D1 و سیستم انتشار خودکار را نشان می‌دهد.",
			),
			"",
			`Version: <code>${escapeHtml(
				getVersion(env),
			)}</code>`,
		].join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🗄 وضعیت دیتابیس",

						callback_data:
							"database:home",
					},
				],

				[
					{
						text:
							"🔄 بروزرسانی",

						callback_data:
							"system:refresh",
					},
				],

				[
					{
						text:
							"⬅️ تنظیمات",

						callback_data:
							"settings:home",
					},
				],
			],
		},
	);
}

/* ============================================================
 * DATABASE MONITOR
 * ============================================================
 */

async function getDatabaseStatus(
	env,
) {
	const startedAt =
		Date.now();

	try {
		const result =
			await env.DB
				.prepare(
					"SELECT 1 AS health",
				)
				.first();

		return {
			connected:
				Number(
					result?.health,
				) === 1,

			provider:
				"Cloudflare D1",

			latencyMs:
				Date.now() -
				startedAt,
		};
	} catch (error) {
		return {
			connected:
				false,

			provider:
				"Cloudflare D1",

			latencyMs:
				Date.now() -
				startedAt,

			message:
				errorMessage(error),
		};
	}
}

async function showDatabaseMonitor(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🗄 وضعیت دیتابیس</b>",
			"",
			"⏳ در حال بررسی D1...",
		].join("\n"),
		backKeyboard(
			"وضعیت سیستم",
			"system:home",
		),
	);

	const [
		database,
		storage,
		stats,
	] = await Promise.all([
		getDatabaseStatus(env),
		getD1StorageUsage(env),
		getDatabaseStats(env),
	]);

	const lines = [
		"<b>🗄 وضعیت دیتابیس</b>",
		"",
		database.connected
			? "<blockquote>🟢 Cloudflare D1 متصل است</blockquote>"
			: "<blockquote>🔴 اتصال Cloudflare D1 ناموفق است</blockquote>",
		"",
		`Provider: <code>${database.provider}</code>`,
		`Latency: <code>${database.latencyMs}ms</code>`,
		"",
		"<b>💾 فضای دیتابیس</b>",
		"",
	];

	if (
		storage.available
	) {
		const percent =
			roundNumber(
				storage.usagePercent,
				2,
			);

		lines.push(
			`<code>${buildStorageUsageBar(
				percent,
			)}</code>`,
			"",
			`استفاده: <b>${percent}%</b>`,
			`مصرف‌شده: <b>${formatBytes(
				storage.usedBytes,
			)}</b>`,
			`فضای کل: <b>${formatBytes(
				storage.limitBytes,
			)}</b>`,
			`باقی‌مانده: <b>${formatBytes(
				storage.freeBytes,
			)}</b>`,
		);
	} else {
		lines.push(
			"⚪ اطلاعات فضای D1 در دسترس نیست.",
		);
	}

	lines.push(
		"",
		"<b>📊 رکوردها</b>",
		"",
		`Admins: <b>${stats.admins}</b>`,
		`Settings: <b>${stats.settings}</b>`,
		`Sources: <b>${stats.sources}</b>`,
		`Coins: <b>${stats.coins}</b>`,
		`Audit Logs: <b>${stats.audit_logs}</b>`,
		"",
		buildNote(
			"نوار بالا نسبت حجم فعلی فایل D1 به سقف تعیین‌شده در D1_DATABASE_LIMIT_MB را نمایش می‌دهد.",
		),
		"",
		`Schema: <code>v${APP.schemaVersion}</code>`,
	);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🔄 بروزرسانی",

						callback_data:
							"database:refresh",
					},
				],

				[
					{
						text:
							"⬅️ وضعیت سیستم",

						callback_data:
							"system:home",
					},
				],
			],
		},
	);
}

function buildStorageUsageBar(
	percent,
) {
	const safe =
		Math.min(
			100,
			Math.max(
				0,
				Number(percent) ||
					0,
			),
		);

	const totalBlocks =
		12;

	const filled =
		Math.round(
			(
				safe /
					100
			) *
				totalBlocks,
		);

	const empty =
		totalBlocks -
		filled;

	return (
		"█".repeat(
			filled,
		) +
		"░".repeat(
			empty,
		) +
		`  ${safe.toFixed(2)}%`
	);
}

async function getD1StorageUsage(
	env,
) {
	const accountId =
		String(
			env.CLOUDFLARE_ACCOUNT_ID ??
				"",
		).trim();

	const databaseId =
		String(
			env.CLOUDFLARE_D1_DATABASE_ID ??
				"",
		).trim();

	const apiToken =
		String(
			env.CLOUDFLARE_API_TOKEN ??
				"",
		).trim();

	const limitMb =
		Number(
			env.D1_DATABASE_LIMIT_MB ??
				0,
		);

	if (
		!accountId ||
		!databaseId ||
		!apiToken ||
		!limitMb
	) {
		return {
			available:
				false,
		};
	}

	try {
		const response =
			await fetchWithTimeout(
				`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
					accountId,
				)}/d1/database/${encodeURIComponent(
					databaseId,
				)}`,
				{
					headers: {
						Authorization:
							`Bearer ${apiToken}`,

						Accept:
							"application/json",
					},
				},
				8000,
			);

		const payload =
			await response.json();

		if (
			!response.ok ||
			!payload.success
		) {
			return {
				available:
					false,
			};
		}

		const usedBytes =
			Number(
				payload.result
					?.file_size ??
					0,
			);

		const limitBytes =
			limitMb *
			1024 *
			1024;

		return {
			available:
				true,

			usedBytes,

			limitBytes,

			freeBytes:
				Math.max(
					0,
					limitBytes -
						usedBytes,
				),

			usagePercent:
				limitBytes
					? (
						usedBytes /
							limitBytes
					) * 100
					: 0,
		};
	} catch {
		return {
			available:
				false,
		};
	}
}

async function getDatabaseStats(
	env,
) {
	const [
		admins,
		settings,
		sources,
		coins,
		auditLogs,
	] = await Promise.all([
		countTable(
			env,
			"admins",
		),

		countTable(
			env,
			"settings",
		),

		countTable(
			env,
			"source_status",
		),

		countTable(
			env,
			"coingecko_assets",
		),

		countTable(
			env,
			"audit_logs",
		),
	]);

	return {
		admins,
		settings,
		sources,
		coins,

		audit_logs:
			auditLogs,
	};
}

async function countTable(
	env,
	table,
) {
	const allowed = [
		"admins",
		"settings",
		"source_status",
		"coingecko_assets",
		"audit_logs",
	];

	if (
		!allowed.includes(table)
	) {
		return 0;
	}

	try {
		const result =
			await env.DB
				.prepare(
					`SELECT COUNT(*) AS count FROM "${table}"`,
				)
				.first();

		return Number(
			result?.count ??
				0,
		);
	} catch {
		return 0;
	}
}

/* ============================================================
 * SOURCE MANAGER
 * ============================================================
 */

async function showSourceManager(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>📡 مدیریت منابع</b>",
			"",
			"⏳ در حال بررسی منابع...",
		].join("\n"),
		backKeyboard(
			"پنل مدیریت",
			"menu:home",
		),
	);

	const result =
		await checkAllSources(
			env,
			true,
		);

	const lines = [
		"<b>📡 مدیریت منابع</b>",
		"",
		"<b>💵 تتر / تومان</b>",
		"",
		sourceStatusText(
			"Wallex",
			result.wallex,
			"Primary",
		),
		"",
		sourceStatusText(
			"Tabdeal",
			result.tabdeal,
			"Fallback #1",
		),
		"",
		sourceStatusText(
			"Exir",
			result.exir,
			"Fallback #2",
		),
		"",
		"<b>🪙 رمزارزها و فلزات جهانی</b>",
		"",
		sourceStatusText(
			"CoinGecko",
			result.coingecko,
		),
		"",
		"<b>🥇 طلای ایران</b>",
		"",
		sourceStatusText(
			"WallGold",
			result.wallgold,
		),
		"",
		buildNote(
			"برای تتر ابتدا Wallex بررسی می‌شود و در صورت خطا Tabdeal و سپس Exir استفاده می‌شوند.",
		),
	];

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🪙 مدیریت CoinGecko",

						callback_data:
							"coingecko:home",
					},
				],

				[
					{
						text:
							"💵 مسیر دریافت تتر",

						callback_data:
							"sources:usdt",
					},
				],

				[
					{
						text:
							"🔄 بررسی مجدد",

						callback_data:
							"sources:refresh",
					},
				],

				[
					{
						text:
							"⬅️ پنل مدیریت",

						callback_data:
							"menu:home",
					},
				],
			],
		},
	);
}

/* ============================================================
 * COINGECKO MANAGER
 * ============================================================
 */

async function showCoinGeckoManager(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🪙 مدیریت CoinGecko</b>",
			"",
			"⏳ در حال دریافت رمزارزهای برتر...",
		].join("\n"),
		backKeyboard(
			"مدیریت منابع",
			"sources:home",
		),
	);

	const result =
		await fetchCoinGeckoTopAssets(
			env,
		);

	if (!result.success) {
		const stored =
			await getStoredCoinGeckoAssets(
				env,
			);

		await editTelegramMessage(
			env,
			message.chat.id,
			message.message_id,
			[
				"<b>🪙 مدیریت CoinGecko</b>",
				"",
				"<blockquote>🟡 دریافت لیست زنده ناموفق بود</blockquote>",
				"",
				`رمزارز فعال: <b>${
					stored.filter(
						(item) =>
							item.enabled,
					).length
				}</b>`,
				"",
				buildNote(
					"تنظیمات قبلی داخل D1 حفظ شده‌اند و با خرابی موقت CoinGecko حذف نمی‌شوند.",
				),
			].join("\n"),
			backKeyboard(
				"مدیریت منابع",
				"sources:home",
			),
		);

		return;
	}

	await syncCoinGeckoAssets(
		env,
		result.assets,
	);

	const stored =
		await getCoinGeckoAssetMap(
			env,
		);

	const enabledCount =
		result.assets.filter(
			(asset) =>
				Number(
					stored[
						asset.id
					]?.is_enabled ??
						0,
				) === 1,
		).length;

	const keyboard = [];

	for (
		let index = 0;
		index <
		result.assets.length;
		index += 2
	) {
		const row = [];

		for (
			let offset = 0;
			offset < 2;
			offset++
		) {
			const coin =
				result.assets[
					index +
						offset
				];

			if (!coin) {
				continue;
			}

			const active =
				Number(
					stored[
						coin.id
					]?.is_enabled ??
						0,
				) === 1;

			row.push({
				text:
					`${active ? "✅" : "⬜"} ${getPersianCoinName(
						coin.id,
						coin.name,
					)}`,

				callback_data:
					`coingecko:toggle:${coin.id}`,
			});
		}

		keyboard.push(row);
	}

	keyboard.push([
		{
			text:
				"🔄 بروزرسانی لیست",

			callback_data:
				"coingecko:refresh",
		},
	]);

	keyboard.push([
		{
			text:
				"⬅️ مدیریت منابع",

			callback_data:
				"sources:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🪙 مدیریت CoinGecko</b>",
			"",
			`فعال: <b>${enabledCount}</b>`,
			`لیست فعلی: <b>${result.assets.length}</b> رمزارز`,
			"",
			buildNote(
				"فقط رمزارزهای تیک‌خورده در Snapshot و پست کانال نمایش داده می‌شوند.",
			),
		].join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

/* ============================================================
 * COINGECKO
 * ============================================================
 */

function getDefaultCoinGeckoAssets(
	env,
) {
	const configured =
		String(
			env.COINGECKO_DEFAULT_ASSETS ??
				"",
		)
			.split(",")
			.map(
				(item) =>
					item.trim(),
			)
			.filter(Boolean);

	return configured.length
		? configured
		: DEFAULT_COINGECKO_ASSETS;
}

function getCoinGeckoTopLimit(
	env,
) {
	const raw =
		Number(
			env.COINGECKO_TOP_LIMIT ??
				DEFAULT_COINGECKO_TOP_LIMIT,
		);

	if (
		!Number.isFinite(raw)
	) {
		return DEFAULT_COINGECKO_TOP_LIMIT;
	}

	return Math.min(
		50,
		Math.max(
			10,
			Math.floor(raw),
		),
	);
}

async function initializeDefaultCoinGeckoAssets(
	env,
) {
	const row =
		await env.DB
			.prepare(`
				SELECT COUNT(*) AS count
				FROM coingecko_assets
			`)
			.first();

	if (
		Number(
			row?.count ??
				0,
		) > 0
	) {
		return;
	}

	const defaults =
		getDefaultCoinGeckoAssets(
			env,
		);

	const now =
		Date.now();

	for (
		const coinId
		of defaults
	) {
		await env.DB
			.prepare(`
				INSERT OR IGNORE INTO coingecko_assets (
					coin_id,
					symbol,
					name,
					is_enabled,
					market_cap_rank,
					created_at,
					updated_at
				)

				VALUES (?, ?, ?, 1, NULL, ?, ?)
			`)
			.bind(
				coinId,
				coinId.toUpperCase(),
				coinId,
				now,
				now,
			)
			.run();
	}
}

async function fetchCoinGeckoTopAssets(
	env,
) {
	if (
		!env.COINGECKO_API_KEY
	) {
		return {
			success: false,

			message:
				"COINGECKO_API_KEY missing",
		};
	}

	const limit =
		getCoinGeckoTopLimit(
			env,
		);

	const endpoint =
		"https://api.coingecko.com/api/v3/coins/markets" +
		"?vs_currency=usd" +
		"&order=market_cap_desc" +
		`&per_page=${limit}` +
		"&page=1" +
		"&sparkline=false" +
		"&price_change_percentage=24h";

	const startedAt =
		Date.now();

	try {
		const response =
			await fetchWithTimeout(
				endpoint,
				{
					headers:
						getCoinGeckoHeaders(
							env,
						),
				},
				8000,
			);

		const latency =
			Date.now() -
			startedAt;

		if (!response.ok) {
			return {
				success: false,

				status:
					response.status,

				latency,

				message:
					await createSourceHttpError(
						response,
					),
			};
		}

		const data =
			await response.json();

		if (!Array.isArray(data)) {
			return {
				success: false,

				latency,

				message:
					"Invalid CoinGecko response",
			};
		}

		return {
			success: true,

			status:
				response.status,

			latency,

			assets:
				data.map(
					(item) => ({
						id:
							String(
								item.id,
							),

						symbol:
							String(
								item.symbol,
							).toUpperCase(),

						name:
							String(
								item.name,
							),

						market_cap_rank:
							toNullableNumber(
								item.market_cap_rank,
							),

						price:
							toNullableNumber(
								item.current_price,
							),

						change24h:
							toNullableNumber(
								item.price_change_percentage_24h,
							),
					}),
				),
		};
	} catch (error) {
		return {
			success: false,

			latency:
				Date.now() -
					startedAt,

			message:
				errorMessage(error),
		};
	}
}

async function syncCoinGeckoAssets(
	env,
	assets,
) {
	const existing =
		await getCoinGeckoAssetMap(
			env,
		);

	const defaults =
		getDefaultCoinGeckoAssets(
			env,
		);

	const now =
		Date.now();

	const statements = [];

	for (
		const coin
		of assets
	) {
		const current =
			existing[
				coin.id
			];

		const enabled =
			current
				? Number(
					current.is_enabled,
				)
				: defaults.includes(
					coin.id,
				)
					? 1
					: 0;

		statements.push(
			env.DB
				.prepare(`
					INSERT INTO coingecko_assets (
						coin_id,
						symbol,
						name,
						is_enabled,
						market_cap_rank,
						created_at,
						updated_at
					)

					VALUES (?, ?, ?, ?, ?, ?, ?)

					ON CONFLICT(coin_id)
					DO UPDATE SET
						symbol = excluded.symbol,
						name = excluded.name,
						market_cap_rank = excluded.market_cap_rank,
						updated_at = excluded.updated_at
				`)
				.bind(
					coin.id,
					coin.symbol,
					coin.name,
					enabled,
					coin.market_cap_rank,
					now,
					now,
				),
		);
	}

	if (
		statements.length
	) {
		await env.DB.batch(
			statements,
		);
	}
}

async function toggleCoinGeckoAsset(
	env,
	coinId,
) {
	const row =
		await env.DB
			.prepare(`
				SELECT *
				FROM coingecko_assets
				WHERE coin_id = ?
				LIMIT 1
			`)
			.bind(
				coinId,
			)
			.first();

	if (!row) {
		return;
	}

	const next =
		Number(
			row.is_enabled,
		) === 1
			? 0
			: 1;

	await env.DB
		.prepare(`
			UPDATE coingecko_assets
			SET
				is_enabled = ?,
				updated_at = ?
			WHERE coin_id = ?
		`)
		.bind(
			next,
			Date.now(),
			coinId,
		)
		.run();
}

async function getCoinGeckoAssetMap(
	env,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT *
				FROM coingecko_assets
			`)
			.all();

	const map = {};

	for (
		const item
		of result.results ??
			[]
	) {
		map[
			item.coin_id
		] = item;
	}

	return map;
}

async function getEnabledCoinGeckoAssets(
	env,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT
					coin_id,
					symbol,
					name,
					market_cap_rank

				FROM coingecko_assets

				WHERE is_enabled = 1

				ORDER BY
					CASE
						WHEN market_cap_rank IS NULL
						THEN 999999
						ELSE market_cap_rank
					END ASC
			`)
			.all();

	return (
		result.results ??
			[]
	);
}

async function getStoredCoinGeckoAssets(
	env,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT
					coin_id,
					symbol,
					name,
					market_cap_rank,
					is_enabled

				FROM coingecko_assets

				ORDER BY
					CASE
						WHEN market_cap_rank IS NULL
						THEN 999999
						ELSE market_cap_rank
					END ASC
			`)
			.all();

	return (
		result.results ??
			[]
	).map(
		(item) => ({
			id:
				item.coin_id,

			name:
				item.name,

			name_fa:
				getPersianCoinName(
					item.coin_id,
					item.name,
				),

			symbol:
				item.symbol,

			market_cap_rank:
				item.market_cap_rank ??
					null,

			price_usd:
				null,

			change_24h_percent:
				null,

			enabled:
				Number(
					item.is_enabled,
				) === 1,
		}),
	);
}

async function fetchSelectedCoinGeckoAssets(
	env,
	enabledAssets,
) {
	if (!enabledAssets.length) {
		return {
			success: true,
			assets: [],
		};
	}

	if (
		!env.COINGECKO_API_KEY
	) {
		return {
			success: false,

			message:
				"COINGECKO_API_KEY missing",
		};
	}

	const ids =
		enabledAssets
			.map(
				(item) =>
					item.coin_id,
			)
			.join(",");

	const endpoint =
		"https://api.coingecko.com/api/v3/coins/markets" +
		"?vs_currency=usd" +
		`&ids=${encodeURIComponent(
			ids,
		)}` +
		"&order=market_cap_desc" +
		"&sparkline=false" +
		"&price_change_percentage=24h";

	try {
		const response =
			await fetchWithTimeout(
				endpoint,
				{
					headers:
						getCoinGeckoHeaders(
							env,
						),
				},
				8000,
			);

		if (!response.ok) {
			return {
				success: false,

				message:
					await createSourceHttpError(
						response,
					),
			};
		}

		const data =
			await response.json();

		if (!Array.isArray(data)) {
			return {
				success: false,

				message:
					"Invalid CoinGecko response",
			};
		}

		return {
			success: true,

			assets:
				data.map(
					(item) => ({
						id:
							String(
								item.id,
							),

						symbol:
							String(
								item.symbol,
							).toUpperCase(),

						name:
							String(
								item.name,
							),

						price:
							toNullableNumber(
								item.current_price,
							),

						change24h:
							toNullableNumber(
								item.price_change_percentage_24h,
							),

						marketCapRank:
							toNullableNumber(
								item.market_cap_rank,
							),
					}),
				),
		};
	} catch (error) {
		return {
			success: false,

			message:
				errorMessage(error),
		};
	}
}

async function fetchCoinGeckoMetals(
	env,
) {
	if (
		!env.COINGECKO_API_KEY
	) {
		return {
			success: false,

			message:
				"COINGECKO_API_KEY missing",
		};
	}

	const endpoint =
		"https://api.coingecko.com/api/v3/simple/price" +
		"?ids=tether-gold,kinesis-silver" +
		"&vs_currencies=usd";

	try {
		const response =
			await fetchWithTimeout(
				endpoint,
				{
					headers:
						getCoinGeckoHeaders(
							env,
						),
				},
				8000,
			);

		if (!response.ok) {
			return {
				success: false,

				message:
					await createSourceHttpError(
						response,
					),
			};
		}

		const data =
			await response.json();

		const gold =
			toNullableNumber(
				data?.[
					"tether-gold"
				]?.usd,
			);

		const silver =
			toNullableNumber(
				data?.[
					"kinesis-silver"
				]?.usd,
			);

		if (
			gold === null &&
			silver === null
		) {
			return {
				success: false,

				message:
					"Invalid metals response",
			};
		}

		return {
			success: true,
			gold,
			silver,
		};
	} catch (error) {
		return {
			success: false,

			message:
				errorMessage(error),
		};
	}
}

async function checkCoinGeckoHealth(
	env,
) {
	const result =
		await fetchCoinGeckoTopAssets(
			env,
		);

	return {
		success:
			result.success,

		status:
			result.status ??
				null,

		latency:
			result.latency ??
				0,

		message:
			result.success
				? null
				: result.message,

		sample:
			result.success
				? {
					top_assets:
						result.assets.length,
				}
				: null,
	};
}

function getCoinGeckoHeaders(
	env,
) {
	return {
		Accept:
			"application/json",

		"x-cg-demo-api-key":
			env.COINGECKO_API_KEY,
	};
}

/* ============================================================
 * USDT VIEW + SOURCE CHECKS
 * ============================================================
 */

async function showUsdtRoute(
	env,
	message,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>💵 مسیر دریافت تتر</b>",
			"",
			"⏳ در حال انتخاب بهترین منبع...",
		].join("\n"),
		backKeyboard(
			"مدیریت منابع",
			"sources:home",
		),
	);

	const result =
		await resolveUsdtToman(
			env,
			true,
		);

	const lines = [
		"<b>💵 مسیر دریافت تتر</b>",
		"",
	];

	if (!result.success) {
		lines.push(
			"<blockquote>🟡 قیمت تتر در حال حاضر نامشخص است</blockquote>",
			"",
			"Wallex → Tabdeal → Exir",
			"",
			buildNote(
				"اگر منبع اصلی پاسخ ندهد، سیستم به‌صورت خودکار منابع بعدی را امتحان می‌کند.",
			),
		);
	} else {
		const state =
			result.fallbackLevel ===
				0
				? "🟢 منبع اصلی"
				: result.fallbackLevel ===
					1
					? "🟡 جایگزین اول"
					: "🟠 جایگزین دوم";

		lines.push(
			"<blockquote>✅ قیمت معتبر دریافت شد</blockquote>",
			"",
			`💰 <b>${formatFaInteger(
				result.price,
			)} تومان</b>`,
			"",
			`📡 <b>${escapeHtml(
				result.sourceLabel,
			)}</b>`,
			state,
			"",
			`⏱ <code>${result.latency}ms</code>`,
			"",
			"Wallex → Tabdeal → Exir",
			"",
			buildNote(
				"اولویت همیشه Wallex است؛ Tabdeal و Exir فقط هنگام خطای منابع قبلی استفاده می‌شوند.",
			),
		);
	}

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🔄 بروزرسانی",

						callback_data:
							"sources:usdt",
					},
				],

				[
					{
						text:
							"⬅️ مدیریت منابع",

						callback_data:
							"sources:home",
					},
				],
			],
		},
	);
}

async function checkAllSources(
	env,
	persist = false,
) {
	const [
		wallex,
		tabdeal,
		exir,
		coingecko,
		wallgold,
	] = await Promise.all([
		checkWallex(env),
		checkTabdeal(env),
		checkExir(env),
		checkCoinGeckoHealth(env),
		checkWallGold(env),
	]);

	const result = {
		wallex,
		tabdeal,
		exir,
		coingecko,
		wallgold,
	};

	if (persist) {
		await persistAllSourceStatuses(
			env,
			result,
		);
	}

	return result;
}

async function resolveUsdtToman(
	env,
	persist = false,
) {
	const checks = [
		[
			"wallex",
			checkWallex,
		],

		[
			"tabdeal",
			checkTabdeal,
		],

		[
			"exir",
			checkExir,
		],
	];

	const failures = [];

	for (
		let index = 0;
		index < checks.length;
		index++
	) {
		const [
			source,
			checker,
		] = checks[index];

		const result =
			await checker(env);

		if (persist) {
			await persistSourceStatus(
				env,
				source,
				result,
			);
		}

		if (
			result.success &&
			Number.isFinite(
				Number(
					result.price,
				),
			) &&
			Number(
				result.price,
			) > 0
		) {
			return {
				success:
					true,

				source,

				sourceLabel:
					sourceLabel(
						source,
					),

				price:
					Number(
						result.price,
					),

				latency:
					result.latency,

				fallbackLevel:
					index,
			};
		}

		failures.push(
			`${sourceLabel(
				source,
			)}: ${
				result.message ??
					"Unavailable"
			}`,
		);
	}

	return {
		success:
			false,

		message:
			failures.join(
				" | ",
			),
	};
}

function resolveUsdtFromChecks(
	sources,
) {
	for (
		let index = 0;
		index <
		USDT_SOURCE_PRIORITY.length;
		index++
	) {
		const key =
			USDT_SOURCE_PRIORITY[
				index
			];

		const result =
			sources[key];

		if (
			result?.success &&
			Number.isFinite(
				Number(
					result.price,
				),
			)
		) {
			return {
				success:
					true,

				source:
					key,

				sourceLabel:
					sourceLabel(
						key,
					),

				price:
					Number(
						result.price,
					),

				latency:
					result.latency,

				fallbackLevel:
					index,
			};
		}
	}

	return {
		success:
			false,
	};
}

/* ============================================================
 * WALLEX
 * ============================================================
 */

async function checkWallex(
	env,
) {
	if (
		!env.WALLEX_API_URL
	) {
		return sourceError(
			"WALLEX_API_URL missing",
		);
	}

	const startedAt =
		Date.now();

	try {
		const response =
			await fetchWithTimeout(
				env.WALLEX_API_URL,
				{
					headers: {
						Accept:
							"application/json",
					},
				},
				8000,
			);

		const latency =
			Date.now() -
			startedAt;

		if (!response.ok) {
			return sourceHttpError(
				response,
				latency,
			);
		}

		const data =
			await response.json();

		const markets =
			data?.result
				?.markets;

		const market =
			Array.isArray(
				markets,
			)
				? markets.find(
					(item) =>
						String(
							item?.symbol ??
								"",
						).toUpperCase() ===
						"USDTTMN",
				)
				: null;

		const price =
			Number(
				market?.price,
			);

		if (
			!Number.isFinite(
				price,
			) ||
			price <= 0
		) {
			return {
				success:
					false,

				status:
					response.status,

				latency,

				message:
					"Invalid Wallex USDT price",
			};
		}

		return {
			success:
				true,

			status:
				response.status,

			latency,

			price,
		};
	} catch (error) {
		return sourceCatchError(
			error,
			startedAt,
		);
	}
}

/* ============================================================
 * TABDEAL
 * ============================================================
 */

async function checkTabdeal(
	env,
) {
	if (
		!env.TABDEAL_API_URL
	) {
		return sourceError(
			"TABDEAL_API_URL missing",
		);
	}

	const startedAt =
		Date.now();

	try {
		const response =
			await fetchWithTimeout(
				env.TABDEAL_API_URL,
				{
					headers: {
						Accept:
							"application/json",
					},
				},
				8000,
			);

		const latency =
			Date.now() -
			startedAt;

		if (!response.ok) {
			return sourceHttpError(
				response,
				latency,
			);
		}

		const data =
			await response.json();

		const price =
			Number(
				data?.asks?.[0]?.[0],
			);

		if (
			!Number.isFinite(
				price,
			) ||
			price <= 0
		) {
			return {
				success:
					false,

				status:
					response.status,

				latency,

				message:
					"Invalid Tabdeal USDT price",
			};
		}

		return {
			success:
				true,

			status:
				response.status,

			latency,

			price,
		};
	} catch (error) {
		return sourceCatchError(
			error,
			startedAt,
		);
	}
}

/* ============================================================
 * EXIR
 * ============================================================
 */

async function checkExir(
	env,
) {
	if (
		!env.EXIR_API_URL
	) {
		return sourceError(
			"EXIR_API_URL missing",
		);
	}

	const startedAt =
		Date.now();

	try {
		const response =
			await fetchWithTimeout(
				env.EXIR_API_URL,
				{
					headers: {
						Accept:
							"application/json",
					},
				},
				8000,
			);

		const latency =
			Date.now() -
			startedAt;

		if (!response.ok) {
			return sourceHttpError(
				response,
				latency,
			);
		}

		const data =
			await response.json();

		const orderbook =
			data?.["usdt-irt"] ??
				data;

		const price =
			Number(
				orderbook
					?.asks?.[0]?.[0],
			);

		if (
			!Number.isFinite(
				price,
			) ||
			price <= 0
		) {
			return {
				success:
					false,

				status:
					response.status,

				latency,

				message:
					"Invalid Exir USDT price",
			};
		}

		return {
			success:
				true,

			status:
				response.status,

			latency,

			price,
		};
	} catch (error) {
		return sourceCatchError(
			error,
			startedAt,
		);
	}
}

/* ============================================================
 * WALLGOLD
 * ============================================================
 */

async function checkWallGold(
	env,
) {
	if (
		!env.WALLGOLD_API_URL
	) {
		return sourceError(
			"WALLGOLD_API_URL missing",
		);
	}

	const startedAt =
		Date.now();

	try {
		const response =
			await fetchWithTimeout(
				env.WALLGOLD_API_URL,
				{
					headers: {
						Accept:
							"application/json",
					},
				},
				8000,
			);

		const latency =
			Date.now() -
			startedAt;

		if (!response.ok) {
			return sourceHttpError(
				response,
				latency,
			);
		}

		const data =
			await response.json();

		const price =
			Number(
				data?.result
					?.price,
			);

		if (
			!Number.isFinite(
				price,
			) ||
			price <= 0
		) {
			return {
				success:
					false,

				status:
					response.status,

				latency,

				message:
					"Invalid WallGold price",
			};
		}

		return {
			success:
				true,

			status:
				response.status,

			latency,

			price,
		};
	} catch (error) {
		return sourceCatchError(
			error,
			startedAt,
		);
	}
}

/* ============================================================
 * SOURCE STORAGE
 * ============================================================
 */

function sourceStatusText(
	name,
	source,
	role = null,
) {
	const lines = [
		`${source.success ? "🟢" : "🔴"} <b>${escapeHtml(
			name,
		)}</b>${
			role
				? ` · <i>${escapeHtml(
					role,
				)}</i>`
				: ""
		}`,

		`Latency: <code>${source.latency ?? 0}ms</code>`,
	];

	if (
		source.status !==
			null &&
		source.status !==
			undefined
	) {
		lines.push(
			`HTTP: <code>${escapeHtml(
				source.status,
			)}</code>`,
		);
	}

	if (
		!source.success &&
		source.message
	) {
		lines.push(
			`Error: <code>${escapeHtml(
				source.message,
			)}</code>`,
		);
	}

	return lines.join("\n");
}

async function persistAllSourceStatuses(
	env,
	results,
) {
	await env.DB.batch(
		Object.entries(
			results,
		).map(
			([
				source,
				result,
			]) =>
				buildSourceStatusStatement(
					env,
					source,
					result,
				),
		),
	);
}

async function persistSourceStatus(
	env,
	source,
	result,
) {
	await buildSourceStatusStatement(
		env,
		source,
		result,
	).run();
}

function buildSourceStatusStatement(
	env,
	source,
	result,
) {
	return env.DB
		.prepare(`
			INSERT INTO source_status (
				source,
				success,
				status_code,
				latency_ms,
				message,
				last_price,
				last_checked_at
			)

			VALUES (?, ?, ?, ?, ?, ?, ?)

			ON CONFLICT(source)
			DO UPDATE SET
				success = excluded.success,
				status_code = excluded.status_code,
				latency_ms = excluded.latency_ms,
				message = excluded.message,
				last_price = excluded.last_price,
				last_checked_at = excluded.last_checked_at
		`)
		.bind(
			source,

			result.success
				? 1
				: 0,

			result.status ??
				null,

			result.latency ??
				null,

			result.message ??
				null,

			Number.isFinite(
				Number(
					result.price,
				),
			)
				? Number(
					result.price,
				)
				: null,

			Date.now(),
		);
}

function serializeSourceStatus(
	source,
) {
	return {
		healthy:
			Boolean(
				source.success,
			),

		http_status:
			source.status ??
				null,

		latency_ms:
			source.latency ??
				null,

		message:
			source.message ??
				null,

		price:
			source.price ??
				null,

		sample:
			source.sample ??
				null,
	};
}

/* ============================================================
 * CRON
 * ============================================================
 */

async function handleScheduledTick(
	controller,
	env,
) {
	try {
		await ensureDatabase(
			env,
		);

		if (
			!(
				await getGlobalEnabled(
					env,
				)
			)
		) {
			return;
		}

		const automation =
			await getAutomationSettings(
				env,
			);

		if (
			!automation.enabled
		) {
			return;
		}

		const now =
			Number(
				controller
					?.scheduledTime,
			) ||
			Date.now();

		if (
			isInsideQuietHours(
				env,
				now,
				automation.quietHours,
			)
		) {
			return;
		}

		if (
			!isAutoPublishDue(
				now,
				automation.lastRunAt,
				automation.intervalMinutes,
			)
		) {
			return;
		}

		const claimed =
			await claimAutoPublishSlot(
				env,
				automation.lastRunAt,
				now,
			);

		if (!claimed) {
			return;
		}

		await performAutomaticPublish(
			env,
			now,
		);
	} catch (error) {
		console.error(
			"cron.error",
			errorMessage(error),
		);

		try {
			await setSetting(
				env,
				"auto_publish_last_error",
				errorMessage(
					error,
				).slice(
					0,
					500,
				),
			);
		} catch {
			// Ignore.
		}
	}
}

function isAutoPublishDue(
	now,
	lastRunAt,
	intervalMinutes,
) {
	if (!lastRunAt) {
		return true;
	}

	return (
		now -
			lastRunAt >=
		intervalMinutes *
			60 *
			1000
	);
}

async function claimAutoPublishSlot(
	env,
	expectedLastRunAt,
	now,
) {
	const result =
		await env.DB
			.prepare(`
				UPDATE settings
				SET
					value = ?,
					updated_at = ?
				WHERE
					key = 'auto_publish_last_run_at'
					AND value = ?
			`)
			.bind(
				String(now),
				Date.now(),
				String(
					expectedLastRunAt ||
						0,
				),
			)
			.run();

	return (
		Number(
			result?.meta?.changes ??
				0,
		) > 0
	);
}

async function performAutomaticPublish(
	env,
	timestamp,
) {
	if (
		!env.TELEGRAM_CHANNEL_ID
	) {
		throw new Error(
			"TELEGRAM_CHANNEL_ID is missing",
		);
	}

	const snapshot =
		await getMarketSnapshot(
			env,
			timestamp,
		);

	const result =
		await sendTelegramMessage(
			env,
			env.TELEGRAM_CHANNEL_ID,
			buildChannelMarketPost(
				env,
				snapshot,
			),
		);

	await setSettings(
		env,
		{
			auto_publish_last_success_at:
				String(
					timestamp,
				),

			auto_publish_last_error:
				"",
		},
	);

	await addAuditLog(
		env,
		"system",
		"market.auto_published",
		{
			messageId:
				result?.message_id ??
					null,

			partial:
				snapshot.partial,

			errors:
				snapshot.errors,

			timestamp,
		},
	);
}

function isInsideQuietHours(
	env,
	timestamp,
	quietHours,
) {
	if (
		!quietHours?.enabled
	) {
		return false;
	}

	const current =
		getTimeMinutesInTimezone(
			env,
			timestamp,
		);

	const start =
		timeStringToMinutes(
			quietHours.start,
		);

	const end =
		timeStringToMinutes(
			quietHours.end,
		);

	if (
		start === null ||
		end === null ||
		start === end
	) {
		return false;
	}

	if (start < end) {
		return (
			current >= start &&
			current < end
		);
	}

	return (
		current >= start ||
		current < end
	);
}

function calculateNextPublishAt(
	env,
	automation,
	now = Date.now(),
) {
	if (
		!automation.enabled
	) {
		return null;
	}

	let candidate =
		automation.lastRunAt
			? automation.lastRunAt +
				automation.intervalMinutes *
					60 *
					1000
			: now;

	if (
		candidate < now
	) {
		candidate = now;
	}

	for (
		let index = 0;
		index < 1440;
		index++
	) {
		if (
			!isInsideQuietHours(
				env,
				candidate,
				automation.quietHours,
			)
		) {
			return candidate;
		}

		candidate +=
			60 * 1000;
	}

	return candidate;
}

/* ============================================================
 * ADMIN MANAGEMENT
 * ============================================================
 */

async function getAdmins(
	env,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT *
				FROM admins

				ORDER BY
					is_active DESC,
					created_at ASC
			`)
			.all();

	return (
		result.results ??
			[]
	);
}

async function getAdmin(
	env,
	userId,
) {
	return env.DB
		.prepare(`
			SELECT *
			FROM admins
			WHERE user_id = ?
			LIMIT 1
		`)
		.bind(
			String(userId),
		)
		.first();
}

function getAdminDisplayName(
	admin,
) {
	if (
		admin.first_name
	) {
		return admin.first_name;
	}

	if (
		admin.username
	) {
		return `@${admin.username}`;
	}

	return admin.user_id;
}

async function showAdmins(
	env,
	message,
	currentAdmin,
) {
	const admins =
		await getAdmins(
			env,
		);

	const lines = [
		"<b>👥 مدیریت ادمین‌ها</b>",
		"",
		`👑 مالک: <code>${escapeHtml(
			getOwnerId(env),
		)}</code>`,
		"",
	];

	if (
		!admins.length
	) {
		lines.push(
			"هنوز ادمینی اضافه نشده است.",
		);
	} else {
		admins.forEach(
			(
				item,
				index,
			) => {
				lines.push(
					`${Number(item.is_active) === 1 ? "🟢" : "⚪"} ${index + 1}. <b>${escapeHtml(
						getAdminDisplayName(
							item,
						),
					)}</b>`,
				);
			},
		);
	}

	lines.push(
		"",
		buildNote(
			currentAdmin.role ===
				"owner"
				? "مالک می‌تواند ادمین جدید اضافه کند یا وضعیت ادمین‌های فعلی را تغییر دهد."
				: "این بخش برای ادمین‌های عادی فقط خواندنی است.",
		),
	);

	const keyboard = [];

	if (
		currentAdmin.role ===
			"owner"
	) {
		for (
			const item
			of admins
		) {
			keyboard.push([
				{
					text:
						`${Number(item.is_active) === 1 ? "🟢" : "⚪"} ${getAdminDisplayName(
							item,
						)}`,

					callback_data:
						`admin:view:${item.user_id}`,
				},
			]);
		}

		keyboard.push([
			{
				text:
					"➕ افزودن ادمین",

				callback_data:
					"admins:add",
			},
		]);
	}

	keyboard.push([
		{
			text:
				"🔄 بروزرسانی",

			callback_data:
				"admins:refresh",
		},
	]);

	keyboard.push([
		{
			text:
				"⬅️ پنل مدیریت",

			callback_data:
				"menu:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		lines.join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

async function showAdminDetails(
	env,
	message,
	currentAdmin,
	targetId,
) {
	const target =
		await getAdmin(
			env,
			targetId,
		);

	if (!target) {
		await showAdmins(
			env,
			message,
			currentAdmin,
		);

		return;
	}

	const keyboard = [];

	if (
		currentAdmin.role ===
			"owner"
	) {
		keyboard.push([
			{
				text:
					Number(
						target.is_active,
					) === 1
						? "⏸ غیرفعال کردن"
						: "▶️ فعال کردن",

				callback_data:
					`admin:toggle:${target.user_id}`,
			},
		]);

		keyboard.push([
			{
				text:
					"🗑 حذف ادمین",

				callback_data:
					`admin:delete_confirm:${target.user_id}`,
			},
		]);
	}

	keyboard.push([
		{
			text:
				"⬅️ مدیریت ادمین‌ها",

			callback_data:
				"admins:home",
		},
	]);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>👤 اطلاعات ادمین</b>",
			"",
			`وضعیت: ${
				Number(
					target.is_active,
				) === 1
					? "🟢 فعال"
					: "⚪ غیرفعال"
			}`,
			"",
			`نام: <b>${escapeHtml(
				getAdminDisplayName(
					target,
				),
			)}</b>`,
			`شناسه: <code>${escapeHtml(
				target.user_id,
			)}</code>`,
			"",
			buildNote(
				"غیرفعال کردن، دسترسی ادمین را قطع می‌کند ولی رکورد او را حذف نمی‌کند.",
			),
		].join("\n"),
		{
			inline_keyboard:
				keyboard,
		},
	);
}

async function beginAddAdmin(
	env,
	message,
	ownerId,
) {
	await setAdminInputState(
		env,
		ownerId,
		"add_admin",
		{
			panelChatId:
				message.chat.id,

			panelMessageId:
				message.message_id,
		},
	);

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>➕ افزودن ادمین</b>",
			"",
			"Telegram User ID ادمین را ارسال کن.",
			"",
			buildNote(
				"کاربر می‌تواند با دستور /id شناسه عددی خودش را مشاهده کند.",
			),
		].join("\n"),
		backKeyboard(
			"مدیریت ادمین‌ها",
			"admins:home",
		),
	);
}

async function handleAddAdminInput(
	env,
	message,
	currentAdmin,
	inputState,
) {
	if (
		currentAdmin.role !==
			"owner"
	) {
		return;
	}

	if (
		Date.now() -
			Number(
				inputState.updated_at,
			) >
		ADMIN_INPUT_TTL_MS
	) {
		await clearAdminInputState(
			env,
			message.from.id,
		);

		return;
	}

	const payload =
		parseJson(
			inputState.payload,
			{},
		);

	const targetId =
		normalizeDigits(
			message.text,
		).trim();

	await tryDeleteMessage(
		env,
		message.chat.id,
		message.message_id,
	);

	if (
		!/^\d{4,20}$/.test(
			targetId,
		)
	) {
		await editTelegramMessage(
			env,
			payload.panelChatId,
			payload.panelMessageId,
			[
				"<b>❌ شناسه نامعتبر</b>",
				"",
				"فقط Telegram User ID عددی ارسال کن.",
			].join("\n"),
			backKeyboard(
				"مدیریت ادمین‌ها",
				"admins:home",
			),
		);

		return;
	}

	const now =
		Date.now();

	await env.DB
		.prepare(`
			INSERT INTO admins (
				user_id,
				username,
				first_name,
				last_name,
				is_active,
				added_by,
				created_at,
				updated_at
			)

			VALUES (?, NULL, NULL, NULL, 1, ?, ?, ?)

			ON CONFLICT(user_id)
			DO UPDATE SET
				is_active = 1,
				updated_at = excluded.updated_at
		`)
		.bind(
			targetId,
			String(
				message.from.id,
			),
			now,
			now,
		)
		.run();

	await addAuditLog(
		env,
		message.from.id,
		"admin.added",
		{
			targetId,
		},
	);

	await clearAdminInputState(
		env,
		message.from.id,
	);

	await showAdmins(
		env,
		{
			chat: {
				id:
					Number(
						payload.panelChatId,
					),
			},

			message_id:
				Number(
					payload.panelMessageId,
				),
		},
		currentAdmin,
	);
}

async function toggleAdminActive(
	env,
	targetId,
	ownerId,
) {
	const target =
		await getAdmin(
			env,
			targetId,
		);

	if (!target) {
		return;
	}

	const next =
		Number(
			target.is_active,
		) === 1
			? 0
			: 1;

	await env.DB
		.prepare(`
			UPDATE admins
			SET
				is_active = ?,
				updated_at = ?
			WHERE user_id = ?
		`)
		.bind(
			next,
			Date.now(),
			String(targetId),
		)
		.run();

	await addAuditLog(
		env,
		ownerId,
		next
			? "admin.enabled"
			: "admin.disabled",
		{
			targetId,
		},
	);
}

async function showDeleteAdminConfirmation(
	env,
	message,
	targetId,
) {
	const target =
		await getAdmin(
			env,
			targetId,
		);

	if (!target) {
		return;
	}

	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		[
			"<b>🗑 حذف ادمین</b>",
			"",
			`آیا از حذف <b>${escapeHtml(
				getAdminDisplayName(
					target,
				),
			)}</b> مطمئن هستی؟`,
			"",
			buildNote(
				"این عملیات رکورد ادمین را از D1 حذف می‌کند.",
			),
		].join("\n"),
		{
			inline_keyboard: [
				[
					{
						text:
							"🗑 بله، حذف شود",

						callback_data:
							`admin:delete:${target.user_id}`,
					},
				],

				[
					{
						text:
							"⬅️ انصراف",

						callback_data:
							`admin:view:${target.user_id}`,
					},
				],
			],
		},
	);
}

async function deleteAdmin(
	env,
	targetId,
) {
	await env.DB
		.prepare(`
			DELETE FROM admins
			WHERE user_id = ?
		`)
		.bind(
			String(targetId),
		)
		.run();
}

async function getAdminStats(
	env,
) {
	const result =
		await env.DB
			.prepare(`
				SELECT
					COUNT(*) AS total,

					SUM(
						CASE
							WHEN is_active = 1
							THEN 1
							ELSE 0
						END
					) AS active,

					SUM(
						CASE
							WHEN is_active = 0
							THEN 1
							ELSE 0
						END
					) AS inactive

				FROM admins
			`)
			.first();

	return {
		total:
			Number(
				result?.total ??
					0,
			),

		active:
			Number(
				result?.active ??
					0,
			),

		inactive:
			Number(
				result?.inactive ??
					0,
			),
	};
}

/* ============================================================
 * INPUT STATE
 * ============================================================
 */

async function setAdminInputState(
	env,
	userId,
	action,
	payload = null,
) {
	const now =
		Date.now();

	await env.DB
		.prepare(`
			INSERT INTO admin_input_state (
				telegram_user_id,
				action,
				payload,
				created_at,
				updated_at
			)

			VALUES (?, ?, ?, ?, ?)

			ON CONFLICT(telegram_user_id)
			DO UPDATE SET
				action = excluded.action,
				payload = excluded.payload,
				updated_at = excluded.updated_at
		`)
		.bind(
			String(userId),
			action,

			payload
				? JSON.stringify(
					payload,
				)
				: null,

			now,
			now,
		)
		.run();
}

async function getAdminInputState(
	env,
	userId,
) {
	return env.DB
		.prepare(`
			SELECT *
			FROM admin_input_state
			WHERE telegram_user_id = ?
			LIMIT 1
		`)
		.bind(
			String(userId),
		)
		.first();
}

async function clearAdminInputState(
	env,
	userId,
) {
	await env.DB
		.prepare(`
			DELETE FROM admin_input_state
			WHERE telegram_user_id = ?
		`)
		.bind(
			String(userId),
		)
		.run();
}

/* ============================================================
 * DISABLED
 * ============================================================
 */

function buildDisabledText(
	env,
	admin,
) {
	return [
		`<b>⏸ ${escapeHtml(
			getBotDisplayName(env),
		)}</b>`,
		"",
		"<blockquote>" +
			`🔐 ${escapeHtml(
				getRoleLabel(admin),
			)}` +
			"\n" +
			"🔴 ربات غیرفعال" +
			"</blockquote>",
		"",
		buildNote(
			"در حالت غیرفعال، Cron و انتشار بازار اجرا نمی‌شوند.",
		),
	].join("\n");
}

function disabledKeyboard(
	admin,
) {
	if (
		admin.role !==
			"owner"
	) {
		return {
			inline_keyboard:
				[],
		};
	}

	return {
		inline_keyboard: [
			[
				{
					text:
						"▶️ فعال کردن ربات",

					callback_data:
						"global:enable",
				},
			],
		],
	};
}

async function sendDisabledScreen(
	env,
	chatId,
	admin,
) {
	await sendTelegramMessage(
		env,
		chatId,
		buildDisabledText(
			env,
			admin,
		),
		disabledKeyboard(
			admin,
		),
	);
}

async function showDisabledScreen(
	env,
	message,
	admin,
) {
	await editTelegramMessage(
		env,
		message.chat.id,
		message.message_id,
		buildDisabledText(
			env,
			admin,
		),
		disabledKeyboard(
			admin,
		),
	);
}

async function sendAccessDenied(
	env,
	chatId,
) {
	await sendTelegramMessage(
		env,
		chatId,
		[
			"<b>⛔️ دسترسی غیرمجاز</b>",
			"",
			"شما اجازه استفاده از این ربات را ندارید.",
		].join("\n"),
	);
}

/* ============================================================
 * PUBLIC API
 * ============================================================
 */

async function handleRootApi(
	env,
) {
	return jsonResponse({
		success:
			true,

		service:
			env.APP_NAME ??
				APP.name,

		version:
			getVersion(env),

		api_version:
			APP.apiVersion,

		endpoints: {
			market:
				"/api/v1/market",

			assets:
				"/api/v1/assets",

			sources:
				"/api/v1/sources",

			usdt:
				"/api/v1/sources/usdt",

			automation:
				"/api/v1/automation",

			system:
				"/api/v1/system",

			database:
				"/api/v1/system/database",
		},
	});
}

async function handleMarketApi(
	env,
) {
	const snapshot =
		await getMarketSnapshot(
			env,
		);

	return jsonResponse({
		success:
			true,

		data:
			serializeMarketSnapshot(
				env,
				snapshot,
			),
	});
}

async function handleAssetsApi(
	env,
) {
	const result =
		await fetchCoinGeckoTopAssets(
			env,
		);

	if (!result.success) {
		const stored =
			await getStoredCoinGeckoAssets(
				env,
			);

		return jsonResponse({
			success:
				true,

			data: {
				live:
					false,

				count:
					stored.length,

				enabled_count:
					stored.filter(
						(item) =>
							item.enabled,
					).length,

				assets:
					stored,
			},
		});
	}

	await syncCoinGeckoAssets(
		env,
		result.assets,
	);

	const map =
		await getCoinGeckoAssetMap(
			env,
		);

	const assets =
		result.assets.map(
			(asset) => ({
				id:
					asset.id,

				name:
					asset.name,

				name_fa:
					getPersianCoinName(
						asset.id,
						asset.name,
					),

				symbol:
					asset.symbol,

				market_cap_rank:
					asset.market_cap_rank,

				price_usd:
					asset.price,

				change_24h_percent:
					asset.change24h,

				enabled:
					Number(
						map[
							asset.id
						]?.is_enabled ??
							0,
					) === 1,
			}),
		);

	return jsonResponse({
		success:
			true,

		data: {
			live:
				true,

			count:
				assets.length,

			enabled_count:
				assets.filter(
					(item) =>
						item.enabled,
				).length,

			assets,
		},
	});
}

async function handleSourcesApi(
	env,
) {
	const sources =
		await checkAllSources(
			env,
			true,
		);

	const usdt =
		resolveUsdtFromChecks(
			sources,
		);

	return jsonResponse({
		success:
			true,

		data: {
			usdt: {
				selected_source:
					usdt.success
						? usdt.sourceLabel
						: null,

				price_toman:
					usdt.success
						? usdt.price
						: null,

				priority: [
					"Wallex",
					"Tabdeal",
					"Exir",
				],

				providers: {
					wallex:
						serializeSourceStatus(
							sources.wallex,
						),

					tabdeal:
						serializeSourceStatus(
							sources.tabdeal,
						),

					exir:
						serializeSourceStatus(
							sources.exir,
						),
				},
			},

			crypto: {
				coingecko:
					serializeSourceStatus(
						sources.coingecko,
					),
			},

			metals: {
				wallgold:
					serializeSourceStatus(
						sources.wallgold,
					),

				coingecko:
					serializeSourceStatus(
						sources.coingecko,
					),
			},
		},
	});
}

async function handleUsdtApi(
	env,
) {
	const result =
		await resolveUsdtToman(
			env,
			true,
		);

	return jsonResponse({
		success:
			true,

		data: {
			available:
				result.success,

			price_toman:
				result.success
					? result.price
					: null,

			source:
				result.success
					? result.sourceLabel
					: null,

			source_key:
				result.success
					? result.source
					: null,

			fallback_level:
				result.success
					? result.fallbackLevel
					: null,

			latency_ms:
				result.success
					? result.latency
					: null,

			priority: [
				"Wallex",
				"Tabdeal",
				"Exir",
			],
		},
	});
}

async function handleAutomationApi(
	env,
) {
	const automation =
		await getAutomationSettings(
			env,
		);

	const next =
		calculateNextPublishAt(
			env,
			automation,
		);

	return jsonResponse({
		success:
			true,

		data: {
			enabled:
				automation.enabled,

			interval_minutes:
				automation.intervalMinutes,

			quiet_hours: {
				enabled:
					automation
						.quietHours
						.enabled,

				start:
					automation
						.quietHours
						.start,

				end:
					automation
						.quietHours
						.end,
			},

			last_run_at:
				automation.lastRunAt
					? new Date(
						automation.lastRunAt,
					).toISOString()
					: null,

			last_success_at:
				automation.lastSuccessAt
					? new Date(
						automation.lastSuccessAt,
					).toISOString()
					: null,

			next_run_at:
				next
					? new Date(
						next,
					).toISOString()
					: null,

			last_error:
				automation.lastError ||
					null,

			timezone:
				getTimezone(env),
		},
	});
}

async function handleSystemApi(
	env,
) {
	const [
		enabled,
		database,
		adminStats,
		automation,
	] = await Promise.all([
		getGlobalEnabled(env),
		getDatabaseStatus(env),
		getAdminStats(env),
		getAutomationSettings(env),
	]);

	return jsonResponse({
		success:
			true,

		data: {
			service:
				env.APP_NAME ??
					APP.name,

			version:
				getVersion(env),

			api_version:
				APP.apiVersion,

			timezone:
				getTimezone(env),

			enabled,

			automation: {
				enabled:
					automation.enabled,

				interval_minutes:
					automation.intervalMinutes,

				quiet_hours_enabled:
					automation
						.quietHours
						.enabled,
			},

			database: {
				connected:
					database.connected,

				provider:
					database.provider,

				latency_ms:
					database.latencyMs,
			},

			admins:
				adminStats,
		},
	});
}

async function handleDatabaseApi(
	env,
) {
	const [
		database,
		storage,
		stats,
	] = await Promise.all([
		getDatabaseStatus(env),
		getD1StorageUsage(env),
		getDatabaseStats(env),
	]);

	return jsonResponse({
		success:
			database.connected,

		data: {
			connected:
				database.connected,

			provider:
				database.provider,

			latency_ms:
				database.latencyMs,

			storage,

			records:
				stats,

			schema_version:
				APP.schemaVersion,
		},
	});
}

function serializeMarketSnapshot(
	env,
	snapshot,
) {
	return {
		generated_at:
			new Date(
				snapshot.createdAt,
			).toISOString(),

		timezone:
			getTimezone(env),

		date:
			formatIranDate(
				env,
				snapshot.createdAt,
			),

		time:
			formatIranTime(
				env,
				snapshot.createdAt,
			),

		partial:
			snapshot.partial,

		errors:
			snapshot.errors,

		usdt: {
			available:
				snapshot.usdt.price !==
					null,

			price_toman:
				snapshot.usdt.price,

			source:
				snapshot.usdt.source,

			fallback_level:
				snapshot.usdt
					.fallbackLevel,
		},

		crypto:
			snapshot.crypto.map(
				(item) => ({
					id:
						item.id,

					name:
						item.name,

					name_fa:
						getPersianCoinName(
							item.id,
							item.name,
						),

					symbol:
						item.symbol,

					available:
						item.price !==
							null,

					price_usd:
						item.price,

					change_24h_percent:
						item.change24h,

					market_cap_rank:
						item.marketCapRank,
				}),
			),

		metals: {
			gram_18_toman:
				snapshot.metals
					.gram18,

			mazaneh_toman:
				snapshot.metals
					.mazaneh,

			gold_usd:
				snapshot.metals
					.gold,

			silver_usd:
				snapshot.metals
					.silver,
		},
	};
}

/* ============================================================
 * AUDIT
 * ============================================================
 */

async function addAuditLog(
	env,
	userId,
	action,
	data = null,
) {
	try {
		await env.DB
			.prepare(`
				INSERT INTO audit_logs (
					telegram_user_id,
					action,
					data,
					created_at
				)

				VALUES (?, ?, ?, ?)
			`)
			.bind(
				String(userId),

				action,

				data
					? JSON.stringify(
						data,
					)
					: null,

				Date.now(),
			)
			.run();
	} catch (error) {
		console.error(
			"audit.error",
			errorMessage(error),
		);
	}
}

/* ============================================================
 * TELEGRAM API
 * ============================================================
 */

async function telegramApi(
	env,
	method,
	payload = {},
) {
	if (
		!env.TELEGRAM_BOT_TOKEN
	) {
		throw new Error(
			"TELEGRAM_BOT_TOKEN is missing",
		);
	}

	const response =
		await fetchWithTimeout(
			`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
			{
				method:
					"POST",

				headers: {
					"Content-Type":
						"application/json",
				},

				body:
					JSON.stringify(
						payload,
					),
			},
			10000,
		);

	const data =
		await response.json();

	if (
		!response.ok ||
		!data.ok
	) {
		const description =
			data?.description ??
				`HTTP ${response.status}`;

		if (
			method ===
				"editMessageText" &&
			String(
				description,
			)
				.toLowerCase()
				.includes(
					"message is not modified",
				)
		) {
			return null;
		}

		throw new Error(
			description,
		);
	}

	return data.result;
}

async function sendTelegramMessage(
	env,
	chatId,
	text,
	replyMarkup = null,
) {
	return telegramApi(
		env,
		"sendMessage",
		{
			chat_id:
				chatId,

			text,

			parse_mode:
				"HTML",

			disable_web_page_preview:
				true,

			...(replyMarkup
				? {
					reply_markup:
						replyMarkup,
				}
				: {}),
		},
	);
}

async function editTelegramMessage(
	env,
	chatId,
	messageId,
	text,
	replyMarkup = null,
) {
	return telegramApi(
		env,
		"editMessageText",
		{
			chat_id:
				chatId,

			message_id:
				Number(
					messageId,
				),

			text,

			parse_mode:
				"HTML",

			disable_web_page_preview:
				true,

			...(replyMarkup
				? {
					reply_markup:
						replyMarkup,
				}
				: {}),
		},
	);
}

async function safeAnswerCallbackQuery(
	env,
	id,
	text = undefined,
	showAlert = false,
) {
	try {
		await telegramApi(
			env,
			"answerCallbackQuery",
			{
				callback_query_id:
					id,

				...(text
					? {
						text,
					}
					: {}),

				show_alert:
					showAlert,
			},
		);
	} catch {
		// Ignore expired callback.
	}
}

async function tryDeleteMessage(
	env,
	chatId,
	messageId,
) {
	try {
		await telegramApi(
			env,
			"deleteMessage",
			{
				chat_id:
					chatId,

				message_id:
					messageId,
			},
		);
	} catch {
		// Ignore.
	}
}

function backKeyboard(
	label,
	callback,
) {
	return {
		inline_keyboard: [
			[
				{
					text:
						`⬅️ ${label}`,

					callback_data:
						callback,
				},
			],
		],
	};
}

/* ============================================================
 * SOURCE HELPERS
 * ============================================================
 */

function sourceLabel(
	source,
) {
	switch (source) {
		case "wallex":
			return "Wallex";

		case "tabdeal":
			return "Tabdeal";

		case "exir":
			return "Exir";

		case "coingecko":
			return "CoinGecko";

		case "wallgold":
			return "WallGold";

		default:
			return source;
	}
}

function sourceError(
	message,
) {
	return {
		success:
			false,

		latency:
			0,

		message,
	};
}

function sourceCatchError(
	error,
	startedAt,
) {
	return {
		success:
			false,

		latency:
			Date.now() -
				startedAt,

		message:
			errorMessage(error),
	};
}

async function sourceHttpError(
	response,
	latency,
) {
	const body =
		await safeReadResponseText(
			response,
		);

	return {
		success:
			false,

		status:
			response.status,

		latency,

		message:
			createHttpErrorMessage(
				response.status,
				body,
			),
	};
}

async function createSourceHttpError(
	response,
) {
	const body =
		await safeReadResponseText(
			response,
		);

	return createHttpErrorMessage(
		response.status,
		body,
	);
}

/* ============================================================
 * HTTP
 * ============================================================
 */

async function fetchWithTimeout(
	url,
	options = {},
	timeout = 8000,
) {
	const controller =
		new AbortController();

	const timer =
		setTimeout(
			() =>
				controller.abort(),
			timeout,
		);

	try {
		return await fetch(
			url,
			{
				...options,

				signal:
					controller.signal,
			},
		);
	} finally {
		clearTimeout(
			timer,
		);
	}
}

async function safeReadResponseText(
	response,
) {
	try {
		return (
			await response.text()
		).slice(
			0,
			300,
		);
	} catch {
		return "";
	}
}

/* ============================================================
 * GENERAL HELPERS
 * ============================================================
 */

function rtlLine(
	value,
) {
	const text = String(
		value ?? "",
	);

	if (!text) {
		return "";
	}

	return `\u200F${text}`;
}

function buildNote(
	text,
) {
	return `<blockquote>ℹ️ ${escapeHtml(
		text,
	)}</blockquote>`;
}

function buildTimeString(
	hour,
	minute,
) {
	return `${pad2(
		hour,
	)}:${pad2(
		minute,
	)}`;
}

function pad2(
	value,
) {
	return String(
		Number(value),
	).padStart(
		2,
		"0",
	);
}

function isValidTimeString(
	value,
) {
	return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(
		String(value),
	);
}

function timeStringToMinutes(
	value,
) {
	if (
		!isValidTimeString(
			value,
		)
	) {
		return null;
	}

	const [
		hour,
		minute,
	] = value
		.split(":")
		.map(Number);

	return (
		hour * 60 +
		minute
	);
}

function getTimeMinutesInTimezone(
	env,
	timestamp,
) {
	const parts =
		new Intl.DateTimeFormat(
			"en-US",
			{
				timeZone:
					getTimezone(env),

				hour:
					"2-digit",

				minute:
					"2-digit",

				hour12:
					false,
			},
		).formatToParts(
			new Date(
				timestamp,
			),
		);

	const hour =
		Number(
			parts.find(
				(item) =>
					item.type ===
						"hour",
			)?.value ??
				0,
		) % 24;

	const minute =
		Number(
			parts.find(
				(item) =>
					item.type ===
						"minute",
			)?.value ??
				0,
		);

	return (
		hour * 60 +
		minute
	);
}

function getVersion(
	env,
) {
	return String(
		env.APP_VERSION ??
			APP.version,
	);
}

function getTimezone(
	env,
) {
	return String(
		env.TIMEZONE ??
			"Asia/Tehran",
	);
}

function getChannelHandle(
	env,
) {
	const explicit =
		String(
			env.TELEGRAM_CHANNEL_HANDLE ??
				"",
		).trim();

	if (explicit) {
		return explicit;
	}

	const channelId =
		String(
			env.TELEGRAM_CHANNEL_ID ??
				"",
		).trim();

	return channelId.startsWith(
		"@",
	)
		? channelId
		: "";
}

function getPersianCoinName(
	coinId,
	fallbackName = "",
) {
	return (
		COIN_NAMES_FA[
			coinId
		] ||
		fallbackName ||
		coinId
	);
}

function normalizeCommand(
	text,
) {
	return String(text)
		.split(/\s+/)[0]
		.toLowerCase()
		.replace(
			/@[\w_]+$/,
			"",
		);
}

function parseBoolean(
	value,
) {
	return [
		"1",
		"true",
		"yes",
		"on",
	].includes(
		String(value)
			.trim()
			.toLowerCase(),
	);
}

function normalizeTimestamp(
	value,
) {
	const number =
		Number(value);

	return (
		Number.isFinite(
			number,
		) &&
		number > 0
			? number
			: 0
	);
}

function toNullableNumber(
	value,
) {
	if (
		value === null ||
		value === undefined ||
		value === ""
	) {
		return null;
	}

	const number =
		Number(value);

	return (
		Number.isFinite(
			number,
		)
			? number
			: null
	);
}

function normalizeDigits(
	value,
) {
	const persian =
		"۰۱۲۳۴۵۶۷۸۹";

	const arabic =
		"٠١٢٣٤٥٦٧٨٩";

	return String(value)
		.replace(
			/[۰-۹]/g,
			(char) =>
				String(
					persian.indexOf(
						char,
					),
				),
		)
		.replace(
			/[٠-٩]/g,
			(char) =>
				String(
					arabic.indexOf(
						char,
					),
				),
		);
}

function toFaDigits(
	value,
) {
	return String(value)
		.replace(
			/\d/g,
			(digit) =>
				"۰۱۲۳۴۵۶۷۸۹"[
					Number(digit)
				],
		);
}

/* ============================================================
 * MARKET FORMATTERS
 * ============================================================
 */

function formatFaInteger(
	value,
) {
	const formatted =
		Math.round(
			Number(value),
		).toLocaleString(
			"en-US",
		);

	return toFaDigits(
		formatted.replaceAll(
			",",
			"٬",
		),
	);
}

function formatFaPrice(
	value,
) {
	const number =
		Number(value);

	const formatted =
		number.toLocaleString(
			"en-US",
			{
				maximumFractionDigits:
					number >= 1000
						? 2
						: 4,

				minimumFractionDigits:
					0,
			},
		);

	return toFaDigits(
		formatted
			.replaceAll(
				",",
				"٬",
			)
			.replaceAll(
				".",
				"٫",
			),
	);
}

/**
 * Price change UI:
 *
 * Positive -> 🟢
 * Negative -> 🔴
 * Zero     -> ⚪
 */
function formatChangeIcon(
	value,
) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return "⚪";
	}

	if (number > 0) {
		return "🟢";
	}

	if (number < 0) {
		return "🔴";
	}

	return "⚪";
}

function formatFaChangeValue(
	value,
) {
	const number = Number(value);

	if (!Number.isFinite(number)) {
		return "<b>نامشخص</b>";
	}

	const amount =
		toFaDigits(
			Math.abs(number)
				.toFixed(2)
				.replace(".", "٫"),
		);

	if (number > 0) {
		return `<b>+${amount}٪</b>`;
	}

	if (number < 0) {
		return `<b>−${amount}٪</b>`;
	}

	return "<b>۰٫۰۰٪</b>";
}

function formatOptionalToman(
	value,
) {
	if (
		value === null ||
		value === undefined
	) {
		return "<b>نامشخص</b>";
	}

	return `<b>${formatFaInteger(
		value,
	)} تومان</b>`;
}

function formatOptionalUsd(
	value,
) {
	if (
		value === null ||
		value === undefined
	) {
		return "<b>نامشخص</b>";
	}

	return `<b>${formatFaPrice(
		value,
	)} دلار</b>`;
}

/* ============================================================
 * DATE / TIME
 * ============================================================
 */

function formatIranDate(
	env,
	timestamp,
) {
	return new Intl.DateTimeFormat(
		"fa-IR",
		{
			timeZone:
				getTimezone(env),

			year:
				"numeric",

			month:
				"2-digit",

			day:
				"2-digit",
		},
	).format(
		new Date(
			timestamp,
		),
	);
}

function formatIranTime(
	env,
	timestamp,
) {
	return new Intl.DateTimeFormat(
		"fa-IR",
		{
			timeZone:
				getTimezone(env),

			hour:
				"2-digit",

			minute:
				"2-digit",

			hour12:
				false,
		},
	).format(
		new Date(
			timestamp,
		),
	);
}

function formatSystemDate(
	env,
	timestamp,
) {
	return new Intl.DateTimeFormat(
		"en-CA",
		{
			timeZone:
				getTimezone(env),

			year:
				"numeric",

			month:
				"2-digit",

			day:
				"2-digit",
		},
	).format(
		new Date(
			timestamp,
		),
	);
}

function formatSystemTime(
	env,
	timestamp,
) {
	return new Intl.DateTimeFormat(
		"en-GB",
		{
			timeZone:
				getTimezone(env),

			hour:
				"2-digit",

			minute:
				"2-digit",

			hour12:
				false,
		},
	).format(
		new Date(
			timestamp,
		),
	);
}

function formatSystemDateTime(
	env,
	timestamp,
) {
	return `${formatSystemDate(
		env,
		timestamp,
	)} · ${formatSystemTime(
		env,
		timestamp,
	)}`;
}

function formatOptionalSystemDateTime(
	env,
	timestamp,
) {
	if (!timestamp) {
		return "هنوز انجام نشده";
	}

	return formatSystemDateTime(
		env,
		timestamp,
	);
}

/* ============================================================
 * MISC
 * ============================================================
 */

function roundToNearest(
	value,
	step,
) {
	return (
		Math.round(
			Number(value) /
				Number(step),
		) *
		Number(step)
	);
}

function roundNumber(
	value,
	decimals = 2,
) {
	const factor =
		10 ** decimals;

	return (
		Math.round(
			Number(value) *
				factor,
		) /
		factor
	);
}

function formatBytes(
	bytes,
) {
	const value =
		Number(
			bytes ??
				0,
		);

	if (
		value < 1024
	) {
		return `${value} B`;
	}

	if (
		value <
		1024 *
			1024
	) {
		return `${(
			value /
				1024
		).toFixed(
			2,
		)} KB`;
	}

	if (
		value <
		1024 *
			1024 *
			1024
	) {
		return `${(
			value /
			(
				1024 *
					1024
			)
		).toFixed(
			2,
		)} MB`;
	}

	return `${(
		value /
		(
			1024 *
				1024 *
				1024
		)
	).toFixed(
		2,
	)} GB`;
}

function parseJson(
	value,
	fallback,
) {
	try {
		return JSON.parse(
			String(value),
		);
	} catch {
		return fallback;
	}
}

function createHttpErrorMessage(
	status,
	body = "",
) {
	const value =
		String(body)
			.replace(
				/\s+/g,
				" ",
			)
			.trim()
			.slice(
				0,
				180,
			);

	return value
		? `HTTP ${status}: ${value}`
		: `HTTP ${status}`;
}

function errorMessage(
	error,
) {
	if (
		error instanceof Error
	) {
		if (
			error.name ===
				"AbortError"
		) {
			return "Request timeout";
		}

		return error.message;
	}

	return String(error);
}

function escapeHtml(
	value,
) {
	return String(value)
		.replaceAll(
			"&",
			"&amp;",
		)
		.replaceAll(
			"<",
			"&lt;",
		)
		.replaceAll(
			">",
			"&gt;",
		)
		.replaceAll(
			'"',
			"&quot;",
		);
}

/* ============================================================
 * RESPONSES
 * ============================================================
 */

function jsonResponse(
	data,
	status = 200,
) {
	return new Response(
		JSON.stringify(
			data,
			null,
			2,
		),
		{
			status,

			headers: {
				"Content-Type":
					"application/json; charset=utf-8",

				"Cache-Control":
					"no-store",

				"Access-Control-Allow-Origin":
					"*",

				"Access-Control-Allow-Methods":
					"GET, POST, OPTIONS",

				"Access-Control-Allow-Headers":
					"Content-Type",
			},
		},
	);
}

function corsResponse() {
	return new Response(
		null,
		{
			status:
				204,

			headers: {
				"Access-Control-Allow-Origin":
					"*",

				"Access-Control-Allow-Methods":
					"GET, POST, OPTIONS",

				"Access-Control-Allow-Headers":
					"Content-Type",

				"Access-Control-Max-Age":
					"86400",
			},
		},
	);
}
