import time
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

BIRDEYE_API_KEY = os.getenv("BIRDEYE_API_KEY", "")

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
        self.cache = {}  # mint -> {data, ts}
        self.list_cache = {} # "trending"|"graduated" -> (data, timestamp)

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
            # 1. Fetch from Birdeye
            resp = await self.client.get(f"/defi/token_overview?address={mint}")
            item = {}
            if resp.status_code == 200:
                item = resp.json().get("data") or {}
            
            # 2. Fetch from DexScreener to augment missing data
            try:
                ds_resp = await self.client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
                if ds_resp.status_code == 200:
                    pairs = ds_resp.json().get("pairs", [])
                    if pairs:
                        p = pairs[0]
                        # Augment missing birdeye data
                        if not item.get("mc") and p.get("fdv"):
                            item["mc"] = p.get("fdv")
                        if not item.get("v24hUSD") and p.get("volume", {}).get("h24"):
                            item["v24hUSD"] = p.get("volume", {}).get("h24")
                        if not item.get("priceChange24h") and p.get("priceChange", {}).get("h24"):
                            item["priceChange24h"] = p.get("priceChange", {}).get("h24")
                        if not item.get("liquidity") and p.get("liquidity", {}).get("usd"):
                            item["liquidity"] = p.get("liquidity", {}).get("usd")
                        if not item.get("symbol") and p.get("baseToken", {}).get("symbol"):
                            item["symbol"] = p.get("baseToken", {}).get("symbol")
                            item["name"] = p.get("baseToken", {}).get("name")
            except Exception as e:
                print(f"[DexScreener] Error augmenting {mint}: {e}")

            item["address"] = mint
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
            "holders": "N/A",  # Holders requires paid Birdeye or Solscan (which is blocked)
            "dexscreenerUrl": f"https://dexscreener.com/solana/{item.get('address')}",
        }

    # Trending
    async def fetch_trending_tokens(self, limit=12):
        cached = self.list_cache.get("trending")
        if cached and time.time() - cached[1] < 60:
            return cached[0][:limit]
        try:
            resp = await self.client.get("/defi/token_trending", params={"limit": limit})
            resp.raise_for_status()
            data = resp.json().get("data") or {}
            tokens = data.get("tokens") or []
            res = [self._normalize(item) for item in tokens[:limit]]
            self.list_cache["trending"] = (res, time.time())
            return res
        except Exception as e:
            print(f"[Birdeye] Error fetching trending: {e}")
            return cached[0][:limit] if cached else []

    # Graduated (New Listings on Raydium usually from Pump.fun)
    async def fetch_graduated_tokens(self, limit=8):
        cached = self.list_cache.get("graduated")
        if cached and time.time() - cached[1] < 60:
            return cached[0][:limit]
        try:
            resp = await self.client.get("/defi/v2/tokens/new_listing", params={"limit": limit*2, "meme_platform_enabled": "true"})
            data = resp.json().get("data") or {}
            items = data.get("items") or []
            # Filter for graduated (liquidity > ~10k means it hit raydium)
            res = [self._normalize(item) for item in items if item.get("liquidity", 0) > 10000][:limit]
            self.list_cache["graduated"] = (res, time.time())
            return res
        except Exception as e:
            print(f"[Birdeye] Error fetching new listings: {e}")
            return cached[0][:limit] if cached else []

birdeye_service = BirdeyeService()
