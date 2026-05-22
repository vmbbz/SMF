import asyncio, sys
sys.path.insert(0, '.')
from birdeye_service import birdeye_service

async def test():
    mint = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"  # BONK
    result = await birdeye_service.get_token_overview(mint)
    if result:
        for k, v in result.items():
            print(f"  {k}: {v}")
    else:
        print("FAILED: no result")

asyncio.run(test())
