import axios from 'axios';

const API_BASE_URL = 'https://pro-api.solscan.io/v2.0';
// Debug log for environment variable
console.log(`[SolscanService] Reading SOLSCAN_API_KEY from environment: ${process.env.SOLSCAN_API_KEY ? 'Found key' : 'NOT FOUND'}`); 
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY || '';

// Follow Solscan API docs strictly: if ipfs://, convert to https://ipfs.io/ipfs/<hash>, else leave as-is
function normalizeSolscanUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (url.startsWith('ipfs://')) {
        return `https://ipfs.io/ipfs/${url.slice('ipfs://'.length)}`;
    }
    return url;
}

class SolscanService {
    constructor() {
        this.api = axios.create({
            baseURL: API_BASE_URL,
            headers: {
                'accept': 'application/json',
                'token': SOLSCAN_API_KEY
            }
        });

        this.tokenCache = new Map(); // mint → {data, timestamp}

        if (!SOLSCAN_API_KEY) {
            console.warn('[SolscanService] SOLSCAN_API_KEY is not configured. Solscan features will be unavailable.');
        }
    }

    async makeRequest(endpoint, params = {}) {
        if (!SOLSCAN_API_KEY) return null;
        try {
            const response = await this.api.get(endpoint, { params });
            return response.data;
        } catch (error) {
            console.error(`[SolscanService] API error for endpoint ${endpoint}:`, error.response?.data || error.message);
            return null;
        }
    }

    async getLatestTokens(limit = 50) {
        const result = await this.makeRequest('/token/latest', { limit });
        return result?.data || null;
    }

    async getTrendingTokens(limit = 20) {
        const result = await this.makeRequest('/token/trending', { limit });
        return result?.data || null;
    }

    async getTokenMetadata(tokenAddress) {
        const result = await this.makeRequest('/token/meta', { address: tokenAddress });
        if (!result) return null;
        // Normalize possible IPFS image/icon fields per Solscan docs
        const icon = result.icon ? normalizeSolscanUrl(result.icon) : result.icon;
        const metadata = result.metadata || {};
        const normalizedImage = metadata.image ? normalizeSolscanUrl(metadata.image) : metadata.image;
        return {
            ...result,
            icon,
            metadata: {
                ...metadata,
                image: normalizedImage,
            },
            metadata_uri: result.metadata_uri ? normalizeSolscanUrl(result.metadata_uri) : result.metadata_uri,
        };
    }
    
    async getMarketInfo(tokenAddress) {
        const result = await this.makeRequest(`/market/token/${tokenAddress}`);
        return result || null;
    }

    async fetchTokenCandles({ pairAddress, resolution = '1h', time_from, time_to }) {
        const params = {
            market: pairAddress,
            resolution: resolution, // e.g., 1, 5, 15, 30, 60, 120, 240, 1D, 1W
            time_from: Math.floor(time_from / 1000), // Solscan expects Unix timestamp in seconds
            time_to: Math.floor(time_to / 1000)
        };
        const result = await this.makeRequest('/market/candles', params);
        return result || [];
    }

    async getCachedToken(mint) {
        const cached = this.tokenCache.get(mint);
        if (cached && Date.now() - cached.timestamp < 60000) {
            console.log(`[SolscanService] Cache HIT for ${mint}`);
            return cached.data;
        }

        console.log(`[SolscanService] Cache MISS for ${mint}. Fetching fresh...`);
        const data = await this.fetchTokenDetails(mint);
        if (data) {
            this.tokenCache.set(mint, { data, timestamp: Date.now() });
        }
        return data;
    }

    async fetchTokenDetails(tokenAddress) {
        console.log(`[SolscanService] Fetching details for ${tokenAddress}`);
        try {
            const [metadata, marketInfo] = await Promise.all([
                this.getTokenMetadata(tokenAddress),
                this.getMarketInfo(tokenAddress)
            ]);

            if (!metadata || !marketInfo) {
                console.warn(`[SolscanService] Could not retrieve full details for ${tokenAddress}.`);
                return null;
            }

            const socials = {};
            if (metadata.socials) {
                metadata.socials.forEach(s => {
                    if (s.type && s.url) socials[s.type.toLowerCase()] = s.url;
                });
            }

            const priceData = {
                tokenAddress,
                pairAddress: marketInfo.market_address,
                exchangeName: marketInfo.market_name || 'Unknown',
                logo: metadata.icon,
                name: metadata.name,
                symbol: metadata.symbol,
                usdPrice: marketInfo.price_usd,
                usdPrice24h: marketInfo.price_usd / (1 + (marketInfo.price_change_24h / 100)),
                usdPrice24hrPercentChange: marketInfo.price_change_24h,
            };

            const holdersData = {
                tokenAddress,
                tokenName: metadata.name,
                tokenSymbol: metadata.symbol,
                tokenLogo: metadata.icon,
                exchange: marketInfo.market_name,
                pairAddress: marketInfo.market_address,
                pairLabel: `${metadata.symbol}/SOL`, // Assuming SOL pair for simplicity
                totalLiquidityUsd: marketInfo.liquidity_usd,
                marketCap: marketInfo.market_cap_fully_diluted,
                pricePercentChange: {
                    '24h': marketInfo.price_change_24h || 0,
                },
                totalVolume: {
                    '24h': marketInfo.volume_24h || 0,
                },
                holders: metadata.holder || 100,
            };
            
            return {
                price: { data: priceData },
                holders: holdersData,
                pairAddress: marketInfo.market_address,
                description: metadata.description,
                links: socials,
                website: metadata.website,
                symbol: metadata.symbol,
            };

        } catch (error) {
            console.error(`[SolscanService] Error in fetchTokenDetails for ${tokenAddress}:`, error);
            return null;
        }
    }

    async fetchTrendingTokens(limit = 9) {
        console.log(`[SolscanService] Fetching ${limit} trending tokens.`);
        const trendingTokens = await this.getTrendingTokens(limit);
        if (!trendingTokens) {
            console.warn('[SolscanService] Failed to fetch trending tokens list.');
            return [];
        }

        const enrichmentPromises = trendingTokens.map(async (token) => {
            try {
                const [metadata, marketInfo] = await Promise.all([
                    this.getTokenMetadata(token.address),
                    this.getMarketInfo(token.address)
                ]);

                if (!metadata || !marketInfo) return null;

                const socials = {};
                if (metadata.socials) {
                    metadata.socials.forEach(s => {
                        if (s.type && s.url) socials[s.type.toLowerCase()] = s.url;
                    });
                }
                
                return {
                    tokenAddress: token.address,
                    name: metadata.name || 'Unknown Name',
                    symbol: metadata.symbol || 'N/A',
                    logo: metadata.icon,
                    description: metadata.description,
                    website: metadata.website,
                    socials,
                    holders: metadata.holder || 100,
                    marketCap: marketInfo.market_cap_fully_diluted || 0,
                    volume24h: marketInfo.volume_24h || 0,
                    liquidity: marketInfo.liquidity_usd || marketInfo.liquidity || 0,
                    priceUsd: marketInfo.price_usd || 0,
                    priceChange24h: marketInfo.price_change_24h || 0,
                    solscanUrl: `https://solscan.io/token/${token.address}`,
                    dexscreenerUrl: `https://dexscreener.com/solana/${token.address}`,
                };
            } catch (error) {
                console.error(`[SolscanService] Failed to enrich token ${token.address}:`, error.message);
                return null;
            }
        });

        const enrichedTokens = (await Promise.all(enrichmentPromises)).filter(Boolean);
        console.log(`[SolscanService] Successfully enriched ${enrichedTokens.length} trending tokens.`);
        return enrichedTokens;
    }

    async fetchLaunchpadTokens(status, limit = 50) {
        console.log(`[SolscanService] Fetching launchpad tokens with status: ${status}`);
        const fetchMultiplier = status === 'bonding' ? 2 : 3;
        const latestTokens = await this.getLatestTokens(limit * fetchMultiplier);
        if (!latestTokens || latestTokens.length === 0) {
            console.warn('[SolscanService] No latest tokens found from Solscan API.');
            return [];
        }

        // Build token list from Solscan-only metadata and market info
        console.log(`[SolscanService] Enriching ${latestTokens.length} tokens with Solscan metadata...`);
        const processingPromises = latestTokens.map(async (t) => {
            const tokenAddress = t.address;
            const [metadata, marketInfo] = await Promise.all([
                this.getTokenMetadata(tokenAddress),
                this.getMarketInfo(tokenAddress)
            ]);

            if (!metadata || !marketInfo || marketInfo.market_cap_fully_diluted === undefined) return null;

            const marketCap = marketInfo.market_cap_fully_diluted;
            const platform = 'pumpfun'; // default best-guess for launchpad feed from latest tokens

            // Filter based on status
            if (status === 'bonding' && marketCap > 100000) return null;
            if (status === 'graduated' && marketCap < 69000) return null;

            const logoCandidate = metadata.icon || metadata?.metadata?.image;
            const logo = logoCandidate ? normalizeSolscanUrl(logoCandidate) : null;

            return {
                tokenAddress,
                name: metadata.name || t.name || 'Unknown Name',
                symbol: metadata.symbol || t.symbol || 'N/A',
                metadata: {
                    name: metadata.name,
                    symbol: metadata.symbol,
                    image: logo,
                    mintAddress: tokenAddress,
                    platform,
                    source: { fetchedAt: new Date().toISOString(), metadataUri: metadata.metadata_uri }
                },
                priceUsd: marketInfo.price_usd || 0,
                liquidity: marketInfo.liquidity_usd || marketInfo.liquidity || 0,
                volume24h: marketInfo.volume_24h || 0,
                priceChange24h: marketInfo.price_change_24h || 0,
                fullyDilutedValuation: marketCap,
                bondingCurveProgress: status === 'graduated' ? 100 : Math.min((marketCap / 69000) * 100, 99.9),
                graduatedAt: status === 'graduated' ? new Date().toISOString() : undefined,
                holders: metadata.holder || 100,
                logo,
                solscanUrl: `https://solscan.io/token/${tokenAddress}`,
                dexscreenerUrl: `https://dexscreener.com/solana/${tokenAddress}`,
                platform,
            };
        });

        const processedTokens = (await Promise.all(processingPromises)).filter(Boolean);
        console.log(`[SolscanService] Successfully processed ${processedTokens.length} tokens for status '${status}' using Solscan-only metadata.`);

        return processedTokens.slice(0, limit);
    }
}

export const solscanService = new SolscanService();