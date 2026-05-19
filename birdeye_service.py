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

        # Background warmer task
        self._warmer_task: asyncio.Task | None = None

    # TTL constants
    TOKEN_TTL   = 300   # 5 min — fine for boost detection (20%+ swings take minutes)
    LIST_TTL    = 60    # 60s for trending/graduated lists (they churn fast)
    STALE_AFTER = 280   # refresh individual tokens before the 5-min TTL expires

    # ─────────────────────────────────────────
    # Individual token (cached TOKEN_TTL seconds, coalesced)
    # ─────────────────────────────────────────
    async def get_cached_token(self, mint: str):
        cached = self.cache.get(mint)
        if cached and time.time() - cached["ts"] < self.TOKEN_TTL:
            return cached["data"]

        # ── Coalescing: if another coroutine is already fetching this mint,
        # wait for it to finish rather than firing a duplicate Birdeye call.
        if mint in self._inflight:
            await self._inflight[mint].wait()
            # By now the cache should be populated by the winning coroutine
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

    async def _prewarm_batch(self, mints: list):
        """Sequentially warm individual caches for new/stale tokens (rate-limit safe)."""
        for mint in mints:
            if mint not in self.cache or (time.time() - self.cache[mint]["ts"]) > self.STALE_AFTER:
                await self.get_cached_token(mint)
                await asyncio.sleep(0.6)  # ~1.6 req/s — safe for Birdeye free tier

    # ─────────────────────────────────────────
    # Background warmer — runs server-side
    # ─────────────────────────────────────────
    async def _warmer_loop(self):
        """
        Refresh trending + graduated lists every 55s (just under the 60s TTL)
        so they are always hot in memory when users request them.
        Rate budget: 2 list calls every 55s = ~2.2 calls/min — well under Birdeye free tier.
        Individual pre-warms are sequenced at 0.5s apart to stay safe.
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
                print("[BirdeyeWarmer] Refreshing trending list...")
                await self._refresh_trending(12)
                await asyncio.sleep(2)
                print("[BirdeyeWarmer] Refreshing graduated list...")
                await self._refresh_graduated(8)
                await asyncio.sleep(2)

                # ── Keep all currently-listed tokens always warm ──
                # Collect every mint from both lists, refresh those whose
                # individual cache has gone stale (>55s). This ensures
                # zero cold-cache hits no matter which token a player clicks.
                all_listed = set()
                trending_cache = self.list_cache.get("trending")
                graduated_cache = self.list_cache.get("graduated")
                if trending_cache:
                    all_listed |= {t["mint"] for t in trending_cache[0] if t.get("mint")}
                if graduated_cache:
                    all_listed |= {t["mint"] for t in graduated_cache[0] if t.get("mint")}

                stale = [
                    m for m in all_listed
                    if m not in self.cache or (time.time() - self.cache[m]["ts"]) > self.STALE_AFTER
                ]
                if stale:
                    print(f"[BirdeyeWarmer] Refreshing {len(stale)} stale token overview(s)...")
                    await self._prewarm_batch(stale)

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
