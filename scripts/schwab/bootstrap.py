"""
One-time Schwab OAuth bootstrap.

Prereqs:
  1. A Schwab brokerage account.
  2. An approved app at developer.schwab.com (takes 1-3 business days).
  3. Env vars in shell: SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET,
     SCHWAB_CALLBACK_URL (default https://127.0.0.1:8182).

Run:
  python3 bootstrap.py

This opens a browser, you log in + approve, and the refresh token is saved to
~/.themepulse/schwab_token.json. The refresh token lasts 7 days; schwab-py
auto-refreshes the short-lived access token on every call.
"""

from client import bootstrap_client, TOKEN_PATH


def main():
    print("Launching Schwab OAuth flow — a browser window will open.")
    print("Log in, approve the app, and you will be redirected to your callback URL.")
    print(f"Token will be saved to: {TOKEN_PATH}")
    client = bootstrap_client()
    print("\n✓ OAuth complete. Testing with a single quote...")
    resp = client.get_quote("SPY")
    resp.raise_for_status()
    data = resp.json()
    last = data.get("SPY", {}).get("quote", {}).get("lastPrice")
    print(f"  SPY last price: {last}")
    print("\nBootstrap done. You can now run test_quotes.py / test_options.py.")


if __name__ == "__main__":
    main()
