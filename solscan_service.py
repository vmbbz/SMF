import os
import time
import asyncio
import logging
from typing import Optional, Dict, Any, List
import httpx

logger = logging.getLogger("solscan_service")

API_BASE_URL = 'https://pro-api.solscan.io/v2.0'
SOLSCAN_API_KEY = os.getenv("SOLSCAN_API_KEY", "")

def normalize_solscan_url(url: Any) -> str:
    if not url or not isinstance(url, str):
        return ""
    if url.startswith('ipfs://'):
        return f"https://ipfs.io/ipfs/{url[len('ipfs://'):]}"
    return url

class SolscanService:
    def __init__(self):
        headers = {
            'accept': 'application/json',
            'token': SOLSCAN_API_KEY
        }
        self.client = httpx.AsyncClient(base_url=API_BASE_URL, headers=headers, timeout=10.0)
        self.token_cache: Dict[str, Dict[str, Any]] = {}
        if not SOLSCAN_API_KEY:
            logger.warning('[SolscanService] SOLSCAN_API_KEY is not configured. Solscan features will be unavailable.')

    async def make_request(self, endpoint: str, params: Optional[Dict[str, Any]] = None) -> Optional[Any]:
        if not SOLSCAN_API_KEY:
            return None
        try:
            response = await self.client.get(endpoint, params=params)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"[SolscanService] API error for endpoint {endpoint}: {e}")
            return None

    async def get_latest_tokens(self, limit: int = 50) -> Optional[List[Dict[str, Any]]]:
        result = await self.make_request('/token/latest', {'limit': limit})
        return result.get('data') if result else None

    async def get_trending_tokens(self, limit: int = 20) -> Optional[List[Dict[str, Any]]]:
        result = await self.make_request('/token/trending', {'limit': limit})
        return result.get('data') if result else None

    async def get_token_metadata(self, token_address: str) -> Optional[Dict[str, Any]]:
        result = await self.make_request('/token/meta', {'address': token_address})
        if not result:
            return None
        icon = normalize_solscan_url(result.get('icon')) if result.get('icon') else result.get('icon')
        metadata = result.get('metadata') or {}
        normalized_image = normalize_solscan_url(metadata.get('image')) if metadata.get('image') else metadata.get('image')
        metadata['image'] = normalized_image
        result['icon'] = icon
        result['metadata'] = metadata
        result['metadata_uri'] = normalize_solscan_url(result.get('metadata_uri')) if result.get('metadata_uri') else result.get('metadata_uri')
        return result

    async def get_market_info(self, token_address: str) -> Optional[Dict[str, Any]]:
        return await self.make_request(f"/market/token/{token_address}")

    async def get_cached_token(self, mint: str) -> Optional[Dict[str, Any]]:
        cached = self.token_cache.get(mint)
        now = time.time() * 1000  # JS style timestamp in ms
        if cached and now - cached['timestamp'] < 60000:
            logger.info(f"[SolscanService] Cache HIT for {mint}")
            return cached['data']
        
        logger.info(f"[SolscanService] Cache MISS for {mint}. Fetching fresh...")
        data = await self.fetch_token_details(mint)
        if data:
            self.token_cache[mint] = {'data': data, 'timestamp': now}
        return data

    async def fetch_token_details(self, token_address: str) -> Optional[Dict[str, Any]]:
        logger.info(f"[SolscanService] Fetching details for {token_address}")
        try:
            metadata, market_info = await asyncio.gather(
                self.get_token_metadata(token_address),
                self.get_market_info(token_address),
                return_exceptions=True
            )

            # Check if exceptions were raised
            if isinstance(metadata, Exception) or isinstance(market_info, Exception):
                logger.error(f"[SolscanService] Exception during gather for {token_address}: meta={metadata}, market={market_info}")
                return None

            if not metadata or not market_info:
                logger.warning(f"[SolscanService] Could not retrieve full details for {token_address}.")
                return None

            socials = {}
            if metadata.get('socials'):
                for s in metadata['socials']:
                    if s.get('type') and s.get('url'):
                        socials[s['type'].lower()] = s['url']

            price_data = {
                'tokenAddress': token_address,
                'pairAddress': market_info.get('market_address'),
                'exchangeName': market_info.get('market_name', 'Unknown'),
                'logo': metadata.get('icon'),
                'name': metadata.get('name'),
                'symbol': metadata.get('symbol'),
                'usdPrice': market_info.get('price_usd'),
                'usdPrice24h': market_info.get('price_usd') / (1 + (market_info.get('price_change_24h', 0) / 100)) if market_info.get('price_usd') else 0,
                'usdPrice24hrPercentChange': market_info.get('price_change_24h'),
            }

            holders_data = {
                'tokenAddress': token_address,
                'tokenName': metadata.get('name'),
                'tokenSymbol': metadata.get('symbol'),
                'tokenLogo': metadata.get('icon'),
                'exchange': market_info.get('market_name'),
                'pairAddress': market_info.get('market_address'),
                'pairLabel': f"{metadata.get('symbol')}/SOL",
                'totalLiquidityUsd': market_info.get('liquidity_usd'),
                'marketCap': market_info.get('market_cap_fully_diluted'),
                'pricePercentChange': {
                    '24h': market_info.get('price_change_24h', 0),
                },
                'totalVolume': {
                    '24h': market_info.get('volume_24h', 0),
                },
                'holders': metadata.get('holder', 100),
            }

            return {
                'price': {'data': price_data},
                'holders': holders_data,
                'pairAddress': market_info.get('market_address'),
                'description': metadata.get('description'),
                'links': socials,
                'website': metadata.get('website'),
                'symbol': metadata.get('symbol'),
            }
        except Exception as e:
            logger.error(f"[SolscanService] Error in fetch_token_details for {token_address}: {e}")
            return None

    async def fetch_trending_tokens(self, limit: int = 9) -> List[Dict[str, Any]]:
        logger.info(f"[SolscanService] Fetching {limit} trending tokens.")
        trending_tokens = await self.get_trending_tokens(limit)
        if not trending_tokens:
            logger.warning('[SolscanService] Failed to fetch trending tokens list.')
            return []

        async def enrich(token: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            addr = token.get('address')
            if not addr:
                return None
            try:
                metadata, market_info = await asyncio.gather(
                    self.get_token_metadata(addr),
                    self.get_market_info(addr),
                    return_exceptions=True
                )
                if isinstance(metadata, Exception) or isinstance(market_info, Exception):
                    return None
                if not metadata or not market_info:
                    return None

                socials = {}
                if metadata.get('socials'):
                    for s in metadata['socials']:
                        if s.get('type') and s.get('url'):
                            socials[s['type'].lower()] = s['url']

                return {
                    'tokenAddress': addr,
                    'name': metadata.get('name', 'Unknown Name'),
                    'symbol': metadata.get('symbol', 'N/A'),
                    'logo': metadata.get('icon'),
                    'description': metadata.get('description'),
                    'website': metadata.get('website'),
                    'socials': socials,
                    'holders': metadata.get('holder', 100),
                    'marketCap': market_info.get('market_cap_fully_diluted', 0),
                    'volume24h': market_info.get('volume_24h', 0),
                    'liquidity': market_info.get('liquidity_usd') or market_info.get('liquidity', 0),
                    'priceUsd': market_info.get('price_usd', 0),
                    'priceChange24h': market_info.get('price_change_24h', 0),
                    'solscanUrl': f"https://solscan.io/token/{addr}",
                    'dexscreenerUrl': f"https://dexscreener.com/solana/{addr}",
                }
            except Exception as e:
                logger.error(f"[SolscanService] Failed to enrich token {addr}: {e}")
                return None

        tasks = [enrich(token) for token in trending_tokens]
        results = await asyncio.gather(*tasks)
        enriched = [r for r in results if r is not None]
        logger.info(f"[SolscanService] Successfully enriched {len(enriched)} trending tokens.")
        return enriched

    async def fetch_launchpad_tokens(self, status: str, limit: int = 50) -> List[Dict[str, Any]]:
        logger.info(f"[SolscanService] Fetching launchpad tokens with status: {status}")
        fetch_multiplier = 2 if status == 'bonding' else 3
        latest_tokens = await self.get_latest_tokens(limit * fetch_multiplier)
        if not latest_tokens:
            logger.warning('[SolscanService] No latest tokens found from Solscan API.')
            return []

        logger.info(f"[SolscanService] Enriching {len(latest_tokens)} tokens with Solscan metadata...")
        
        async def enrich_latest(t: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            addr = t.get('address')
            if not addr:
                return None
            try:
                metadata, market_info = await asyncio.gather(
                    self.get_token_metadata(addr),
                    self.get_market_info(addr),
                    return_exceptions=True
                )
                if isinstance(metadata, Exception) or isinstance(market_info, Exception):
                    return None
                if not metadata or not market_info or market_info.get('market_cap_fully_diluted') is None:
                    return None

                market_cap = market_info['market_cap_fully_diluted']
                platform = 'pumpfun'

                if status == 'bonding' and market_cap > 100000:
                    return None
                if status == 'graduated' and market_cap < 69000:
                    return None

                logo_candidate = metadata.get('icon') or (metadata.get('metadata') or {}).get('image')
                logo = normalize_solscan_url(logo_candidate) if logo_candidate else None

                import datetime
                iso_now = datetime.datetime.utcnow().isoformat() + "Z"

                return {
                    'tokenAddress': addr,
                    'name': metadata.get('name') or t.get('name', 'Unknown Name'),
                    'symbol': metadata.get('symbol') or t.get('symbol', 'N/A'),
                    'metadata': {
                        'name': metadata.get('name'),
                        'symbol': metadata.get('symbol'),
                        'image': logo,
                        'mintAddress': addr,
                        'platform': platform,
                        'source': {'fetchedAt': iso_now, 'metadataUri': metadata.get('metadata_uri')}
                    },
                    'priceUsd': market_info.get('price_usd', 0),
                    'liquidity': market_info.get('liquidity_usd') or market_info.get('liquidity', 0),
                    'volume24h': market_info.get('volume_24h', 0),
                    'priceChange24h': market_info.get('price_change_24h', 0),
                    'fullyDilutedValuation': market_cap,
                    'bondingCurveProgress': 100 if status == 'graduated' else min((market_cap / 69000) * 100, 99.9),
                    'graduatedAt': iso_now if status == 'graduated' else None,
                    'holders': metadata.get('holder', 100),
                    'logo': logo,
                    'solscanUrl': f"https://solscan.io/token/{addr}",
                    'dexscreenerUrl': f"https://dexscreener.com/solana/{addr}",
                    'platform': platform,
                }
            except Exception as e:
                logger.error(f"[SolscanService] Error enriching latest token {addr}: {e}")
                return None

        tasks = [enrich_latest(t) for t in latest_tokens]
        results = await asyncio.gather(*tasks)
        processed = [r for r in results if r is not None]
        logger.info(f"[SolscanService] Successfully processed {len(processed)} tokens for status '{status}'")
        return processed[:limit]

solscan_service = SolscanService()
