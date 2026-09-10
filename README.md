# DRD Rate Manager

A serverless Telegram market-management and publishing bot built on **Cloudflare Workers + D1**.

DRD Rate Manager collects market data from multiple sources, provides an admin-only Telegram control panel, publishes formatted market updates to a Telegram channel, and can automatically publish on a configurable schedule.

Current documented version: **0.9.1**

---

## Overview

DRD Rate Manager is designed for Telegram channels that publish market-rate updates and need a lightweight, always-on backend without maintaining a traditional server.

The project runs as a single Cloudflare Worker and uses Cloudflare D1 for persistent configuration and admin data. Telegram is used as the entire management interface.

### Main features

- Telegram admin panel with inline keyboards
- Owner + admin access model
- Same-message navigation with `editMessageText`
- Telegram command menu button
- `/start`, `/menu`, `/help`, `/id`
- USDT/Toman price with fallback sources
- Dynamic CoinGecko asset selection
- 24-hour cryptocurrency price changes
- Iranian 18K gold price
- Mazaneh calculation derived from 18K gold
- Gold and silver USD reference prices
- Manual market preview
- Manual publish
- Automatic publishing
- Publish interval from 5 to 60 minutes in 5-minute steps
- Default publish interval: 10 minutes
- Button-based Quiet Hours configuration
- Partial publishing when one or more market sources fail
- D1 database health and storage monitor
- Public read-only market/system API
- Tehran timezone support by default
- Cloudflare Cron Trigger integration

---

## Architecture

```text
Telegram User
    │
    ▼
Telegram Bot API
    │
    ▼
Cloudflare Worker
    │
    ├── Telegram Admin UI
    ├── Public REST API
    ├── Cron / Auto Publish
    ├── Market Data Aggregation
    │     ├── Wallex
    │     ├── Tabdeal
    │     ├── Exir
    │     ├── CoinGecko
    │     └── WallGold
    │
    └── Cloudflare D1
          ├── Settings
          ├── Admins
          ├── Source Status
          ├── CoinGecko Assets
          ├── Input State
          └── Audit Logs
```

The Worker contains both an HTTP `fetch()` handler and a scheduled `scheduled()` handler.

---

## Market Data Sources

### USDT / Toman

USDT uses a strict fallback chain:

```text
Wallex  →  Tabdeal  →  Exir
Primary    Fallback #1   Fallback #2
```

The system always tries Wallex first. If it fails or returns an invalid value, Tabdeal is checked. If Tabdeal also fails, Exir is used.

Configured endpoints:

```text
Wallex
https://api.wallex.ir/hector/web/v1/markets

Tabdeal
https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1

Exir
https://api.exir.io/v2/orderbook?symbol=usdt-irt
```

### Cryptocurrency prices

CoinGecko is used for:

- selected cryptocurrency prices in USD
- 24-hour percentage change
- market-cap ranking
- dynamic top-N asset list

The bot stores enabled/disabled crypto selections in D1.

### Iranian gold

WallGold is used for the Iranian 18K gold gram price.

Default endpoint:

```text
https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN
```

### Mazaneh

Mazaneh is calculated locally from the 18K gold gram price.

Formula:

```text
Mazaneh = Gram18 × 4.6083 × (705 / 750)
```

Approximate multiplier:

```text
4.331802
```

No separate Mazaneh API is required.

### Global gold and silver

CoinGecko proxy assets are currently used for global gold/silver references:

```text
tether-gold
kinesis-silver
```

These should be treated as market proxies and not guaranteed exact XAU/XAG spot feeds.

---

## Telegram Bot Interface

### Supported commands

| Command | Description |
|---|---|
| `/start` | Start the bot and open the entry screen |
| `/menu` | Show the management panel |
| `/help` | Show the complete bot help page |
| `/id` | Show the current Telegram User ID |

The Worker also configures Telegram's chat menu button to display the bot commands next to the message input field.

### Main menu

```text
[ 📈 مدیریت بازار ]

[ 📡 مدیریت منابع ] [ 👥 مدیریت ادمین‌ها ]

[ ⚙️ تنظیمات ] [ ❓ راهنما ]
```

### Market manager

The Market Manager displays:

- current data readiness
- last market refresh time
- USDT/Toman
- enabled cryptocurrencies
- 24-hour crypto changes
- 18K gold
- Mazaneh
- global gold
- silver
- automation status
- publish interval
- quiet-hours status
- next automatic publish time

Price-change indicators use:

```text
🟢 Positive
🔴 Negative
⚪ No change
```

### Market post structure

Published posts are split into three visually separated sections:

```text
💵 تتر


🪙 رمزارزها


🥇 طلا و فلزات
```

The channel signature is rendered inside a Telegram quote block at the end of the post.

---

## Automatic Publishing

Automatic publishing is controlled from D1 settings.

### Available intervals

```text
5
10
15
20
25
30
35
40
45
50
55
60 minutes
```

Default:

```text
10 minutes
```

Cloudflare Cron itself should run every minute:

```cron
* * * * *
```

The Worker wakes every minute, checks the configured publish interval, checks Quiet Hours, and publishes only when the post is due.

### Quiet Hours

Quiet Hours are configured entirely through Telegram buttons.

The selection flow is:

```text
Start hour
→ Start minute
→ End hour
→ End minute
→ Save
```

Minute options:

```text
00 / 15 / 30 / 45
```

Overnight ranges are supported, for example:

```text
23:00 → 08:00
```

During Quiet Hours, the Worker still receives cron events but skips automatic publishing.

---

## Partial Publishing

The bot is designed to keep publishing even if one data source is unavailable.

Examples:

- all USDT providers fail → USDT becomes `نامشخص`
- CoinGecko crypto request fails → selected cryptos remain visible but values become `نامشخص`
- WallGold fails → 18K gold and Mazaneh become `نامشخص`
- global metal lookup fails → gold/silver become `نامشخص`

A partial market snapshot does not block publication.

---

## D1 Database

The Worker automatically creates and repairs its required tables at runtime.

You do **not** need to manually create the application tables before the first request.

### Tables

#### `app_meta`

Stores internal metadata such as schema version.

#### `settings`

Stores bot and automation settings.

Important keys include:

```text
bot_enabled
auto_publish_enabled
publish_interval_minutes
quiet_hours_enabled
quiet_hours_start
quiet_hours_end
auto_publish_last_run_at
auto_publish_last_success_at
auto_publish_last_error
```

#### `admins`

Stores non-owner Telegram admins and active/inactive state.

The owner is not dependent on this table and is defined through `TELEGRAM_OWNER_ID`.

#### `source_status`

Stores the latest health result for market sources.

#### `admin_input_state`

Stores temporary admin-input workflows such as adding a Telegram admin.

#### `audit_logs`

Stores general system/admin audit events.

#### `coingecko_assets`

Stores discovered CoinGecko assets and enabled selections.

---

# Environment Variables

Copy `.env.example` and fill in your own values.

## Required Telegram variables

### `TELEGRAM_BOT_TOKEN`

Telegram bot token generated by BotFather.

Keep this secret.

### `TELEGRAM_WEBHOOK_SECRET`

A random secret used to verify incoming Telegram webhook requests through:

```text
X-Telegram-Bot-Api-Secret-Token
```

Generate a strong random value and keep it private.

### `TELEGRAM_OWNER_ID`

Numeric Telegram User ID of the bot owner.

The owner has full access to all settings and admin management.

### `TELEGRAM_CHANNEL_ID`

Telegram channel ID or public username used as the publish destination.

Example:

```text
@YourChannel
```

### `TELEGRAM_CHANNEL_HANDLE`

Channel handle shown in the published post signature.

Example:

```text
@YourChannel
```

### `BOT_DISPLAY_NAME`

Human-readable name displayed inside the Telegram bot UI.

---

## CoinGecko

### `COINGECKO_API_KEY`

CoinGecko API key.

The current Worker uses the CoinGecko Demo API header:

```text
x-cg-demo-api-key
```

### `COINGECKO_TOP_LIMIT`

Number of top market-cap assets available in the Telegram selector.

Recommended default:

```text
20
```

### `COINGECKO_DEFAULT_ASSETS`

Comma-separated CoinGecko IDs initially enabled when the asset table is empty.

Example:

```text
ethereum,solana,ripple
```

---

## Market source URLs

```text
WALLEX_API_URL
TABDEAL_API_URL
EXIR_API_URL
WALLGOLD_API_URL
```

Keeping these endpoints in environment variables makes it possible to change providers or URLs without editing application logic.

---

## Cloudflare database monitor

### `CLOUDFLARE_ACCOUNT_ID`

Your Cloudflare Account ID.

### `CLOUDFLARE_D1_DATABASE_ID`

D1 database UUID.

### `CLOUDFLARE_API_TOKEN`

Cloudflare API token used by the database monitor to retrieve D1 metadata/file size.

Keep this secret and grant only the minimum permissions required.

### `D1_DATABASE_LIMIT_MB`

Configured maximum database size used to calculate the visual storage percentage.

Example:

```text
500
```

This value is used by the UI progress indicator and is not itself an enforcement mechanism.

---

## Application variables

### `APP_NAME`

Example:

```text
DRD RATE MANAGER
```

### `APP_VERSION`

Current version:

```text
0.9.1
```

### `TIMEZONE`

Default:

```text
Asia/Tehran
```

Used for Telegram display time and Quiet Hours calculations.

---

# Public API

The Worker currently exposes read-only public GET endpoints plus the Telegram webhook endpoint.

API responses use JSON.

## `GET /`

Service information and endpoint discovery.

Example:

```json
{
  "success": true,
  "service": "DRD RATE MANAGER",
  "version": "0.9.1",
  "api_version": "v1",
  "endpoints": {
    "market": "/api/v1/market",
    "assets": "/api/v1/assets",
    "sources": "/api/v1/sources",
    "usdt": "/api/v1/sources/usdt",
    "automation": "/api/v1/automation",
    "system": "/api/v1/system",
    "database": "/api/v1/system/database"
  }
}
```

---

## `GET /api/v1/market`

Returns the current aggregated market snapshot.

Important fields:

```text
generated_at
timezone
date
time
partial
errors
usdt
crypto
metals
```

Example shape:

```json
{
  "success": true,
  "data": {
    "generated_at": "2026-09-10T10:15:00.000Z",
    "timezone": "Asia/Tehran",
    "date": "۱۴۰۵/۰۶/۱۹",
    "time": "۱۳:۴۵",
    "partial": false,
    "errors": [],
    "usdt": {
      "available": true,
      "price_toman": 234307,
      "source": "Wallex",
      "fallback_level": 0
    },
    "crypto": [
      {
        "id": "ethereum",
        "name": "Ethereum",
        "name_fa": "اتریوم",
        "symbol": "ETH",
        "available": true,
        "price_usd": 2473.5,
        "change_24h_percent": -1.52,
        "market_cap_rank": 2
      }
    ],
    "metals": {
      "gram_18_toman": 24311000,
      "mazaneh_toman": 105310000,
      "gold_usd": 4390,
      "silver_usd": 66.68
    }
  }
}
```

Numeric API values remain JSON numbers and are not converted to Persian-formatted strings.

---

## `GET /api/v1/assets`

Returns CoinGecko asset-selection data.

It can also synchronize newly discovered top-market-cap assets into D1.

Example fields:

```text
live
count
enabled_count
assets
```

Each asset may contain:

```text
id
name
name_fa
symbol
market_cap_rank
price_usd
change_24h_percent
enabled
```

---

## `GET /api/v1/sources`

Runs/returns health information for configured market sources.

Includes:

- selected USDT provider
- USDT provider priority
- Wallex status
- Tabdeal status
- Exir status
- CoinGecko status
- WallGold status

Example provider status fields:

```json
{
  "healthy": true,
  "http_status": 200,
  "latency_ms": 125,
  "message": null,
  "price": 234307,
  "sample": null
}
```

---

## `GET /api/v1/sources/usdt`

Resolves USDT using the configured fallback chain.

Example:

```json
{
  "success": true,
  "data": {
    "available": true,
    "price_toman": 234307,
    "source": "Wallex",
    "source_key": "wallex",
    "fallback_level": 0,
    "latency_ms": 110,
    "priority": [
      "Wallex",
      "Tabdeal",
      "Exir"
    ]
  }
}
```

Fallback levels:

```text
0 = Wallex
1 = Tabdeal
2 = Exir
```

---

## `GET /api/v1/automation`

Returns automatic publishing configuration and status.

Example:

```json
{
  "success": true,
  "data": {
    "enabled": true,
    "interval_minutes": 10,
    "quiet_hours": {
      "enabled": true,
      "start": "01:00",
      "end": "10:30"
    },
    "last_run_at": "2026-09-10T09:30:00.000Z",
    "last_success_at": "2026-09-10T09:30:02.000Z",
    "next_run_at": "2026-09-10T09:40:00.000Z",
    "last_error": null,
    "timezone": "Asia/Tehran"
  }
}
```

---

## `GET /api/v1/system`

Returns high-level runtime state.

Includes:

- app/service name
- version
- API version
- timezone
- global enabled state
- automation state
- D1 connectivity and latency
- admin counts

---

## `GET /api/v1/system/database`

Returns D1 health, storage information and record counts.

Example fields:

```text
connected
provider
latency_ms
storage
records
schema_version
```

Storage fields may include:

```text
available
usedBytes
limitBytes
freeBytes
usagePercent
```

Storage metadata is only available if the required Cloudflare account/database/API-token environment variables are configured.

---

## `POST /telegram/webhook`

Telegram webhook receiver.

This endpoint is not a general public API endpoint.

The request must contain the expected Telegram webhook secret header:

```text
X-Telegram-Bot-Api-Secret-Token
```

The Worker accepts Telegram `message` and `callback_query` updates.

---

# Full Installation Guide

There are two common deployment approaches:

1. Cloudflare Dashboard
2. Wrangler CLI

Wrangler is recommended for version-controlled GitHub projects.

---

## 1. Prerequisites

You need:

- a Cloudflare account
- Node.js installed
- a Telegram account
- a Telegram bot created with BotFather
- a Telegram channel
- the bot added as an administrator of the target channel
- a CoinGecko API key
- this repository cloned locally

Cloudflare's current Workers documentation recommends using Wrangler for local development and deployment, while D1 is attached to Workers through a binding. Cron Triggers invoke a Worker's `scheduled()` handler and are evaluated in UTC; this project converts time-dependent behavior to the configured application timezone internally.

Official docs:

- https://developers.cloudflare.com/workers/get-started/guide/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://core.telegram.org/bots/api

---

## 2. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/drd-rate-manager.git
cd drd-rate-manager
```

---

## 3. Create your Telegram bot

Open BotFather in Telegram and create a new bot.

Save the bot token as:

```text
TELEGRAM_BOT_TOKEN
```

Add the bot to your target Telegram channel as an administrator and grant it permission to post messages.

Get your own numeric Telegram ID. Once the Worker is online, `/id` can show it, but during first-time setup you can obtain it using any trusted Telegram user-ID method.

Set it as:

```text
TELEGRAM_OWNER_ID
```

---

## 4. Create a webhook secret

Generate a long random value.

Examples:

```bash
openssl rand -hex 32
```

or use a password manager/random generator.

Save it as:

```text
TELEGRAM_WEBHOOK_SECRET
```

Never commit the real secret to Git.

---

## 5. Create the Cloudflare Worker project

If this repository already contains the Worker source and Wrangler configuration, install dependencies and continue to the next step.

For a new Worker project, Cloudflare currently supports:

```bash
npm create cloudflare@latest -- drd-rate-manager
```

Select a Worker-only JavaScript project.

For this project, the Worker source should be the project's main Worker module.

A minimal `wrangler.jsonc` can look like:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "drd-rate-manager",
  "main": "worker.js",
  "compatibility_date": "2026-09-10",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "drd-rate-manager-db",
      "database_id": "YOUR_D1_DATABASE_ID"
    }
  ],
  "triggers": {
    "crons": [
      "* * * * *"
    ]
  }
}
```

If your source is stored under `src/worker.js`, update `main` accordingly.

---

## 6. Create Cloudflare D1

Using Wrangler:

```bash
npx wrangler@latest d1 create drd-rate-manager-db
```

Cloudflare returns a database UUID and binding configuration.

The binding **must be named `DB`** because the Worker accesses the database through:

```js
env.DB
```

Example Wrangler binding:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "drd-rate-manager-db",
      "database_id": "YOUR_DATABASE_UUID"
    }
  ]
}
```

Alternatively, create the D1 database in the Cloudflare Dashboard and add a D1 binding named `DB` to the Worker.

The application tables are created automatically by the Worker.

---

## 7. Configure environment variables

Copy:

```bash
cp .env.example .env
```

`.env` is only a reference for values. For production Cloudflare secrets, use Wrangler secrets or the Cloudflare dashboard.

### Add secrets with Wrangler

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put COINGECKO_API_KEY
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

For non-secret variables, place them in the Wrangler `vars` section or configure them in the Cloudflare dashboard.

Example:

```jsonc
{
  "vars": {
    "TELEGRAM_OWNER_ID": "123456789",
    "TELEGRAM_CHANNEL_ID": "@YourChannel",
    "TELEGRAM_CHANNEL_HANDLE": "@YourChannel",
    "BOT_DISPLAY_NAME": "DRD Rate Manager",
    "COINGECKO_TOP_LIMIT": "20",
    "COINGECKO_DEFAULT_ASSETS": "ethereum,solana,ripple",
    "WALLEX_API_URL": "https://api.wallex.ir/hector/web/v1/markets",
    "TABDEAL_API_URL": "https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1",
    "EXIR_API_URL": "https://api.exir.io/v2/orderbook?symbol=usdt-irt",
    "WALLGOLD_API_URL": "https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN",
    "D1_DATABASE_LIMIT_MB": "500",
    "APP_NAME": "DRD RATE MANAGER",
    "APP_VERSION": "0.9.1",
    "TIMEZONE": "Asia/Tehran"
  }
}
```

Do not place real secrets in `wrangler.jsonc` if the repository is public.

---

## 8. Configure D1 storage monitoring

The bot can display an approximate D1 usage progress bar.

Configure:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
CLOUDFLARE_API_TOKEN
D1_DATABASE_LIMIT_MB
```

If these are not configured, the main D1 functionality still works; only storage metadata will be unavailable.

Use a restricted Cloudflare API token with the minimum permissions necessary for reading D1/database metadata.

---

## 9. Configure Cron Trigger

Automatic publishing expects the Worker to be invoked every minute.

Wrangler configuration:

```jsonc
{
  "triggers": {
    "crons": [
      "* * * * *"
    ]
  }
}
```

Or configure the Cron Trigger from the Cloudflare dashboard.

Important: Cloudflare Cron Triggers are evaluated in UTC. The project's Quiet Hours and Telegram display times are calculated using `TIMEZONE`, which defaults to `Asia/Tehran`.

---

## 10. Deploy the Worker

Login if required:

```bash
npx wrangler login
```

Then deploy:

```bash
npx wrangler deploy
```

After deployment you receive a URL similar to:

```text
https://drd-rate-manager.YOUR_SUBDOMAIN.workers.dev
```

Test:

```bash
curl https://drd-rate-manager.YOUR_SUBDOMAIN.workers.dev/
```

Expected result includes:

```json
{
  "success": true,
  "service": "DRD RATE MANAGER",
  "version": "0.9.1"
}
```

---

## 11. Configure Telegram webhook

Set the webhook to:

```text
https://YOUR_WORKER_URL/telegram/webhook
```

Example using curl:

```bash
curl -X POST \
  "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_WORKER_URL/telegram/webhook",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message", "callback_query"],
    "max_connections": 40
  }'
```

Windows PowerShell example:

```powershell
$body = @{
    url = "https://YOUR_WORKER_URL/telegram/webhook"
    secret_token = "YOUR_TELEGRAM_WEBHOOK_SECRET"
    allowed_updates = @("message", "callback_query")
    max_connections = 40
} | ConvertTo-Json

Invoke-RestMethod `
    -Method Post `
    -Uri "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" `
    -ContentType "application/json" `
    -Body $body
```

Check webhook status:

```text
https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo
```

Do not expose a real bot token in screenshots, logs, documentation, commits, or issues.

---

## 12. Initialize Telegram UI

Open the bot in Telegram and send:

```text
/start
```

The Worker will configure:

- Telegram commands
- Telegram Menu button
- management entry screen

Then test:

```text
/menu
/help
/id
```

---

## 13. Configure the bot

From Telegram:

```text
/menu
→ تنظیمات
→ زمان‌بندی انتشار
```

Configure:

- automatic publishing on/off
- publish interval
- Quiet Hours

Then:

```text
/menu
→ مدیریت منابع
```

Verify:

- Wallex
- Tabdeal
- Exir
- CoinGecko
- WallGold

Finally:

```text
/menu
→ مدیریت بازار
→ پیش‌نمایش
```

Verify the post formatting before enabling automatic publishing.

---

# Local Development

Run:

```bash
npx wrangler dev
```

The local Worker usually runs at:

```text
http://localhost:8787
```

You can test public API routes locally, but Telegram webhooks require a publicly reachable HTTPS endpoint. For Telegram integration testing, deploying a development Worker is usually simpler.

D1 local and production databases are separate in Wrangler workflows. Be careful not to assume local state exists remotely.

---

# Recommended Repository Structure

```text
drd-rate-manager/
│
├── worker.js
├── wrangler.jsonc
├── package.json
├── README.md
├── .env.example
├── .gitignore
└── LICENSE
```

Suggested `.gitignore` entries:

```gitignore
node_modules/
.dev.vars
.env
.env.*
!.env.example
.wrangler/
.DS_Store
```

---

# Security Notes

Never commit:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
COINGECKO_API_KEY
CLOUDFLARE_API_TOKEN
```

Recommended practices:

- store sensitive values as Cloudflare secrets
- rotate any token that has ever been published publicly
- restrict the Cloudflare API token to the minimum permissions needed
- use `TELEGRAM_WEBHOOK_SECRET`
- keep `TELEGRAM_OWNER_ID` correct
- do not expose D1 credentials or account-level tokens
- review public API exposure before adding sensitive operational data

The current GET API endpoints are intentionally public. If you deploy this for a private system, consider adding authentication or Cloudflare Access in front of system/diagnostic routes.

---

# Troubleshooting

## Worker validation error 10021

If Cloudflare reports a JavaScript syntax/validation error, validate the Worker locally before deploying:

```bash
node --check worker.js
```

Then deploy again:

```bash
npx wrangler deploy
```

---

## D1 binding error

Error example:

```text
D1 binding "DB" is not configured.
```

Fix:

- create a D1 database
- bind it to the Worker
- use the binding name exactly `DB`

---

## Bot receives no updates

Check:

1. Worker is deployed
2. webhook URL is correct
3. `TELEGRAM_WEBHOOK_SECRET` matches the secret passed to `setWebhook`
4. `getWebhookInfo` shows no pending error
5. Worker logs do not show authentication errors

---

## Bot cannot publish to the channel

Verify:

- bot is a channel administrator
- bot can post messages
- `TELEGRAM_CHANNEL_ID` is correct
- channel username starts with `@` when using a public handle

---

## CoinGecko unavailable

Verify:

```text
COINGECKO_API_KEY
```

and check the configured CoinGecko API plan/header requirements.

The current implementation uses the Demo API header.

---

## D1 storage percentage unavailable

Verify:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_D1_DATABASE_ID
CLOUDFLARE_API_TOKEN
D1_DATABASE_LIMIT_MB
```

The core database remains functional without the storage monitor.

---

## Automatic publishing does not run

Verify:

1. Cron Trigger is configured as `* * * * *`
2. global bot status is enabled
3. automatic publishing is enabled
4. current time is not inside Quiet Hours
5. publish interval has elapsed
6. `TELEGRAM_CHANNEL_ID` is configured
7. market-source failures are not causing an unexpected runtime error

---

# Deployment Checklist

Before considering a production deployment complete:

- [ ] Worker deployed successfully
- [ ] `GET /` works
- [ ] D1 binding is named `DB`
- [ ] Telegram bot token configured as a secret
- [ ] webhook secret configured
- [ ] Telegram webhook configured successfully
- [ ] owner ID configured
- [ ] bot is channel administrator
- [ ] channel ID/handle configured
- [ ] CoinGecko key configured
- [ ] `/start` works
- [ ] `/menu` works
- [ ] `/help` works
- [ ] `/id` works
- [ ] Telegram Menu button appears
- [ ] source health screen works
- [ ] market preview works
- [ ] manual channel publish works
- [ ] Cron Trigger configured
- [ ] automatic publish tested
- [ ] Quiet Hours tested
- [ ] D1 storage monitor checked
- [ ] no production secrets committed to Git

---

# Version

```text
0.9.1
```

---

## License

Choose a license before publishing publicly. MIT is a common choice for permissive open-source distribution.
