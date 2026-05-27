import asyncio, sys
sys.path.insert(0, '.')
from birdeye_service import birdeye_service

async def test():
    result = await birdeye_service.fetch_trending_tokens(1)
    print(result[0] if result else "FAILED: no trending list result")

asyncio.run(test())
