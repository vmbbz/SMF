# Token Exhibition

Token Exhibition is StickLash's spectator-only token-versus-token mode. It turns two distinct, currently loaded Solana market tokens into autonomous fighters while keeping the mode completely outside paid boosts, ranked competition, leaderboards, and rewards.

## Why this mode exists

The previous Agent Lab compared one selected LLM persona with a generic local simulation fighter. That demonstrated AI control, but only one side carried a real token identity and the user could not immediately see why the matchup mattered.

Token Exhibition makes the market itself the matchup:

- both corners represent real token mints from the loaded market feed;
- both display their token name, symbol, icon, market rating, arena health, damage, speed, volume, and 24-hour change;
- both fight autonomously under the same local tactical engine;
- the match is fast enough to watch and reroll without allowing extreme market values to create a very long or one-hit fight.

It is an entertainment and market-visualization mode. It is not a forecast, trading signal, ranked match, or reward event.

## Matchup selection

The client builds one pool from:

1. a fresh request for up to 16 trending tokens;
2. tokens already loaded by the home and fight market strips;
3. the current Endless queue; and
4. the last valid Token Exhibition pool, so a temporary refresh failure does not erase already loaded real market data.

Candidates must have both a mint and a visible name or symbol. The pool is de-duplicated by exact, trimmed mint, preserving Solana public-key case and the first trusted representation. The selector builds every possible two-token combination and chooses one randomly. A reroll excludes the current unordered pair whenever another combination exists.

There are no fabricated fallback opponents. If fewer than two distinct valid mints are available, the screen says so, disables the Watch action, and leaves Retry/Randomize available.

Visual hydration may add richer token art from the existing token-details route. A visual failure does not change the selected token or its market data; the standard Solana image is used only as an image fallback.

## Market data to combat stats

StickLash first computes the existing market-power result from 24-hour volume, 24-hour price change, and liquidity. The true rating remains visible. Token Exhibition then applies a match-only translation:

| Arena value | Translation | Reason |
|---|---|---|
| Rating | Original market-power rating | Keeps the source comparison visible |
| Health | `clamp(80, 100 + log2(max(0.5, marketHealth / 100)) * 40, 240)` | Compresses extreme health without flattening relative strength |
| Damage | Existing damage multiplier, clamped to `0.8x–1.5x` | Prevents one-hit outcomes |
| Speed | Existing speed multiplied by `1.06`, clamped to `1.0x–1.25x` | Keeps autonomous fights active without destabilizing physics |

The compressed arena health is shown as `ARENA HP`; it does not replace or mislabel the visible market rating.

## Visible combat styles

Style selection is deterministic and evaluated in this order:

| Condition | Style | Tactical effect |
|---|---|---|
| 24h change at least `+15%` | Momentum Rush | Faster cadence, forward dashes, heavy finishers |
| 24h change at most `-10%` | Reversal Hunter | Retreats, counters, and comeback projectiles |
| Liquidity at least `$150k`, or at least `$50k` and `1.4x` volume | Liquidity Tank | Measured defense, crouching counters, ranged control |
| 24h volume at least `$75k` | Volume Pressure | Projectile openings and aggressive combo pressure |
| Anything else | Degen Wildcard | Acrobatics and unpredictable mixups |

These styles modify a small number of moves in the existing state-aware behavior-tree plan. They do not replace collision, damage, physics, or defensive logic. This preserves the combat engine while making market differences visible and fun.

## Autonomous runtime contract

Each corner owns an `LLMAdapter` configured in `localOnly` mode. In this configuration the adapter:

- reads current distance, health, grounded state, round time, and learned tactic outcomes;
- generates five-move plans through the local behavior tree;
- applies the token's style transform and cadence;
- never calls `/api/llm/command` or any external LLM provider.

The mode intentionally disables every human or economic path:

- no keyboard, touch, phone, voice, or remote input adapter is attached;
- mobile controls remain hidden and the global voice/boost hotkeys are ignored;
- the user's profile name and avatar cannot replace the left token;
- both token heads use the same scale;
- `LiveBoostSystem` is stopped and not started, because it only boosts one opponent in human-versus-token play;
- autonomous Hadoukens do not call the paid-boost settlement path and do not consume the user's inventory;
- no ELO, leaderboard result, reward eligibility, reward balance, or paid-boost count is written.

Sharing an exhibition result may increment the existing share-card evidence counter. That counter proves a generated share artifact only; it is not a match, impression, onchain-volume, leaderboard, or reward claim.

## Results and rematches

The round result names the winning token, or reports an Exhibition Draw when health is equal. Both result cards retain token identity and market context. The market button opens the winning token's supplied URL or its Solana DexScreener page.

`NEW TOKEN MATCHUP` performs a full local game and adapter teardown, returns to the exhibition loader, excludes the previous pair where possible, and starts the fresh autonomous matchup. It cannot fall through to the human-versus-token rematch path.

## Verification contract

The automated suite must prove:

- token de-duplication and distinct-mint pairing;
- transparent failure below two valid tokens;
- reroll exclusion when another pair exists;
- style thresholds and bounded power translation;
- non-mutating plan transformations;
- local-only agents make zero provider requests;
- the public screen exposes both token corners and the spectator-only safety statement.

Before release, run `npm test`, `npm run build`, and `npx cap sync android`. Capacitor synchronization packages the updated web mode into Android assets; it does not create or publish an APK.
