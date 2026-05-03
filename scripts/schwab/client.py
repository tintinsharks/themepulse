"""
Schwab MarketData client wrapper.

Thin layer over schwab-py that handles token loading/refresh and exposes
the three methods ThemePulse needs: batch quotes, options chains, price history.

Reads credentials from env vars (SCHWAB_CLIENT_ID, SCHWAB_CLIENT_SECRET,
SCHWAB_CALLBACK_URL) and from ~/.themepulse/schwab_token.json.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

from schwab.auth import client_from_token_file, client_from_login_flow

TOKEN_PATH = Path.home() / ".themepulse" / "schwab_token.json"


def _read_env() -> tuple[str, str, str]:
    client_id = os.environ["SCHWAB_CLIENT_ID"]
    client_secret = os.environ["SCHWAB_CLIENT_SECRET"]
    callback = os.environ.get("SCHWAB_CALLBACK_URL", "https://127.0.0.1:8182")
    return client_id, client_secret, callback


def get_client():
    """Load a live Schwab client. Assumes bootstrap.py has already run."""
    client_id, client_secret, _ = _read_env()
    if not TOKEN_PATH.exists():
        raise RuntimeError(
            f"No token at {TOKEN_PATH}. Run `python3 bootstrap.py` first."
        )
    return client_from_token_file(
        token_path=str(TOKEN_PATH),
        api_key=client_id,
        app_secret=client_secret,
    )


def bootstrap_client():
    """Run the one-time OAuth login flow. Opens a browser."""
    client_id, client_secret, callback = _read_env()
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    return client_from_login_flow(
        api_key=client_id,
        app_secret=client_secret,
        callback_url=callback,
        token_path=str(TOKEN_PATH),
    )


def batch_quotes(client, symbols: Iterable[str]) -> dict:
    """Batch quote up to ~500 symbols. Returns the raw Schwab JSON."""
    syms = list(symbols)
    resp = client.get_quotes(syms)
    resp.raise_for_status()
    return resp.json()


def options_chain(client, symbol: str, strike_count: int = 10) -> dict:
    """Options chain for a single underlying. Returns raw Schwab JSON."""
    resp = client.get_option_chain(symbol, strike_count=strike_count)
    resp.raise_for_status()
    return resp.json()


def price_history_5m(client, symbol: str) -> dict:
    """Intraday 5-min bars — Schwab's default range (~10 trading days)."""
    resp = client.get_price_history_every_five_minutes(symbol)
    resp.raise_for_status()
    return resp.json()


def price_history_daily(client, symbol: str) -> dict:
    """Daily OHLC — Schwab's default range (~20 years)."""
    resp = client.get_price_history_every_day(symbol)
    resp.raise_for_status()
    return resp.json()
