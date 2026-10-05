# DRD Rate Manager v0.13.0

A class-based Cloudflare Worker for Telegram market management, D1-backed caching, manual/automatic publishing, source monitoring, and public read-only APIs.

## Architecture

```text
Cloudflare Worker
├── Application
├── BotController
├── ApiController
├── AutomationService
├── MarketService
├── MarketPublisher
├── MarketPostBuilder
├── CoinGeckoClient
├── MarketSources
├── TelegramClient
└── D1 repositories
    ├── SettingsRepository
    ├── MarketCacheRepository
    ├── LockRepository
    ├── SourceStatusRepository
    ├── AssetRepository
    ├── AdminRepository
    ├── AdminInputRepository
    └── AuditRepository
```

The rewrite keeps deployment as a **single `worker.js`** while separating responsibilities internally with classes and repositories.

## Important changes in v0.13.0

- Restored and centralized channel Rich Message rendering through `MarketPostBuilder`.
- Removed fragile free-function dependency on `buildChannelMarketRichMessage`.
- One CoinGecko market request per market refresh for:
  - selected cryptocurrencies
  - Tether Gold proxy
  - Kinesis Silver proxy
- Added centralized D1 market snapshot cache.
- Default cache TTL: **30 seconds**.
- Cache TTL is configurable from the Telegram settings UI.
- Bot, API, preview, manual publish, and Cron all use the same market cache.
- Added stale-cache fallback.
- Added D1 distributed refresh lock to reduce duplicate upstream requests across Worker isolates.
- Added `User-Agent` to CoinGecko requests.
- CoinGecko Demo/Pro API modes are supported.
- Public Assets and Sources APIs read persistent cached state instead of calling providers directly.
- Added fail-fast runtime integrity checks for critical components.
- Scheduled path does not execute full schema migration on every Cron invocation.
- Schema version: **8**.

## CoinGecko request model

Regular market refresh:

```text
GET /coins/markets
ids=<enabled coins>,tether-gold,kinesis-silver
```

That **single request** returns selected crypto prices, 24h changes, and the two global metal proxy prices.

The Top-N asset catalog uses a separate request only when the administrator explicitly refreshes the CoinGecko asset list.

## Cache

The market snapshot is stored in `market_cache`.

Default:

```text
30 seconds
```

Available Telegram settings:

```text
5 / 10 / 15 / 30 / 60 / 120 / 300 / 600 seconds
```

Consumers:

```text
Telegram Bot
Public APIs
Preview
Manual publishing
Automatic publishing
```

All use the same cached snapshot.

If an upstream provider temporarily fails, valid fields from the last healthy snapshot are reused where possible and the response remains marked `partial`.

## USDT source priority

```text
Wallex → Tabdeal → Exir
```

Regular market refresh stops after the first healthy provider.

The Source Manager's explicit refresh checks all USDT providers so their cached health status stays current.

## Required Cloudflare Cron

```cron
* * * * *
```

The Worker checks every minute, but publishes only when the configured interval is due and Quiet Hours are not active.

## Telegram commands

```text
/start
/menu
/help
/id
```

## Public API

```text
GET /
GET /api/v1/market
GET /api/v1/assets
GET /api/v1/sources
GET /api/v1/sources/usdt
GET /api/v1/automation
GET /api/v1/system
GET /api/v1/system/database
POST /telegram/webhook
```

## D1 tables

```text
app_meta
settings
admins
source_status
admin_input_state
audit_logs
coingecko_assets
market_cache
runtime_locks
```

The rewrite is backward-compatible with the existing tables and adds `runtime_locks` for cross-isolate market refresh coordination.

## Environment variables

Non-secret variables:

```env
APP_NAME=DRD RATE MANAGER
APP_VERSION=0.13.0
BOT_DISPLAY_NAME=DRD Rate Manager
TIMEZONE=Asia/Tehran

TELEGRAM_OWNER_ID=
TELEGRAM_CHANNEL_ID=@DRDrate
TELEGRAM_CHANNEL_HANDLE=@DRDrate

COINGECKO_API_PLAN=demo
COINGECKO_TOP_LIMIT=20
COINGECKO_DEFAULT_ASSETS=bitcoin,ethereum,binancecoin,ripple,solana,tron
COINGECKO_USER_AGENT=DRD-Rate-Manager/0.13.0 (+https://t.me/DRDrate)

WALLEX_API_URL=https://api.wallex.ir/hector/web/v1/markets
TABDEAL_API_URL=https://api1.tabdeal.org/r/api/v1/depth?symbol=USDTIRT&limit=1
EXIR_API_URL=https://api.exir.io/v2/orderbook?symbol=usdt-irt
WALLGOLD_API_URL=https://api.wallgold.ir/api/v1/price?side=buy&symbol=GLD_18C_750TMN

CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_D1_DATABASE_ID=
D1_DATABASE_LIMIT_MB=500
```

Secrets:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
COINGECKO_API_KEY
CLOUDFLARE_API_TOKEN
```

Never commit secrets to Git.

## Validation before deployment

```bash
node --check worker.js
```

The production file also includes a runtime component contract that verifies critical class methods exist at module load time.

## Upgrade

Set:

```env
APP_VERSION=0.13.0
```

Deploy the new Worker, then open any HTTP endpoint once to run schema bootstrap/migration. The first request creates the new `runtime_locks` table if it does not already exist.

After deployment test:

```text
/api/v1/system
/api/v1/market
/api/v1/sources
```

Then use Telegram:

```text
Settings → Market Cache
Market Manager → Refresh
Market Manager → Preview
Market Manager → Publish Now
```
