import time
import httpx
import os

BIRDEYE_API_KEY = os.getenv("BIRDEYE_API_KEY", "")

class BirdeyeService:
    def __init__(self):
        self.client = httpx.AsyncClient(
            base_url="https://public-api.birdeye.so",
            headers={
                "X-API-KEY": BIRDEYE_API_KEY,
                "x-chain": "solana",
                "accept": "application/json"
            },
            timeout=8.0
        )
        self.cache = {}  # mint -> {data, ts}

    async def get_cached_token(self, mint: str):
        cached = self.cache.get(mint)
        if cached and time.time() - cached["ts"] < 60:
            return cached["data"]

        data = await self.get_token_overview(mint)
        if data:
            self.cache[mint] = {"data": data, "ts": time.time()}
        return data

    async def get_token_overview(self, mint: str):
        try:
            resp = await self.client.get(f"/defi/token_overview?address={mint}")
            resp.raise_for_status()
            item = resp.json().get("data") or {}
            return self._normalize(item)
        except Exception as e:
            print(f"[Birdeye] Error fetching {mint}: {e}")
            return None

    def _normalize(self, item):
        return {
            "mint": item.get("address"),
            "symbol": item.get("symbol") or "MEME",
            "name": item.get("name") or item.get("symbol") or "Unknown",
            "logoURI": item.get("logoURI") or item.get("icon"),
            "marketCap": item.get("mc") or item.get("marketCap") or 0,
            "volume24h": item.get("v24hUSD") or item.get("volume24h") or 0,
            "priceChange24h": item.get("priceChange24h") or 0,
            "liquidity": item.get("liquidity") or 0,
            "holders": item.get("holders") or 0,          # will be 0 on free tier
            "dexscreenerUrl": f"https://dexscreener.com/solana/{item.get('address')}",
        }

    # Trending
    async def fetch_trending_tokens(self, limit=12):
        try:
            resp = await self.client.get("/defi/token_trending", params={"limit": limit})
            data = resp.json().get("data") or {}
            tokens = data.get("tokens") or []
            return [self._normalize(item) for item in tokens[:limit]]
        except Exception as e:
            print(f"[Birdeye] Error fetching trending: {e}")
            return []

    # Graduates / new listings
    async def fetch_graduated_tokens(self, limit=8):
        try:
            resp = await self.client.get("/defi/v2/tokens/new_listing", params={"limit": limit*2, "meme_platform_enabled": "true"})
            data = resp.json().get("data") or {}
            items = data.get("items") or []
            # Filter for graduated (high MCAP)
            return [self._normalize(item) for item in items if item.get("mc", 0) > 69000][:limit]
        except Exception as e:
            print(f"[Birdeye] Error fetching new listings: {e}")
            return []

birdeye_service = BirdeyeService()
