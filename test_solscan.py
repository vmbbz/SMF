import asyncio
import httpx

async def test_solscan(mint):
    headers = {
        "User-Agent": "Mozilla/5.0",
        "accept": "application/json"
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(f"https://public-api.solscan.io/token/meta?tokenAddress={mint}", headers=headers)
            print("SOLSCAN:", r.status_code)
            if r.is_success:
                print(r.json())
            else:
                print(r.text[:200])
        except Exception as e:
            print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_solscan("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"))
