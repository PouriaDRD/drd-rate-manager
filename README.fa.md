# راهنمای کامل DRD Rate Manager

این فایل راهنمای جامع فارسی پروژه **DRD Rate Manager** است. برای معرفی کوتاه پروژه، [`README.md`](README.md) را ببینید.

**نسخه برنامه:** `0.2.1`
**نسخه Schema دیتابیس D1:** `13`
**نسخه Runtime Settings Catalog:** `3`
**نسخه Secure Settings Catalog:** `1`

## 1) معرفی پروژه

DRD Rate Manager یک Cloudflare Worker ماژولار برای جمع‌آوری مقاوم قیمت بازار، مدیریت و انتشار در تلگرام، اتوماسیون زمان‌بندی‌شده، پنل خصوصی Web Admin، API خارجی scope-based و نگهداری state/config/security در Cloudflare D1 است.

فلسفه اصلی پروژه حذف وابستگی به یک منبع واحد است. قیمت USDT/Toman و طلای ۱۸ عیار از چند provider فعال به‌صورت هم‌زمان خوانده می‌شود و نتیجه نهایی با consensus محاسبه می‌شود.

## 2) معماری کلان

```text
Cloudflare Worker
├── Application / Composition Root
├── Public API + OpenAPI
├── Telegram Webhook / Admin Control Plane
├── Private Web Admin
├── Market Aggregation
│   ├── USDT providers
│   ├── Gold providers
│   └── CoinGecko
├── Provider Resilience / Health
├── Market Cache / Stale Fallback
├── Automation / Publishing / Distributed Locks
├── Runtime Configuration
├── Encrypted Secure Settings
├── Web Authentication / Login History
├── API Token Management
├── Operational Metrics / Alerts
└── D1 Repositories
```

ورودی Worker فایل `src/index.js` است. orchestration درخواست‌ها و Cron در `src/app/application.js` انجام می‌شود. assetهای پنل در `public/admin` هستند و از binding با نام `ASSETS` و `run_worker_first` استفاده می‌شود.

## 3) Git Workflow

قانون فعلی پروژه:

```text
dev  = همه توسعه‌ها، تست‌ها، commit و push
main = فقط production
```

توسعه مستقیم روی `main` انجام نمی‌شود. release candidate باید روی `dev` کامل تست شود؛ سپس backup و smoke انجام شود، بعد `dev -> main` merge شود و production deploy فقط از `main` انجام شود.

## 4) منابع USDT/Toman

هفت provider مدیریت می‌شوند:

| Provider | Runtime key | Default |
|---|---|---|
| Wallex | `providers.wallex_api_url` | ON |
| Tabdeal | `providers.tabdeal_api_url` | ON |
| Exir | `providers.exir_api_url` | ON |
| Bitpin | `providers.bitpin_api_url` | ON |
| Nobitex | `providers.nobitex_api_url` | OFF |
| OMPFinex | `providers.ompfinex_api_url` | ON |
| Ramzinex | `providers.ramzinex_api_url` | ON |

ترتیب ذخیره/نمایش:

```text
wallex, tabdeal, exir, bitpin, nobitex, ompfinex, ramzinex
```

این ترتیب برای قیمت نهایی **priority/fallback** نیست. strategy فعلی `consensus` است و همه sourceهای فعال concurrent بررسی می‌شوند.

## 5) منابع طلای ۱۸ عیار

شش provider مدیریت می‌شوند:

| Provider | Runtime key | Default |
|---|---|---|
| WallGold | `providers.wallgold_api_url` | ON |
| TechnoGold | `providers.technogold_api_url` | ON |
| MelliGold | `providers.melligold_api_url` | OFF |
| Talasea | `providers.talasea_api_url` | ON |
| Milli | `providers.milli_api_url` | ON |
| Gerami | `providers.gerami_api_url` | ON |

تمام sourceهای فعال concurrent اجرا می‌شوند و همان الگوریتم consensus روی خروجی‌ها اعمال می‌شود.

## 6) الگوریتم Consensus و Outlier

برای USDT و Gold:

1. فقط نتیجه‌های موفق با قیمت مثبت وارد نمونه می‌شوند.
2. median اولیه محاسبه می‌شود.
3. اگر حداقل ۳ نمونه سالم باشد، فاصله هر نمونه از median بررسی می‌شود.
4. آستانه outlier برابر **۳٪** است.
5. اگر پس از حذف outlierها حداقل ۲ inlier بماند، outlierها رد می‌شوند.
6. median accepted samples دوباره محاسبه و round می‌شود.
7. metadata شامل `contributors`, `rejected`, `sampleCount` و `strategy` است.
8. با ۱ یا ۲ نمونه سالم، median همان نمونه‌ها استفاده می‌شود و فیلتر سه‌نمونه‌ای اجرا نمی‌شود.

اگر هیچ provider سالمی وجود نداشته باشد، consensus failure برمی‌گردد.

## 7) Mazaneh

Mazaneh provider یا API جداگانه ندارد و از قیمت نهایی معتبر گرم طلای ۱۸ عیار محاسبه می‌شود:

```js
Math.round(gram18 * 4.6083 * (705 / 750))
```

بنابراین سلامت Mazaneh وابسته به Gold consensus نهایی است.

## 8) CoinGecko

CoinGecko برای market data جهانی crypto/metal استفاده می‌شود. Plan می‌تواند `demo` یا `pro` باشد. API key در Secure Settings است و plan/top-limit/default-assets/user-agent در Runtime Settings مدیریت می‌شوند.

CoinGecko در نسخه فعلی fallback برای USDT/Gold consensus نیست.

## 9) Resilience و Cache

سیستم provider health/status را persist می‌کند و timeout، cooldown/circuit-breaker و status tracking دارد.

Market pipeline از D1 cache استفاده می‌کند. اگر refresh جدید شکست بخورد و cache قابل‌استفاده باشد، stale fallback کنترل‌شده ممکن است برگردد. در failure مربوط به lock storage نیز اگر cache وجود داشته باشد stale fallback مجاز است؛ بدون cache باید fail closed شود.

Quality gate مانع انتشار snapshot شدیداً ناقص می‌شود.

## 10) Automation و انتشار

Cron:

```text
* * * * *
```

قابلیت‌ها:

- enable/disable global publishing
- publish interval
- quiet hours
- aligned publication slots
- retry پس از failure
- D1 distributed lock برای جلوگیری از duplicate publish
- dry-run و force-run
- execution history
- real-time countdown/state در Web Admin
- publication quality gate

## 11) Telegram Control Plane

دستورات پایه:

```text
/start
/menu
/help
/id
```

Telegram management شامل market/source controls، automation، admins، API management، system/database diagnostics، login security/history و required membership است.

### Owner و Admin

Owner سطح دسترسی بالاتر دارد. add/remove admin مطابق policy Owner-only انجام می‌شود و Admin غیرفعال اجازه عمل ندارد.

### Required Membership

دو کانال immutable:

```text
@DRDNetwork
@DRDrate
```

Adminهای عادی باید عضو همه required channelها باشند. Owner برای جلوگیری از lockout bypass دارد. کانال اضافی فقط پس از validation و Administrator بودن bot پذیرفته می‌شود.

## 12) Web Admin

Web Admin یک control plane خصوصی است و مسیر واقعی آن **نباید** در README، public docs، log، screenshot عمومی یا issue قرار بگیرد.

قابلیت‌های اصلی:

- authentication و session management
- CSRF protection
- bootstrap اولیه و اجبار به تغییر credential/path پیش‌فرض
- Login History
- Telegram alert روی login موفق و lockout جدید
- Admin Management
- API Management
- Sources / Market / Automation
- System / Database diagnostics
- Full Configuration Management

Public OpenAPI عمداً private admin routes را expose نمی‌کند.

## 13) Web Admin Security

- password خام persist/log نمی‌شود.
- raw session token ذخیره نمی‌شود؛ hash ذخیره می‌شود.
- raw CSRF token persist نمی‌شود.
- cookieها `HttpOnly`, `Secure`, `SameSite=Strict` هستند.
- mutationها CSRF معتبر می‌خواهند.
- login rate limit و lockout وجود دارد.
- login history metadata امنیتی محدود و secret-safe ذخیره می‌کند.
- credential change sessionهای قبلی را invalidate می‌کند.
- password protection از `APP_MASTER_KEY` مشتق می‌شود.
- PBKDF2-HMAC-SHA256 با سقف 100,000 iteration Cloudflare Workers استفاده می‌شود.

## 14) API خارجی

Service metadata/docs:

```text
GET /
GET /docs
GET /openapi.json
```

Market audience:

```text
GET /api/v1/market
GET /api/v1/assets
GET /api/v1/sources
GET /api/v1/sources/usdt
```

Core audience:

```text
GET /api/v1/automation
GET /api/v1/system
GET /api/v1/system/database
```

Webhook:

```text
POST /telegram/webhook
```

Token namespaceها:

```text
drd_mkt_*   Market
drd_core_*  Core
```

raw API token فقط هنگام create/rotate نمایش داده می‌شود و فقط hash persist می‌شود. Market API mode می‌تواند `public` یا `private` باشد؛ Core همیشه Core scope می‌خواهد.

## 15) D1 Schema

Schema فعلی `13` است. جدول‌های اصلی:

```text
app_meta
settings
secure_settings
web_admin_users
web_admin_sessions
web_auth_attempts
web_admin_login_history
admins
source_status
admin_input_state
audit_logs
coingecko_assets
market_cache
runtime_locks
automation_runs
api_tokens
```

`settings` operational/runtime values را نگه می‌دارد و `secure_settings` ciphertext و encryption metadata را.

## 16) Configuration Ownership

### Deployment / Infrastructure

```text
DB
ASSETS
APP_NAME
APP_VERSION
APP_MASTER_KEY
```

`APP_MASTER_KEY` permanent infrastructure secret است.

### Runtime Settings

Runtime Settings Catalog نسخه `3` و شامل **25** key است:

```text
general.bot_display_name
general.timezone

telegram.owner_id
telegram.channel_id
telegram.channel_handle

coingecko.plan
coingecko.top_limit
coingecko.default_assets
coingecko.user_agent

providers.wallex_api_url
providers.tabdeal_api_url
providers.exir_api_url
providers.wallgold_api_url
providers.bitpin_api_url
providers.nobitex_api_url
providers.ompfinex_api_url
providers.ramzinex_api_url
providers.technogold_api_url
providers.melligold_api_url
providers.talasea_api_url
providers.milli_api_url
providers.gerami_api_url

cloudflare.account_id
cloudflare.d1_database_id
cloudflare.d1_database_limit_mb
```

در deployment فعلی، D1 source of truth است. compatibility code هنوز می‌تواند برای installationهای قدیمی Legacy ENV را بخواند، اما templateهای فعلی دیگر این inputها را provision نمی‌کنند.

### Secure Settings

Secure Settings Catalog نسخه `1`:

```text
telegram.bot_token
telegram.webhook_secret
coingecko.api_key
cloudflare.api_token
```

این مقادیر تحت `APP_MASTER_KEY` در D1 رمزنگاری می‌شوند.

## 17) APP_MASTER_KEY

`APP_MASTER_KEY` را **regenerate نکنید** و casually rotate نکنید.

این key برای encrypted secure settings و derivationهای امنیتی استفاده می‌شود. جایگزینی خودسرانه می‌تواند داده امن موجود یا authentication وابسته را خراب کند.

برای نصب جدید key قوی بسازید و فقط به‌صورت Cloudflare Worker Secret نگه دارید. مقدار production را داخل Git، README، log، ticket یا screenshot قرار ندهید.

## 18) Configuration Management

Web Admin تمام 25 Runtime Setting و 4 Secure Setting را مدیریت می‌کند.

ویژگی‌ها:

- catalog-driven validation
- endpointهای تمام 13 provider قابل مدیریت
- secretها replace-only؛ plaintext قبلی هرگز برنمی‌گردد
- تغییر sensitive config با password confirmation
- provider/CoinGecko connectivity test
- runtime refresh بدون deploy
- `APP_MASTER_KEY` فقط status دارد و مقدارش نمایش داده نمی‌شود

## 19) Legacy ENV Migration و Cleanup تکمیل‌شده

در baseline پروداکشن v0.2.1، پاک‌سازی Legacy Runtime ENV و Legacy Worker Secretها کامل شده است. `.env.example` و `wrangler.jsonc` فعلی عمداً این legacy inputها را provision نمی‌کنند.

برای installation قدیمی که هنوز migration لازم دارد، روند همچنان proof-driven است:

1. Runtime/Secure migration کامل شود.
2. System diagnostics باید readiness کامل را گزارش کند.
3. authenticated snapshot تازه گرفته شود.
4. ابتدا dry-run:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc
```

5. plan review شود.
6. سپس در صورت تأیید:

```bash
npm run config:finalize -- system-snapshot.json --wrangler wrangler.production.jsonc --write
```

این script deploy نمی‌کند و Worker Secretها را خودکار حذف نمی‌کند. حذف Legacy Worker Secretها یک عملیات جداگانه و version-aware در Cloudflare بعد از production verification است. `APP_MASTER_KEY` هرگز جزو cleanup نیست.

در baseline تمیز v0.2.1، inventory مورد انتظار Worker Secret فقط `APP_MASTER_KEY` است.

## 20) Version Skew در Staged Deployment

نسخه‌های مختلف Worker می‌توانند روی D1 مشترک اجرا شوند. اگر catalog version متفاوت باشد و metadata هر bootstrap بدون guard بازنویسی شود، metadata می‌تواند بین نسخه قدیمی و جدید نوسان کند.

برای releaseهای migrationدار:

- readiness را با همان candidate code اثبات کنید.
- 0%-traffic/version-override smoke انجام دهید.
- metadata را بعد از promotion دوباره verify کنید.
- legacy secret cleanup را بعد از production promotion و verification انجام دهید.
- future metadata migration باید downgrade-safe/monotonic باشد.

## 21) نصب Local

نیازمندی‌ها:

- Node.js جدید سازگار
- npm
- Cloudflare account/Wrangler
- D1 database
- Telegram bot

```bash
git clone https://github.com/PouriaDRD/drd-rate-manager.git
cd drd-rate-manager
git checkout dev
npm install
```

برای محیط reproducible می‌توان از `npm ci` استفاده کرد.

## 22) Wrangler و D1

`wrangler.jsonc` template است و در `vars` فقط deployment identity را نگه می‌دارد؛ D1 binding همچنان database ID placeholder دارد. production config واقعی را commit نکنید.

Bindings:

```text
DB      Cloudflare D1
ASSETS  public/admin
```

Cron:

```text
* * * * *
```

قبل از release، actual production Wrangler file را با strict preflight بررسی کنید.

## 23) Secret اولیه

برای environment جدید:

```bash
wrangler secret put APP_MASTER_KEY
```

بعد از bootstrap، Runtime Settings و Secure Settings replace-only را از Configuration خصوصی تنظیم کنید تا D1 source of truth برنامه باشد. در deployment تمیز جدید Legacy Worker Secret اضافه نکنید.

## 24) Web Admin Bootstrap

در database تازه، bootstrap account/path موقت است. bootstrap را سریع کامل کنید و username/password/private path را تغییر دهید.

private path را public نکنید. credential change باعث invalidation sessionهای قبلی می‌شود.

## 25) Tests و Quality Gates

```bash
npm test
npm run check
npm run test:phase19.8
npm run test:browser
npm run test:browser:chromium
npm run test:hardening
npm run release:preflight
npm run release:check
```

`npm test` از Node test runner استفاده می‌کند.

Playwright نسخه pin شده `1.63.0` است و Browser E2E روی Chromium، Firefox و WebKit اجرا می‌شود.

جزئیات Phase 19.8 در [`docs/phase19.8-test-matrix.md`](docs/phase19.8-test-matrix.md) است.

`release:check` deploy انجام نمی‌دهد.

## 26) Release Procedure

```text
1. توسعه روی dev
2. review git status/diff
3. npm test
4. npm run check
5. npm run test:browser
6. npm run release:check
7. strict production preflight
8. remote D1 backup
9. release candidate upload
10. 0%-traffic staged smoke / version override
11. live integration verification
12. merge dev -> main
13. production deploy/promotion فقط از main
14. post-deploy smoke
15. verify database/config metadata
16. نگهداری rollback candidate تا پایان verification
17. post-promotion cleanup تاییدشده
```

جزئیات در [`docs/release-checklist.md`](docs/release-checklist.md).

## 27) Rollback

قبل از promotion باید last-known-good Worker Version ID، D1 backup و rollback plan ثبت شده باشد.

Rollback Worker code برابر rollback database نیست. migrationهای destructive به recovery plan جدا نیاز دارند.

## 28) Observability

Diagnostics برای این بخش‌ها وجود دارد:

- application/runtime integrity
- database status
- provider/source status
- provider health
- automation state/history
- configuration migration readiness
- secure-settings readiness
- admin/login history
- operational metrics/alerts

تمام diagnostics باید secret-safe باشند.

## 29) Security Invariants

این موارد نباید persist/log/public شوند:

```text
Web Admin plaintext password
raw session token
raw CSRF token
raw API token
Telegram bot token
Telegram webhook secret
CoinGecko API key
Cloudflare API token
APP_MASTER_KEY
Cookie header
Authorization header
private Web Admin path
```

Authentication و authorization باید fail closed باشند.

## 30) Troubleshooting سریع

**Provider fail است:** enable state، source status، HTTP code/latency، managed endpoint و cooldown را بررسی کنید.

**قیمت نهایی عجیب است:** `contributors`, `rejected`, `sampleCount` و آستانه ۳٪ را بررسی کنید.

**Web Admin login نمی‌شود:** bootstrap state، credential version، expiry/idle timeout، lockout و `APP_MASTER_KEY` را بررسی کنید.

**Runtime config قدیمی دیده می‌شود:** D1 runtime readiness و Worker version در حال اجرا را چک کنید و version skew را در staged deployment در نظر بگیرید.

**Secure setting missing است:** encrypted D1 row و master-key status را بررسی کنید؛ plaintext را log نکنید.

**Automation duplicate دارد:** D1 lock و run history را بررسی کنید.

## 31) مسیرهای مهم

```text
src/index.js
src/app/
src/config/
src/controllers/
src/market/
src/services/
src/repositories/
src/api/
src/auth/
src/clients/
src/database/
src/telegram/
src/system/
src/observability/
public/admin/
tests/
e2e/
scripts/
docs/
```

## 32) مستندات مرتبط

- [`README.md`](README.md) — معرفی کوتاه
- [`README.en.md`](README.en.md) — راهنمای کامل انگلیسی
- [`docs/release-checklist.md`](docs/release-checklist.md) — release checklist
- [`docs/phase19.8-test-matrix.md`](docs/phase19.8-test-matrix.md) — test matrix

## 33) License

فایل [`LICENSE`](LICENSE) را ببینید.
