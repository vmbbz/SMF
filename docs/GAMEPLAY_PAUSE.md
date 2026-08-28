# Gameplay Pause Ownership

StickLash pauses an active fight whenever a modal or external approval flow would prevent a player from controlling the match. Pausing is reason-aware: every surface owns one reason, and the fight resumes only when the final active reason is released.

## Event channels

- `smf_gameplay_pause`: read-only overlays and in-game confirmations, including Help, Economy & Rewards, Arena Status, and token switching.
- `smf_wallet_action_pause`: wallet connection, secure sign-in, boost purchase, and other wallet-controlled flows.

Both channels feed the same pause-reason ledger in `Game`. The separate channels preserve truthful UI semantics without weakening wallet safety.

## Ownership rules

1. A surface adds its reason only when it actually takes control away from an active fight.
2. A surface removes only the reason it added. It must never clear every reason.
3. A nested-modal handoff acquires the destination reason before releasing the source reason.
4. A returning handoff reopens and acquires the parent before releasing the child.
5. A held reason is released when its surface closes even if screen state changed while it was open.
6. The simulation clock is reset only after the ledger becomes empty, avoiding a large catch-up frame on resume.

The Help → Rewards → Help sequence is therefore:

```text
help
help + economy
economy
economy + help
help
none -> resume
```

Arena Status follows the same sequence with `arena_status_page`. A simultaneous wallet reason remains in the ledger after Help closes, so the fight stays paused until that real wallet flow finishes or is cancelled.

## Adding another blocking surface

- Give it a stable, unique reason.
- Use `dispatchGameplayPause()` for non-wallet UI.
- Track whether that surface successfully acquired its reason.
- Release that reason on every close/exit path.
- Add concise pause copy in `src/gameplay-pause.js` that accurately names the open surface.
- Add a regression test proving nested handoffs never create an empty ledger before the final close and do end with an empty ledger.
