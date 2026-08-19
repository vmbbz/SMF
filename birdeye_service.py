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


def _normalize_pair(pair: dict[str, Any]) -> dict[str, Any]:
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

    return {
        "mint":           address,
        "address":        address,
        "symbol":         base.get("symbol") or "MEME",
        "name":           base.get("name") or base.get("symbol") or "Unknown",
        "logoURI":        info.get("imageUrl"),
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
    Token-list discovery service — now Base chain via DexScreener.

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
    # Trending — top Base pairs by volume (3-min cache)
    # ─────────────────────────────────────────────
    async def fetch_trending_tokens(self, limit: int = 12) -> list[dict[str, Any]]:
        return await self._get_list("trending", limit)

    async def _refresh_trending(self, limit: int = 12) -> list[dict[str, Any]]:
        """Fetch top Base pairs from DexScreener boosted/trending endpoint."""
        try:
            # DexScreener's token profiles / trending for Base
            resp = await self._client.get(
                "/token-profiles/latest/v1",
                params={"chainId": "base"},
            )
            if resp.is_success:
                profiles = resp.json() if isinstance(resp.json(), list) else []
                # profiles gives us token addresses; fetch pair details next
                addresses = [p.get("tokenAddress") for p in profiles if p.get("tokenAddress")]
                if addresses:
                    tokens = await self._batch_fetch_pairs(addresses[:limit])
                    if tokens:
                        return tokens

            # Fallback: search for active Base pairs
            return await self._search_base_pairs(limit, min_liquidity=5_000)
        except Exception as exc:
            print(f"[Discovery] Trending fetch error: {exc}")
            cached = self.list_cache.get("trending")
            return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────────
    # Graduated — Base tokens with solid liquidity (analogous to pump.fun grads)
    # ─────────────────────────────────────────────
    async def fetch_graduated_tokens(self, limit: int = 8) -> list[dict[str, Any]]:
        return await self._get_list("graduated", limit)

    async def _refresh_graduated(self, limit: int = 8) -> list[dict[str, Any]]:
        """Base 'graduates': pairs with >$10k liquidity, sorted by volume."""
        try:
            tokens = await self._search_base_pairs(limit, min_liquidity=_GRAD_MIN_LIQUIDITY)
            return tokens
        except Exception as exc:
            print(f"[Discovery] Graduated fetch error: {exc}")
            cached = self.list_cache.get("graduated")
            return cached[0][:limit] if cached else []

    # ─────────────────────────────────────────────
    # Shared helpers
    # ─────────────────────────────────────────────
    async def _search_base_pairs(
        self, limit: int, min_liquidity: float = 0
    ) -> list[dict[str, Any]]:
        """Search DexScreener for active Base chain pairs, sorted by volume."""
        resp = await self._client.get(
            "/latest/dex/search",
            params={"q": "base"},
        )
        resp.raise_for_status()
        pairs = (resp.json() or {}).get("pairs") or []
        base_pairs = [
            p for p in pairs
            if p.get("chainId") == "base"
            and p.get("baseToken", {}).get("address")
            and float((p.get("liquidity") or {}).get("usd") or 0) >= min_liquidity
        ]
        # Sort by 24h volume descending
        base_pairs.sort(
            key=lambda p: float((p.get("volume") or {}).get("h24") or 0),
            reverse=True,
        )
        result = [_normalize_pair(p) for p in base_pairs[:limit]]
        return result

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
