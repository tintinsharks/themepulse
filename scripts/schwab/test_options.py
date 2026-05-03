"""Options chain smoke test. Usage: python3 test_options.py NVDA [strike_count]"""

import json
import sys

from client import get_client, options_chain


def main(symbol: str, strike_count: int):
    client = get_client()
    data = options_chain(client, symbol, strike_count=strike_count)
    print(f"Underlying: {symbol}  last={data.get('underlyingPrice')}")
    print(f"Status: {data.get('status')}   strategy: {data.get('strategy')}")

    for side in ("callExpDateMap", "putExpDateMap"):
        exp_map = data.get(side, {})
        print(f"\n{side}:")
        for exp, strikes in list(exp_map.items())[:2]:
            print(f"  {exp}")
            for strike, contracts in list(strikes.items())[:5]:
                c = contracts[0]
                print(
                    f"    strike={strike:<8} bid={c['bid']:<6} ask={c['ask']:<6} "
                    f"last={c['last']:<6} iv={c.get('volatility'):<8} "
                    f"delta={c.get('delta'):<8} oi={c.get('openInterest')}"
                )

    if "--raw" in sys.argv:
        print(json.dumps(data, indent=2))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    symbol = args[0] if args else "SPY"
    strike_count = int(args[1]) if len(args) > 1 else 10
    main(symbol, strike_count)
