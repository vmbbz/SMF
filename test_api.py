import asyncio
import httpx
import os
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("BIRDEYE_API_KEY")

async def test_api(mint):
    headers = {
        "X-API-KEY": API_KEY or "",
        "x-chain": "solana",
        "accept": "application/json"
    }
    async with httpx.AsyncClient() as client:
        # test token_overview
        r = await client.get(f"https://public-api.birdeye.so/defi/token_overview?address={mint}", headers=headers)
        print("OVERVIEW:")
        if r.is_success:
            data = r.json().get("data", {})
            print(f"mc: {data.get('mc')}")
            print(f"price: {data.get('price')}")
            print(f"supply: {data.get('supply')}")
            print(f"holders: {data.get('holders')}")
        else:
            print("Failed overview:", r.status_code, r.text)

        # test DexScreener
        r2 = await client.get(f"https://api.dexscreener.com/latest/dex/tokens/{mint}")
        print("\nDEXSCREENER:")
        if r2.is_success:
            pairs = r2.json().get("pairs", [])
            if pairs:
                p = pairs[0]
                print(f"fdv: {p.get('fdv')}")
                print(f"priceUsd: {p.get('priceUsd')}")
        else:
            print("Failed dexscreener:", r2.status_code)

if __name__ == "__main__":
    asyncio.run(test_api("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"))
