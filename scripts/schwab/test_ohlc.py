"""OHLC smoke test. Usage: python3 test_ohlc.py NVDA [5m|1d]"""

import sys

from client import get_client, price_history_5m, price_history_daily


def main(symbol: str, tf: str):
    client = get_client()
    fn = price_history_5m if tf == "5m" else price_history_daily
    data = fn(client, symbol)
    candles = data.get("candles", [])
    print(f"{symbol} {tf}: {len(candles)} bars")
    for c in candles[:3] + candles[-3:]:
        print(
            f"  {c['datetime']}  O={c['open']:<8} H={c['high']:<8} "
            f"L={c['low']:<8} C={c['close']:<8} V={c['volume']}"
        )


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    symbol = args[0] if args else "SPY"
    tf = args[1] if len(args) > 1 else "5m"
    main(symbol, tf)
