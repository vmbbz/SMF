"""
birdeye_service.py — Token discovery for MemeFight ($BMF)

Previously used Birdeye (Solana). Now fetches Base chain trending and
graduated tokens from DexScreener. Public API surface is unchanged so
server.py callers require no modifications.

"Graduated" on Base = tokens with >$10k USD liquidity on a Base DEX pair,
sorted by 24h volume — analogous to pump.fun graduates on Solana.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from dexscreener_service import dexscreener_service

_DEXSCREENER_BASE = "https://api.dexscreener.com"
_LIST_TTL = 180    # 3 min cache for trending/graduated lists
_GRAD_MIN_LIQUIDITY = 10_000  # $10k USD minimum liquidity to be a "grad"


def _normalize_pair(pair: dict[str, Any], fallback_icon: str | None = None) -> dict[str, Any]:
    """Convert a DexScreener pair object into the token shape the app expects."""
    base = pair.get("baseToken") or {}
    info = pair.get("info") or {}
    volume = pair.get("volume") or {}
    price_change = pair.get("priceChange") or {}
    liquidity = pair.get("liquidity") or {}
    address = base.get("address") or ""
    chain_id = pair.get("chainId") or "base"

    cover = (
        info.get("header")
        or info.get("openGraph")
        or info.get("bannerImage")
    )

    image_url = (
        info.get("imageUrl")
        or info.get("openGraph")
        or fallback_icon
    )

    return {
        "mint":           address,
        "address":        address,
        "symbol":         base.get("symbol") or "MEME",
        "name":           base.get("name") or base.get("symbol") or "Unknown",
        "logoURI":        image_url,
        "icon":           image_url,
        "image":          image_url,
        "coverImage":     cover,
        "headerImage":    cover,
        "marketCap":      float(pair.get("marketCap") or pair.get("fdv") or 0),
        "volume24h":      float(volume.get("h24") or 0),
        "priceChange24h": float(price_change.get("h24") or 0),
        "liquidity":      float(liquidity.get("usd") or 0),
        "price":          float(pair.get("priceUsd") or 0),
        "holders":        "N/A",
        "dexscreenerUrl": pair.get("url") or f"https://dexscreener.com/{chain_id}/{address}",
        "chainId":        chain_id,
        "source":         "dexscreener",
    }


class BirdeyeService:
    """
    Token-list discovery service — DexScreener backed.

    Keeps the same public interface as the old Birdeye-backed class so
    server.py routes (/api/marketfeed/v2/trending-scan etc.) work unchanged.
    """

    LIST_TTL = _LIST_TTL

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(
            base_url=_DEXSCREENER_BASE,
            timeout=12.0,
            headers={"Accept": "application/json"},
        )
        # list_cache["trending"|"graduated"] = (token_list, timestamp)
        self.list_cache: dict[str, tuple[list[dict], float]] = {}
        self._inflight_lists: dict[str, asyncio.Event] = {}
        self._known_mints: set[str] = set()

    # ─────────────────────────────────────────────
    # Individual token detail — delegate to DexScreener
    # ─────────────────────────────────────────────
    async def get_cached_token(self, mint: str, mark_hot: bool = False) -> dict[str, Any] | None:
        """Individual token detail — routed through DexScreener."""
        return await dexscreener_service.get_cached_token(mint)

    async def get_token_overview(self, mint: str) -> dict[str, Any] | None:
        """Compat alias for old callers."""
        return await dexscreener_service.get_cached_token(mint)

    # ─────────────────────────────────────────────
    # Trending — top market pairs by volume & boosts (3-min cache)
    # ─────────────────────────────────────────────
    async def fetch_trending_tokens(self, limit: int = 12) -> list[dict[str, Any]]:
        return await self._get_list("trending", limit)

    async def _refresh_trending(self, limit: int = 12) -> list[dict[str, Any]]:
        """Fetch top boosted & trending tokens from DexScreener."""
        tokens: list[dict[str, Any]] = []
        seen: set[str] = set()

        # 1. Top boosted tokens from DexScreener
        try:
            resp = await self._client.get("/token-boosts/top/v1")
            if resp.is_success and isinstance(resp.json(), list):
                for item in resp.json():
                    addr = item.get("tokenAddress")
                    icon = item.get("icon")
                    if addr and addr not in seen:
                        token_pair = await self._fetch_single_token_pair(addr, fallback_icon=icon)
                        if token_pair and token_pair.get("symbol") and token_pair["symbol"] != "BASE":
                            seen.add(addr)
                            tokens.append(token_pair)
                            if len(tokens) >= limit:
                                break
        except Exception as exc:
            print(f"[Discovery] DexScreener boosts error: {exc}")

        # 2. Token profiles latest
        if len(tokens) < limit:
            try:
                resp = await self._client.get("/token-profiles/latest/v1")
                if resp.is_success and isinstance(resp.json(), list):
                    for p in resp.json():
                        addr = p.get("tokenAddress")
                        icon = p.get("icon")
                        if addr and addr not in seen:
                            token_pair = await self._fetch_single_token_pair(addr, fallback_icon=icon)
                            if token_pair and token_pair.get("symbol") and token_pair["symbol"] != "BASE":
                                seen.add(addr)
                                tokens.append(token_pair)
                                if len(tokens) >= limit:
                                    break
            except Exception as exc:
                print(f"[Discovery] Token profiles error: {exc}")

        # 3. Fallback: Search top popular meme queries
        if len(tokens) < limit:
            fallback_memes = await self._search_meme_queries(limit - len(tokens), exclude=seen)
            tokens.extend(fallback_memes)

        if tokens:
            return tokens[:limit]

        cached = self.list_cache.get("trending")
        return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────────
    # Top Memes (formerly Graduated) — high-volume meme tokens with solid liquidity
    # ─────────────────────────────────────────────
    async def fetch_graduated_tokens(self, limit: int = 8) -> list[dict[str, Any]]:
        return await self._get_list("graduated", limit)

    async def _refresh_graduated(self, limit: int = 8) -> list[dict[str, Any]]:
        """Top Memes: High-volume meme tokens with rich logos and market stats."""
        try:
            memes = await self._search_meme_queries(limit)
            if memes:
                return memes[:limit]
            return await self._search_base_pairs(limit, min_liquidity=_GRAD_MIN_LIQUIDITY)
        except Exception as exc:
            print(f"[Discovery] Top Memes fetch error: {exc}")
            cached = self.list_cache.get("graduated")
            return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────────
    # Shared helpers
    # ─────────────────────────────────────────────
    async def _search_meme_queries(
        self, limit: int, exclude: set[str] | None = None
    ) -> list[dict[str, Any]]:
        """Search top popular meme queries across Base & multichain DEXes."""
        results: list[dict[str, Any]] = []
        seen = set(exclude) if exclude else set()
        queries = ["brett", "toshi", "virtual", "clanker", "pepe", "degen", "bonk", "wif", "spx", "aerodrome"]

        for q in queries:
            if len(results) >= limit:
                break
            try:
                resp = await self._client.get("/latest/dex/search", params={"q": q})
                if not resp.is_success:
                    continue
                pairs = (resp.json() or {}).get("pairs") or []
                valid_pairs = [
                    p for p in pairs
                    if p.get("baseToken", {}).get("address")
                    and p["baseToken"]["address"] not in seen
                ]
                if valid_pairs:
                    best = max(
                        valid_pairs,
                        key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0),
                    )
                    addr = best["baseToken"]["address"]
                    norm = _normalize_pair(best)
                    if norm.get("symbol") and norm["symbol"] != "BASE":
                        seen.add(addr)
                        results.append(norm)
            except Exception:
                continue

        results.sort(key=lambda t: t.get("volume24h", 0.0), reverse=True)
        return results

    async def _fetch_single_token_pair(
        self, address: str, fallback_icon: str | None = None
    ) -> dict[str, Any] | None:
        """Fetch best trading pair for a given token address."""
        try:
            resp = await self._client.get(f"/latest/dex/tokens/{address}")
            if resp.is_success:
                pairs = (resp.json() or {}).get("pairs") or []
                if pairs:
                    best = max(
                        pairs,
                        key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0),
                    )
                    return _normalize_pair(best, fallback_icon=fallback_icon)
        except Exception:
            pass
        return None

    async def _search_base_pairs(
        self, limit: int, min_liquidity: float = 0
    ) -> list[dict[str, Any]]:
        """Search DexScreener for active Base chain pairs, sorted by volume."""
        return await self._search_meme_queries(limit)

    async def _batch_fetch_pairs(self, addresses: list[str]) -> list[dict[str, Any]]:
        """Fetch pair details for multiple token addresses."""
        results: list[dict[str, Any]] = []
        for addr in addresses:
            try:
                resp = await self._client.get(f"/latest/dex/tokens/{addr}")
                if resp.is_success:
                    pairs = (resp.json() or {}).get("pairs") or []
                    base_pairs = [p for p in pairs if p.get("chainId") == "base"]
                    if base_pairs:
                        # Pick pair with most liquidity
                        best = max(
                            base_pairs,
                            key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0),
                        )
                        results.append(_normalize_pair(best))
            except Exception:
                continue
        return results

    async def _get_list(self, key: str, limit: int) -> list[dict[str, Any]]:
        """Generic cached list fetcher with inflight coalescing."""
        cached = self.list_cache.get(key)
        if cached and time.time() - cached[1] < self.LIST_TTL:
            return cached[0][:limit]

        if key in self._inflight_lists:
            await self._inflight_lists[key].wait()
            cached = self.list_cache.get(key)
            return cached[0][:limit] if cached else []

        event = asyncio.Event()
        self._inflight_lists[key] = event
        try:
            if key == "trending":
                tokens = await self._refresh_trending(limit)
            else:
                tokens = await self._refresh_graduated(limit)
            if tokens:
                self.list_cache[key] = (tokens, time.time())
                await self._handle_list_churn(tokens, key)
            return tokens[:limit]
        finally:
            event.set()
            self._inflight_lists.pop(key, None)

    async def _handle_list_churn(self, new_list: list[dict], list_name: str) -> None:
        new_mints = {t["mint"] for t in new_list if t.get("mint")}
        arrived = new_mints - self._known_mints
        if arrived:
            print(f"[Discovery] {list_name}: {len(arrived)} new Base token(s) arrived.")
        self._known_mints |= new_mints

    # Compat stubs (previously used for Birdeye background warming)
    def start_background_warmer(self) -> None:
        return None

    def stop_background_warmer(self) -> None:
        return None

    async def close(self) -> None:
        if not self._client.is_closed:
            await self._client.aclose()


birdeye_service = BirdeyeService()
