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
        r = await client.get(f"https://public-api.birdeye.so/defi/v3/token/holder?address={mint}", headers=headers)
        print("HOLDERS:", r.status_code)
        if r.is_success:
            print("Total holders:", r.json().get("data", {}).get("total"))
        else:
            print("Failed:", r.text[:200])

if __name__ == "__main__":
    asyncio.run(test_api("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"))
