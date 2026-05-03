"""Batch-quote smoke test. Usage: python3 test_quotes.py NVDA AMD SPY"""

import json
import sys

from client import batch_quotes, get_client


def main(symbols):
    client = get_client()
    data = batch_quotes(client, symbols)
    for sym in symbols:
        q = data.get(sym, {}).get("quote", {})
        print(
            f"{sym:6} last={q.get('lastPrice'):<10} "
            f"bid={q.get('bidPrice'):<10} ask={q.get('askPrice'):<10} "
            f"vol={q.get('totalVolume')}"
        )
    if "--raw" in sys.argv:
        print(json.dumps(data, indent=2))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args or ["SPY", "QQQ", "NVDA"])
