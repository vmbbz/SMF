import asyncio
import time
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

BIRDEYE_API_KEY = os.getenv("BIRDEYE_API_KEY", "")

# Separate client for DexScreener (no base_url prefix)
_ds_client = httpx.AsyncClient(timeout=8.0)

class BirdeyeService:
    def __init__(self):
        self.api_key = os.getenv("BIRDEYE_API_KEY")
        self.base_url = "https://public-api.birdeye.so"
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={
                "X-API-KEY": self.api_key or "",
                "x-chain": "solana",
                "accept": "application/json"
            },
            timeout=15.0
        )
        # Token overview cache: mint -> {data, ts}
        self.cache: dict = {}

        # List caches: "trending"|"graduated" -> (data_list, timestamp)
        self.list_cache: dict = {}

        # Tracks all mints we've ever seen (for churn detection)
        self._known_mints: set = set()

        # Inflight coalescing: mint -> asyncio.Event
        # Prevents N concurrent callers from all hitting Birdeye simultaneously
        # when a cache entry expires. First caller fetches; others wait.
        self._inflight: dict[str, asyncio.Event] = {}

        # Hot-token tracking: mint -> last_accessed timestamp
        # Tokens are "hot" (actively being fought) for 10 minutes after last access.
        self._hot_tokens: dict[str, float] = {}
        self._HOT_EXPIRY = 600  # 10 minutes without a fight-poll = no longer hot

        # Background warmer task
        self._warmer_task: asyncio.Task | None = None

    # TTL constants — two-tier by temperature
    HOT_TTL     = 90    # 1.5 min: active fight tokens (keeps boosts responsive)
    COLD_TTL    = 300   # 5 min:  listed but not being fought
    LIST_TTL    = 60    # 60s:   trending/graduated list snapshots
    HOT_STALE   = 80    # warmer re-fetches hot tokens before HOT_TTL expires
    COLD_STALE  = 280   # warmer re-fetches cold tokens before COLD_TTL expires

    # ─────────────────────────────────────────
    # Individual token — two-tier TTL + coalescing
    # Hot tokens (actively fought): 90s TTL — keeps boosts fast & responsive
    # Cold tokens (listed only):   300s TTL — display data, less critical
    # ─────────────────────────────────────────
    async def get_cached_token(self, mint: str, mark_hot: bool = False):
        """
        Fetch (or return cached) token data.
        mark_hot=True: called from a live fight — shorter TTL, warmer priority.
        """
        now = time.time()

        # Mark as hot if this is a live fight request
        if mark_hot:
            self._hot_tokens[mint] = now

        # Determine TTL based on temperature
        is_hot = (
            mark_hot or
            (mint in self._hot_tokens and now - self._hot_tokens[mint] < self._HOT_EXPIRY)
        )
        ttl = self.HOT_TTL if is_hot else self.COLD_TTL

        cached = self.cache.get(mint)
        if cached and now - cached["ts"] < ttl:
            return cached["data"]

        # Coalescing: if another coroutine is already fetching this mint,
        # wait for it rather than firing a duplicate Birdeye call.
        if mint in self._inflight:
            await self._inflight[mint].wait()
            return self.cache.get(mint, {}).get("data")

        event = asyncio.Event()
        self._inflight[mint] = event
        try:
            data = await self.get_token_overview(mint)
            if data:
                self.cache[mint] = {"data": data, "ts": time.time()}
            return data
        finally:
            event.set()
            self._inflight.pop(mint, None)

    async def get_token_overview(self, mint: str):
        try:
            # 1. Primary: Birdeye
            resp = await self.client.get(f"/defi/token_overview?address={mint}")
            item = {}
            if resp.status_code == 200:
                item = resp.json().get("data") or {}

            # 2. Augment gaps with DexScreener (uses its own client — no base_url prefix)
            try:
                ds_resp = await _ds_client.get(
                    f"https://api.dexscreener.com/latest/dex/tokens/{mint}"
                )
                if ds_resp.status_code == 200:
                    pairs = ds_resp.json().get("pairs") or []
                    if pairs:
                        p = pairs[0]
                        if not item.get("mc") and p.get("fdv"):
                            item["mc"] = p["fdv"]
                        if not item.get("v24hUSD"):
                            vol = p.get("volume") or {}
                            if vol.get("h24"):
                                item["v24hUSD"] = float(vol["h24"])
                        if not item.get("priceChange24h"):
                            pc = p.get("priceChange") or {}
                            if pc.get("h24") is not None:
                                item["priceChange24h"] = float(pc["h24"])
                        if not item.get("liquidity"):
                            liq = p.get("liquidity") or {}
                            if liq.get("usd"):
                                item["liquidity"] = float(liq["usd"])
                        if not item.get("symbol"):
                            bt = p.get("baseToken") or {}
                            item["symbol"] = bt.get("symbol", "MEME")
                            item["name"] = bt.get("name", "Unknown")
                        if not item.get("price"):
                            item["price"] = float(p.get("priceUsd") or 0)
                        if not item.get("logoURI") and not item.get("icon"):
                            info = p.get("info") or {}
                            img = info.get("imageUrl")
                            if img:
                                item["icon"] = img
            except Exception as e:
                print(f"[DexScreener] Augment failed for {mint}: {e}")

            if not item.get("address"):
                item["address"] = mint

            return self._normalize(item)
        except Exception as e:
            print(f"[Birdeye] Error fetching {mint}: {e}")
            return None

    def _normalize(self, item: dict) -> dict:
        holders_raw = item.get("holders")
        holders = holders_raw if isinstance(holders_raw, (int, float)) and holders_raw > 0 else "N/A"

        return {
            "mint":          item.get("address"),
            "symbol":        item.get("symbol") or "MEME",
            "name":          item.get("name") or item.get("symbol") or "Unknown",
            "logoURI":       item.get("logoURI") or item.get("icon"),
            "marketCap":     item.get("mc") or item.get("marketCap") or 0,
            "volume24h":     item.get("v24hUSD") or item.get("volume24h") or 0,
            "priceChange24h": item.get("priceChange24h") or 0,
            "liquidity":     item.get("liquidity") or 0,
            "price":         item.get("price") or 0,
            "holders":       holders,
            "dexscreenerUrl": f"https://dexscreener.com/solana/{item.get('address')}",
        }

    # ─────────────────────────────────────────
    # Trending list (cached 60s)
    # ─────────────────────────────────────────
    async def fetch_trending_tokens(self, limit: int = 12) -> list:
        cached = self.list_cache.get("trending")
        if cached and time.time() - cached[1] < 60:
            return cached[0][:limit]
        return await self._refresh_trending(limit)

    async def _refresh_trending(self, limit: int = 12) -> list:
        try:
            resp = await self.client.get("/defi/token_trending", params={"limit": limit})
            resp.raise_for_status()
            data = resp.json().get("data") or {}
            tokens = data.get("tokens") or []
            res = [self._normalize(item) for item in tokens[:limit]]
            self.list_cache["trending"] = (res, time.time())
            await self._handle_list_churn(res, "trending")
            return res
        except Exception as e:
            print(f"[Birdeye] Trending fetch error: {e}")
            cached = self.list_cache.get("trending")
            return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────
    # Graduated list (cached 60s)
    # ─────────────────────────────────────────
    async def fetch_graduated_tokens(self, limit: int = 8) -> list:
        cached = self.list_cache.get("graduated")
        if cached and time.time() - cached[1] < 60:
            return cached[0][:limit]
        return await self._refresh_graduated(limit)

    async def _refresh_graduated(self, limit: int = 8) -> list:
        try:
            resp = await self.client.get(
                "/defi/v2/tokens/new_listing",
                params={"limit": limit * 2, "meme_platform_enabled": "true"}
            )
            data = resp.json().get("data") or {}
            items = data.get("items") or []
            res = [self._normalize(item) for item in items
                   if item.get("liquidity", 0) > 10000][:limit]
            self.list_cache["graduated"] = (res, time.time())
            await self._handle_list_churn(res, "graduated")
            return res
        except Exception as e:
            print(f"[Birdeye] Graduated fetch error: {e}")
            cached = self.list_cache.get("graduated")
            return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────
    # Churn detection: pre-warm new tokens
    # ─────────────────────────────────────────
    async def _handle_list_churn(self, new_list: list, list_name: str):
        """
        Detect tokens that just appeared in the list and pre-warm their
        individual overview cache proactively (avoids cold-cache hit when
        a player clicks them right after a list refresh).
        """
        new_mints = {t["mint"] for t in new_list if t.get("mint")}
        arrived   = new_mints - self._known_mints

        if arrived:
            print(f"[Birdeye] {list_name}: {len(arrived)} new token(s) arrived, pre-warming...")
            # Pre-warm in background — don't block the list response
            asyncio.create_task(self._prewarm_batch(list(arrived)))

        # We don't remove from _known_mints — we keep fighting tokens
        # available via /api/token/{mint} even after they leave the list.
        self._known_mints |= new_mints

    async def _prewarm_batch(self, mints: list, hot: bool = False):
        """Sequentially warm individual caches for new/stale tokens (rate-limit safe)."""
        stale_after = self.HOT_STALE if hot else self.COLD_STALE
        for mint in mints:
            if mint not in self.cache or (time.time() - self.cache[mint]["ts"]) > stale_after:
                await self.get_cached_token(mint, mark_hot=hot)
                await asyncio.sleep(0.6)  # ~1.6 req/s — safe for Birdeye free tier

    # ─────────────────────────────────────────
    # Background warmer — runs server-side
    # ─────────────────────────────────────────
    async def _warmer_loop(self):
        """
        3-phase background warmer:
          Phase 1 — Refresh list snapshots (trending + graduated) every 55s
          Phase 2 — Re-warm HOT tokens (actively being fought) every cycle (90s TTL)
          Phase 3 — Re-warm COLD listed tokens (display only, 300s TTL, best-effort)

        Rate budget estimate (30 unique hot tokens, 20 cold listed):
          ~2 list calls + ~6 hot overviews + ~2 cold overviews = ~10 calls/min = 17% of free tier.
        """
        # Initial warm-up at startup
        await asyncio.sleep(2)
        print("[BirdeyeWarmer] Initial cache warm-up...")
        await self._refresh_trending(12)
        await asyncio.sleep(1)
        await self._refresh_graduated(8)
        print("[BirdeyeWarmer] Initial warm-up complete.")

        while True:
            await asyncio.sleep(55)
            try:
                now = time.time()

                # ── Phase 1: Refresh list snapshots ──
                print("[BirdeyeWarmer] Refreshing trending list...")
                await self._refresh_trending(12)
                await asyncio.sleep(2)
                print("[BirdeyeWarmer] Refreshing graduated list...")
                await self._refresh_graduated(8)
                await asyncio.sleep(2)

                # ── Phase 2: Re-warm HOT tokens (active fights, 90s TTL) ──
                # Expire stale hot entries first
                self._hot_tokens = {m: t for m, t in self._hot_tokens.items()
                                    if now - t < self._HOT_EXPIRY}
                hot_mints = list(self._hot_tokens.keys())
                if hot_mints:
                    stale_hot = [
                        m for m in hot_mints
                        if m not in self.cache or (now - self.cache[m]["ts"]) > self.HOT_STALE
                    ]
                    if stale_hot:
                        print(f"[BirdeyeWarmer] Re-warming {len(stale_hot)} hot token(s) (active fights)...")
                        await self._prewarm_batch(stale_hot, hot=True)
                        await asyncio.sleep(1)

                # ── Phase 3: Re-warm COLD listed tokens (300s TTL, best-effort) ──
                all_listed: set = set()
                trending_cache = self.list_cache.get("trending")
                graduated_cache = self.list_cache.get("graduated")
                if trending_cache:
                    all_listed |= {t["mint"] for t in trending_cache[0] if t.get("mint")}
                if graduated_cache:
                    all_listed |= {t["mint"] for t in graduated_cache[0] if t.get("mint")}

                # Exclude hot mints — already refreshed above
                cold_listed = all_listed - set(hot_mints)
                stale_cold = [
                    m for m in cold_listed
                    if m not in self.cache or (time.time() - self.cache[m]["ts"]) > self.COLD_STALE
                ]
                if stale_cold:
                    print(f"[BirdeyeWarmer] Re-warming {len(stale_cold)} cold token(s) (listed)...")
                    await self._prewarm_batch(stale_cold, hot=False)

            except Exception as e:
                print(f"[BirdeyeWarmer] Error during refresh: {e}")

    def start_background_warmer(self):
        """Call once from server lifespan to start the warmer coroutine."""
        if self._warmer_task is None or self._warmer_task.done():
            self._warmer_task = asyncio.create_task(self._warmer_loop())
            print("[BirdeyeWarmer] Background warmer started.")

    def stop_background_warmer(self):
        if self._warmer_task and not self._warmer_task.done():
            self._warmer_task.cancel()
            print("[BirdeyeWarmer] Background warmer stopped.")

birdeye_service = BirdeyeService()
