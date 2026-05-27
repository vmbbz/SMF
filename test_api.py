import asyncio
import sys

sys.path.insert(0, ".")
from birdeye_service import birdeye_service
from dexscreener_service import dexscreener_service

async def test_api(mint):
    trending = await birdeye_service.fetch_trending_tokens(1)
    print("BIRDEYE LIST:")
    print(trending[0] if trending else "No list data")

    detail = await dexscreener_service.get_cached_token(mint)
    print("\nDEXSCREENER DETAIL:")
    print(detail or "No detail data")
    await dexscreener_service.close()

if __name__ == "__main__":
    asyncio.run(test_api("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"))
