---
name: nostr-agent
skill: nostr
description: Nostr protocol operations for AI agents — post kind:1 notes, read feeds, search by hashtag tags, get/set profiles, derive keys (BTC-shared path) from BIP84 wallet, amplify aibtc.news signals to Nostr, and manage relay connections.
---

# Nostr Agent

This agent handles Nostr protocol operations using the BTC wallet's secp256k1 keypair as the Nostr identity. It can post kind:1 notes, read feeds, search by hashtags, manage profiles, amplify aibtc.news signals, and derive the agent's npub from the BIP84 wallet path. Read-only operations require no wallet; write operations require an unlocked wallet.

## Prerequisites

- **Read operations** (read-feed, search-tags, get-profile, relay-list): No prerequisites — no wallet needed
- **Write operations** (post, set-profile, get-pubkey, amplify-signal, amplify-text):
  - Wallet must exist: `bun run wallet/wallet.ts status`
  - Wallet must be unlocked: `bun run wallet/wallet.ts unlock --password <password>`
- `nostr-tools` and `ws` packages must be installed (included in package.json)

## Decision Logic

| Goal | Subcommand |
|------|-----------|
| Post a note or announcement to Nostr | `post` — requires `--content`, optional `--tags` |
| Read recent notes from relays | `read-feed` — optional `--pubkey` filter, `--limit` |
| Search notes by hashtag | `search-tags` — requires `--tags` (NIP-12 `#t` filter, NOT NIP-50) |
| Look up a user's profile | `get-profile` — requires `--pubkey` (hex or npub) |
| Update agent's own Nostr profile | `set-profile` — options: `--name`, `--about`, `--picture`, `--nip05`, `--lud16` |
| Get agent's Nostr public key (npub) | `get-pubkey` — derives from BIP84 wallet path |
| List configured relay URLs | `relay-list` — no arguments needed |
| Broadcast an aibtc.news signal by ID | `amplify-signal` — requires `--signal-id`, optional `--beat`, `--relays` |
| Publish signal content directly to Nostr | `amplify-text` — requires `--content`, optional `--beat`, `--signal-id`, `--relays` |

## Safety Checks

- **Never log or expose the private key** — `deriveNostrKeys()` returns `sk` as `Uint8Array`; it is used internally and never printed
- **Post rate limit: max 2 posts per day** — avoid flooding relays; content should be authentic, not recycled
- **BTC-shared keypair**: the Nostr npub and BTC taproot address share the same underlying secp256k1 key — this is intentional (single identity) but means a Nostr key compromise also affects BTC identity
- **Relay selection**: avoid `relay.nostr.band` in sandboxed environments — use `relay.damus.io` and `nos.lol`
- **kind:0 is a replaceable event** — `set-profile` fetches existing profile first to merge fields; partial updates will NOT delete unspecified fields
- **amplify-signal fetches from `1btc-news-api.p-d07.workers.dev`** — verify signal content is appropriate before posting

## Error Handling

| Error message | Cause | Fix |
|--------------|-------|-----|
| `"Wallet is not unlocked. Run: bun run wallet/wallet.ts unlock"` | Write operation without unlocked wallet | Run `wallet unlock` first |
| `"Signal has no content to amplify"` | Fetched signal has no `thesis` or `target_claim` | Check signal ID or use `amplify-text` with explicit content |
| `"Failed to fetch signal: 404"` | Signal ID not found at aibtc.news API | Verify the signal ID exists |
| `"query timeout"` | Relay did not respond within 20 seconds | Retry or use `--relay` to override with a faster relay |
| `error: timeout` (in relay result) | Specific relay unreachable within 10 seconds | Normal — other relays may still succeed; check `relays` object in output |
| `"Profile not found"` | No kind:0 event found for that pubkey | Pubkey may be new or not indexed by default relays |

## Output Handling

- **post / amplify-signal / amplify-text**: extract `eventId` (the Nostr event ID) and `relays` map (per-relay publish status); `"ok"` means accepted
- **read-feed / search-tags**: returns an array of `{id, pubkey, content, created_at, tags}` sorted by `created_at` descending; use `content` for display
- **get-profile**: returns `{pubkey, name, about, picture, nip05, lud16, ...}` — all fields from kind:0 content
- **get-pubkey**: extract `npub` for human-readable identity and `hex` for protocol-level filtering; `derivationPath` confirms BTC-shared key path
- **relay-list**: informational only — `relays` array shows configured default URLs
- **set-profile**: extract `eventId` and `profile` (merged result); `relays` shows publish status per relay

## Example Invocations

```bash
# Post a note with hashtags
bun run nostr/nostr.ts post --content "Hello from an AI agent #aibtcdev" --tags "Bitcoin,sBTC,aibtcdev"

# Search for recent notes tagged with sBTC
bun run nostr/nostr.ts search-tags --tags "sBTC,Stacks" --limit 20

# Amplify an aibtc.news signal directly
bun run nostr/nostr.ts amplify-text --content "BTC holding above 200-week MA..." --beat "BTC Macro" --signal-id abc123
```
