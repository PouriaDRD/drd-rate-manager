# Telegram Control Plane

## Entry point

Telegram updates are received through:

```text
POST /telegram/webhook
```

Webhook validation uses the managed Telegram webhook secret.

## Top-level commands

Only these commands are treated as top-level command entry points:

```text
/start
/menu
/help
/id
```

Ordinary text outside an active input flow is ignored. Unknown slash commands are ignored.

This protects the bot from accidentally interpreting arbitrary text as management actions.

## Owner and admins

The bot has a configured Owner and managed Admin records.

Key policy:

- Owner has elevated authority.
- Only the Owner can perform owner-only administration such as admin membership management where enforced.
- Inactive admins cannot use protected operations.
- Admin state is persisted in D1.

## Global enable/disable

The bot can be globally disabled. Disabled mode must not accidentally leave normal operational actions available.

Activation/recovery behavior should remain intentionally narrow.

## Required channel membership

Permanent required channels:

```text
@DRDNetwork
@DRDrate
```

Regular Admins must satisfy membership requirements before protected actions.

The Owner bypasses required-membership enforcement to avoid administrative lockout.

Extra channels are validated before acceptance and the bot must be an Administrator in them for reliable `getChatMember` checks.

## Input-state flows

Telegram uses persisted input state for multi-step actions such as:

- add admin;
- API token naming;
- required-channel input.

Cancel/back behavior must clear stale state deterministically.

A stale pending state must not capture unrelated future text.

## Same-message navigation

Interactive menus are designed around callback queries and edit-in-place navigation instead of producing unnecessary new messages.

Back buttons should return to the previous menu state.

## Source and market controls

Telegram surfaces can inspect/manage:

- provider enable states;
- source status;
- market preview;
- automation;
- database/system state;
- API management;
- admins;
- login security/history.

USDT ordering may still be shown in management UI, but final pricing strategy is consensus rather than primary/fallback.

## Publishing

Telegram control actions can trigger real publication. Production smoke testing should prefer preview/dry-run/provider test actions unless a channel post is intentional.

## Security

Do not echo:

- bot token;
- webhook secret;
- CoinGecko key;
- Cloudflare token;
- API token plaintext after one-time creation;
- Web Admin password/session/CSRF values.

User-controlled values must be escaped before Telegram HTML rendering.

## Related documents

- [Providers](providers.md)
- [Security](security.md)
- [Deployment](deployment.md)
