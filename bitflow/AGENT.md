---
name: bitflow-agent
skill: bitflow
description: Bitflow DEX operations on Stacks mainnet — token swaps with aggregated liquidity, price quotes, route discovery, market ticker data, and Keeper automation for scheduled orders.
---

# Bitflow Agent

This agent handles DEX operations on the Bitflow aggregated liquidity protocol on Stacks mainnet. It provides market data, swap routing, price impact analysis, token swap execution, and Keeper contract automation for scheduled orders. All operations are mainnet-only. The `swap` and `create-order` subcommands require an unlocked wallet; all others are read-only.

## Prerequisites

- Wallet unlocked via `bun run wallet/wallet.ts unlock` (for `swap` and `create-order` only)
- Network must be mainnet — Bitflow is mainnet-only
- No API key required — Bitflow SDK uses public endpoints at 500 req/min
- For `create-order`: must first have a Keeper contract via `get-keeper-contract`
- For `swap`: run `get-quote` first to check price impact; swaps with >5% impact require `--confirm-high-impact`

## Decision Logic

| Goal | Subcommand |
|------|-----------|
| Get price and volume data for all pairs | `get-ticker` — returns all Bitflow trading pairs with market data |
| List tokens available for swapping | `get-tokens` — returns all swap-eligible tokens |
| Find what tokens a given token can swap to | `get-swap-targets --token-id <id>` — returns valid output tokens |
| Get expected output and price impact | `get-quote` — returns quote and impact analysis before committing |
| Discover all routing paths between two tokens | `get-routes` — shows direct and multi-hop routes |
| Execute a token swap | `swap` — executes with best route and slippage protection |
| Get or create a Keeper automation contract | `get-keeper-contract` — returns or creates keeper for the wallet |
| Create a scheduled swap order | `create-order` — creates automated order via Keeper |
| Check status of a Keeper order | `get-order --order-id <id>` — returns order details and status |
| Cancel a pending Keeper order | `cancel-order --order-id <id>` — cancels before execution |
| List all keeper orders for a wallet | `get-keeper-user` — returns keeper contracts and order history |

## Safety Checks

- Always run `get-quote` before `swap` — check `priceImpact.combinedImpactPct` and `severity` field
- Swaps with >5% price impact are blocked without `--confirm-high-impact` flag
- Set `--slippage-tolerance` to match risk tolerance (default 0.01 = 1%)
- For `create-order`: verify `fundingTokens` amounts are in smallest units matching token decimals
- For `cancel-order`: cancellation only works on pending orders; already-executed orders cannot be reversed
- Amount units differ from ALEX: Bitflow uses human-readable decimals (e.g. `1.0` for 1 STX, `0.00015` for 15k sat sBTC)

## Error Handling

| Error message | Cause | Fix |
|--------------|-------|-----|
| "Bitflow is only available on mainnet" | Running on testnet | Set `NETWORK=mainnet` env var |
| "High price impact swap requires explicit confirmation" | Price impact exceeds 5% threshold | Add `--confirm-high-impact` flag or reduce trade size |
| "Trading pair not found" | Specified base/target currency pair doesn't exist | Use `get-tokens` and `get-swap-targets` to find valid pairs |
| "--funding-tokens must be a valid JSON object" | Malformed JSON in `--funding-tokens` | Pass valid JSON, e.g. `'{"token-stx":"1000000"}'` |

## Output Handling

- `get-quote`: `quote.expectedAmountOut` is the amount to expect; `priceImpact.severity` is `low`/`medium`/`high`
- `get-quote`: if `highImpactWarning` is present, the trade is large relative to pool liquidity
- `swap`: `txid` and `explorerUrl` confirm the on-chain transaction; `swap.priceImpact` shows actual impact
- `get-keeper-contract`: `contractIdentifier` is needed for `create-order --contract-identifier`
- `get-order`: check `order.status` — values are `pending`, `executing`, `completed`, or `cancelled`
- `get-keeper-user`: `userInfo.orders` lists all orders for monitoring

## Example Invocations

```bash
# Get a swap quote from STX to sBTC with price impact analysis
bun run bitflow/bitflow.ts get-quote --token-x token-stx --token-y token-sbtc --amount-in 21.0

# Execute a swap with 1% slippage tolerance
bun run bitflow/bitflow.ts swap --token-x token-stx --token-y token-sbtc --amount-in 21.0 --slippage-tolerance 0.01

# Get market ticker data for all Bitflow pairs
bun run bitflow/bitflow.ts get-ticker
```
