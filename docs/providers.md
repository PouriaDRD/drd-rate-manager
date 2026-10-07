# Providers and Consensus

## Source inventory

### USDT/Toman

| Source | Default | Managed endpoint key |
|---|---:|---|
| Wallex | ON | `providers.wallex_api_url` |
| Tabdeal | ON | `providers.tabdeal_api_url` |
| Exir | ON | `providers.exir_api_url` |
| Bitpin | ON | `providers.bitpin_api_url` |
| Nobitex | OFF | `providers.nobitex_api_url` |
| OMPFinex | ON | `providers.ompfinex_api_url` |
| Ramzinex | ON | `providers.ramzinex_api_url` |

### 18K gold

| Source | Default | Managed endpoint key |
|---|---:|---|
| WallGold | ON | `providers.wallgold_api_url` |
| TechnoGold | ON | `providers.technogold_api_url` |
| MelliGold | OFF | `providers.melligold_api_url` |
| Talasea | ON | `providers.talasea_api_url` |
| Milli | ON | `providers.milli_api_url` |
| Gerami | ON | `providers.gerami_api_url` |

### Global market data

CoinGecko is a separate market source for global crypto/metal data and asset discovery.

## Consensus model

USDT and gold are not primary/fallback chains.

Every enabled source is queried concurrently. Only successful positive observations participate.

The resolver:

1. collects healthy prices;
2. calculates the initial median;
3. when there are at least three healthy samples, rejects samples farther than 3% from the center if at least two inliers remain;
4. recalculates the median from accepted samples;
5. rounds the final price;
6. returns contributor/rejection metadata.

Output metadata includes:

```text
strategy = consensus
contributors
rejected
sampleCount
```

With one or two healthy observations, the median is still used but the three-sample outlier filter is not applied.

## Stored USDT order

The configurable USDT ordering is:

```text
wallex
tabdeal
exir
bitpin
nobitex
ompfinex
ramzinex
```

The current source snapshot still exposes this ordering for UI/management compatibility, but pricing is consensus-based. Do not document this order as a fallback route.

## Provider conversions

Provider adapters normalize differing APIs into one Toman price representation.

Examples:

- OMPFinex and Ramzinex responses may require IRR-to-Toman conversion.
- Talasea and Milli responses use provider-specific units that are normalized before consensus.
- buy/sell orderbook sources generally derive a reference value from the available sides.

Consumers should use the final normalized consensus, not raw provider values.

## Mazaneh

Mazaneh is calculated internally from the final validated 18K gram price:

```js
Math.round(gram18 * 4.6083 * (705 / 750))
```

There is no separate Mazaneh source.

## Enable/disable state

Each source has a D1-backed enable flag.

Nobitex and MelliGold are OFF by default. All other local USDT/gold providers listed above are ON by default.

Disabling a source removes it from active collection; it must not be treated as a failed healthy sample.

## Provider tests

Private Web Admin can test each local provider independently and can probe CoinGecko. Tests update source status but should not be confused with the final consensus output.

## Resilience

Provider calls are wrapped by resilience logic and bounded HTTP timeouts.

Health/status data includes success, HTTP status, latency, message, last price, and last-check timestamp. The broader health service also exposes circuit state/health scoring.

A provider failure should degrade source health; it should not automatically make the full market unavailable when enough healthy providers remain.

## Cache and stale fallback

Market snapshots are cached in D1.

If a refresh fails and a usable cache exists, the system may return stale data with explicit cache/error metadata. A refresh-lock storage failure may also fall back to cache. If no cache exists, the system fails closed.

## Publication quality

Publishing applies a quality gate so severely partial snapshots are not silently published as healthy market data.

## Future reliability

A separate future roadmap item is additional crypto/CoinGecko fallback/provider diversification. That work is not part of the current USDT/gold consensus.

## Related documents

- [Architecture](architecture.md)
- [Configuration](configuration.md)
- [Troubleshooting](troubleshooting.md)
