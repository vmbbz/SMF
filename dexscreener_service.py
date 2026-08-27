from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx


class DexScreenerService:
    """Cached token-detail service for active gameplay.

    Birdeye is intentionally reserved for list discovery. Live fights, token
    logos, backgrounds, boost checks, and payment price lookups use DexScreener
    so gameplay does not burn Birdeye compute on per-token detail polling.
    """

    BASE_URL = "https://api.dexscreener.com"
    FRESH_TTL = 60
    STALE_TTL = 15 * 60

    def __init__(self) -> None:
        self.client = httpx.AsyncClient(base_url=self.BASE_URL, timeout=8.0)
        self.cache: dict[str, dict[str, Any]] = {}
        self._inflight: dict[str, asyncio.Event] = {}

    def _ensure_client(self) -> None:
        if self.client.is_closed:
            self.client = httpx.AsyncClient(base_url=self.BASE_URL, timeout=8.0)

    async def close(self) -> None:
        if not self.client.is_closed:
            await self.client.aclose()

    async def get_cached_token(self, mint: str) -> dict[str, Any] | None:
        mint = str(mint or "").strip()
        if not mint:
            return None

        now = time.time()
        cached = self.cache.get(mint)
        if cached and now - cached["ts"] < self.FRESH_TTL:
            return cached["data"]

        if mint in self._inflight:
            await self._inflight[mint].wait()
            cached = self.cache.get(mint)
            return cached["data"] if cached else None

        event = asyncio.Event()
        self._inflight[mint] = event
        try:
            data = await self._fetch_token(mint)
            if data:
                self.cache[mint] = {"data": data, "ts": time.time()}
                return data

            # Serve stale data if DexScreener is temporarily unhappy.
            if cached and now - cached["ts"] < self.STALE_TTL:
                return cached["data"]
            return None
        finally:
            event.set()
            self._inflight.pop(mint, None)

    async def _fetch_token(self, mint: str) -> dict[str, Any] | None:
        try:
            self._ensure_client()
            resp = await self.client.get(f"/latest/dex/tokens/{mint}")
            resp.raise_for_status()
            pairs = (resp.json() or {}).get("pairs") or []
            if not pairs:
                return None

            pair = self._choose_best_pair(pairs, mint)
            return self._normalize_pair(pair, mint)
        except Exception as exc:
            print(f"[DexScreener] Detail fetch failed for {mint}: {exc}")
            return None

    @staticmethod
    def _choose_best_pair(pairs: list[dict[str, Any]], mint: str) -> dict[str, Any]:
        def score(pair: dict[str, Any]) -> tuple[int, float]:
            base = pair.get("baseToken") or {}
            matches_base = 1 if str(base.get("address") or "") == mint else 0
            liquidity = ((pair.get("liquidity") or {}).get("usd") or 0) or 0
            try:
                liquidity_value = float(liquidity)
            except (TypeError, ValueError):
                liquidity_value = 0.0
            return matches_base, liquidity_value

        return max(pairs, key=score)

    @staticmethod
    def _float(value: Any, default: float = 0.0) -> float:
        try:
            if value is None or value == "":
                return default
            return float(value)
        except (TypeError, ValueError):
            return default

    def _normalize_pair(self, pair: dict[str, Any], mint: str) -> dict[str, Any]:
        base = pair.get("baseToken") or {}
        info = pair.get("info") or {}
        liquidity = pair.get("liquidity") or {}
        volume = pair.get("volume") or {}
        price_change = pair.get("priceChange") or {}

        image = info.get("imageUrl")
        header = info.get("header")
        open_graph = info.get("openGraph")
        cover = header or open_graph

        return {
            "mint": mint,
            "address": mint,
            "symbol": base.get("symbol") or "MEME",
            "name": base.get("name") or base.get("symbol") or "Unknown",
            "logoURI": image,
            "icon": image,
            "image": image,
            "coverImage": cover,
            "headerImage": header or cover,
            "openGraphImage": open_graph,
            "marketCap": self._float(pair.get("marketCap") or pair.get("fdv")),
            "fdv": self._float(pair.get("fdv")),
            "volume24h": self._float(volume.get("h24")),
            "priceChange24h": self._float(price_change.get("h24")),
            "liquidity": self._float(liquidity.get("usd")),
            "price": self._float(pair.get("priceUsd")),
            "holders": "N/A",
            "dexscreenerUrl": pair.get("url") or f"https://dexscreener.com/solana/{mint}",
            "pairAddress": pair.get("pairAddress"),
            "chainId": pair.get("chainId"),
            "websites": info.get("websites") or [],
            "socials": info.get("socials") or [],
            "links": info.get("links") or [],
            "source": "dexscreener",
            "updatedAt": int(time.time()),
        }


dexscreener_service = DexScreenerService()
