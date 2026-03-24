#!/usr/bin/env python3
"""
flag_scanner.py — Flag / Consolidation Pattern Scanner
=======================================================
Detects stocks with a sharp upward move (pole) followed by a tight
consolidation pattern (flag). Scores and ranks setups, generates
candlestick chart grids with pattern overlays.

Patterns detected:
  - Flat Top Squeeze: flat resistance, tight consolidation near highs
  - Descending Flag: slight downward drift after pole (shallow pullback)
  - Tight Bull Flag: very narrow parallel channel, slight downward tilt

Modes:
  --peg     Power Earnings Gap mode: finds stocks that gapped up on earnings
            with massive volume and are now consolidating in a flag pattern.

Usage:
  python flag_scanner.py                            # S&P 500 + Nasdaq 100
  python flag_scanner.py --tickers AAPL,NVDA,MSFT   # custom list
  python flag_scanner.py --file watchlist.txt        # from file
  python flag_scanner.py --top 40 --no-charts        # table only, top 40
  python flag_scanner.py --peg                       # Power Earnings Gap scan
"""

import argparse
import sys
import time
import warnings
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*auto_adjust.*")


# ---------------------------------------------------------------------------
# Universe helpers
# ---------------------------------------------------------------------------

def _wiki_read(url):
    """Read Wikipedia page with proper User-Agent."""
    import urllib.request
    from io import StringIO
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    })
    with urllib.request.urlopen(req, timeout=10) as resp:
        return StringIO(resp.read().decode("utf-8"))


def get_sp500_tickers():
    """Fetch S&P 500 tickers from Wikipedia."""
    try:
        html = _wiki_read("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
        tables = pd.read_html(html)
        return sorted(tables[0]["Symbol"].str.replace(".", "-", regex=False).tolist())
    except Exception as e:
        print(f"  Warning: couldn't fetch S&P 500 list: {e}")
        return []


def get_nasdaq100_tickers():
    """Fetch Nasdaq-100 tickers from Wikipedia."""
    try:
        html = _wiki_read("https://en.wikipedia.org/wiki/Nasdaq-100")
        tables = pd.read_html(html)
        for t in tables:
            if "Ticker" in t.columns:
                return sorted(t["Ticker"].str.replace(".", "-", regex=False).tolist())
            if "Symbol" in t.columns:
                return sorted(t["Symbol"].str.replace(".", "-", regex=False).tolist())
    except Exception as e:
        print(f"  Warning: couldn't fetch Nasdaq-100 list: {e}")
    return []


def get_pipeline_tickers(min_dollar_vol=5_000_000, min_price=5.0):
    """
    Load tickers from the stock-pipeline's dashboard_data.json (~4800 stocks).
    Filters by avg daily dollar volume and price.
    """
    import json as _json
    candidates = [
        Path.home() / "Claude Theme" / "stock-pipeline" / "output" / "dashboard_data.json",
        Path.home() / "Claude Theme" / "themepulse" / "public" / "dashboard_data.json",
    ]
    for p in candidates:
        if p.exists():
            try:
                with open(p) as f:
                    data = _json.load(f)
                stocks = data.get("stocks", [])
                tickers = []
                for s in stocks:
                    t = s.get("ticker", "")
                    if not t:
                        continue
                    price = float(s.get("close") or s.get("price") or 0)
                    dvol = float(s.get("avg_dollar_vol_raw") or 0)
                    # Skip ETFs, funds, OTC
                    company = str(s.get("company", "")).lower()
                    is_fund = any(kw in company for kw in
                                 ["etf", "fund", "trust", "proshares", "ishares",
                                  "spdr", "vanguard", "direxion", "invesco"])
                    if price >= min_price and dvol >= min_dollar_vol and not is_fund:
                        tickers.append(t)
                print(f"  Loaded {len(tickers)} tickers from pipeline "
                      f"(filtered from {len(stocks)} total)")
                return sorted(tickers)
            except Exception as e:
                print(f"  Warning: couldn't load {p}: {e}")
    return []


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------

def fetch_ohlcv(tickers, period="1y"):
    """Download OHLCV data via yfinance. Returns dict of ticker -> DataFrame."""
    print(f"Downloading price data for {len(tickers)} tickers...")
    data = {}
    batch_size = 50
    for i in range(0, len(tickers), batch_size):
        batch = tickers[i:i + batch_size]
        try:
            df = yf.download(
                batch, period=period, group_by="ticker",
                progress=False, threads=True, auto_adjust=False,
            )
            if df.empty:
                continue
            if len(batch) == 1:
                ticker = batch[0]
                if len(df) > 0:
                    # Handle multi-level columns from yfinance
                    if isinstance(df.columns, pd.MultiIndex):
                        tdf = df.xs(ticker, level="Ticker", axis=1)
                        cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in tdf.columns]
                        if len(cols) == 5:
                            data[ticker] = tdf[cols].dropna()
                    elif "Close" in df.columns:
                        data[ticker] = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
            else:
                for ticker in batch:
                    try:
                        if isinstance(df.columns, pd.MultiIndex):
                            tdf = df.xs(ticker, level="Ticker", axis=1)
                        else:
                            tdf = df[ticker]
                        tdf = tdf[["Open", "High", "Low", "Close", "Volume"]].dropna()
                        if len(tdf) >= 60:
                            data[ticker] = tdf
                    except (KeyError, TypeError):
                        continue
        except Exception as e:
            print(f"  Batch error: {e}")
        if i + batch_size < len(tickers):
            sys.stdout.write(f"\r  Downloaded {min(i + batch_size, len(tickers))}/{len(tickers)} tickers")
            sys.stdout.flush()
    print(f"\r  Downloaded {len(data)} tickers with sufficient data     ")
    return data


# ---------------------------------------------------------------------------
# Pole Detection
# ---------------------------------------------------------------------------

def detect_pole(closes, highs, lows, volumes, min_gain=15.0, max_pole_len=10,
                min_pole_len=3, lookback=60, margin=40):
    """
    Find the sharpest upward run in the last `lookback` bars.

    Returns dict with pole_start, pole_end, pole_gain, pole_bars,
    pole_high, pole_volume_avg — or None.
    """
    n = len(closes)
    if n < lookback:
        lookback = n
    start_search = max(0, n - lookback)
    # Pole must end early enough to leave room for a flag
    end_limit = n - 2  # at least 2 bars of flag

    candidates = []

    for pole_len in range(min_pole_len, max_pole_len + 1):
        for end_idx in range(start_search + pole_len, min(end_limit, n)):
            start_idx = end_idx - pole_len
            gain = (closes[end_idx] / closes[start_idx] - 1) * 100
            if gain >= min_gain:
                # Score = gain + recency bonus (prefer recent poles)
                recency = (end_idx - start_search) / max(1, (end_limit - start_search))
                weighted = gain + recency * 10  # up to +10 for most recent
                candidates.append({
                    "pole_start": start_idx,
                    "pole_end": end_idx,
                    "pole_gain": gain,
                    "pole_bars": pole_len,
                    "pole_high": float(np.max(highs[start_idx:end_idx + 1])),
                    "pole_volume_avg": float(np.mean(volumes[start_idx:end_idx + 1])),
                    "_weighted": weighted,
                })

    if not candidates:
        return None
    # Pick the best by weighted score (gain + recency)
    candidates.sort(key=lambda x: -x["_weighted"])
    best = candidates[0]
    del best["_weighted"]
    return best


# ---------------------------------------------------------------------------
# Power Earnings Gap (PEG) Detection
# ---------------------------------------------------------------------------

def detect_earnings_gap(opens, closes, highs, lows, volumes, lookback=60):
    """
    Find the most significant gap-up day in the last `lookback` bars.
    A power earnings gap = single day with:
      - Gap up >= 4% (open vs prior close)
      - Total change >= 5% (close vs prior close)
      - Volume >= 2x 50-day average
      - Close in upper 50% of day's range (strong close)

    Returns dict with gap details or None.
    """
    n = len(closes)
    if n < 60:
        return None

    start = max(1, n - lookback)
    best = None

    for idx in range(start, n - 2):  # leave room for at least 2 flag bars
        prev_close = closes[idx - 1]
        if prev_close <= 0:
            continue

        gap_pct = (opens[idx] - prev_close) / prev_close * 100
        change_pct = (closes[idx] - prev_close) / prev_close * 100
        day_range = highs[idx] - lows[idx]
        close_range = (closes[idx] - lows[idx]) / day_range if day_range > 0 else 0.5

        # Volume ratio vs 50-day average
        vol_start = max(0, idx - 50)
        avg_vol = float(np.mean(volumes[vol_start:idx])) if idx > vol_start else 1
        vol_ratio = volumes[idx] / avg_vol if avg_vol > 0 else 0

        # PEG criteria
        if (gap_pct >= 4.0 and change_pct >= 5.0 and
                vol_ratio >= 2.0 and close_range >= 0.50):

            # Score: prefer bigger gaps with more volume, more recent
            recency = (idx - start) / max(1, (n - 2 - start))
            weighted = change_pct + gap_pct + vol_ratio * 2 + recency * 5

            if best is None or weighted > best["_weighted"]:
                best = {
                    "pole_start": idx - 1,  # day before gap
                    "pole_end": idx,         # gap day itself
                    "pole_gain": round(change_pct, 1),
                    "pole_bars": 1,
                    "pole_high": float(highs[idx]),
                    "pole_volume_avg": float(volumes[idx]),
                    # PEG-specific fields
                    "gap_pct": round(gap_pct, 1),
                    "change_pct": round(change_pct, 1),
                    "vol_ratio": round(vol_ratio, 1),
                    "close_range": round(close_range * 100, 0),
                    "_weighted": weighted,
                }

    if best:
        del best["_weighted"]
    return best


def scan_peg(ticker, df):
    """
    Scan for Power Earnings Gap + Flag pattern.
    Returns result dict or None.
    """
    if df is None or len(df) < 60:
        return None

    opens = df["Open"].values.astype(float)
    closes = df["Close"].values.astype(float)
    highs = df["High"].values.astype(float)
    lows = df["Low"].values.astype(float)
    volumes = df["Volume"].values.astype(float)

    price = closes[-1]
    if price <= 0 or np.isnan(price):
        return None

    # Detect earnings gap
    gap = detect_earnings_gap(opens, closes, highs, lows, volumes)
    if gap is None:
        return None

    # Detect flag after the gap
    flag = detect_flag(closes, highs, lows, volumes, gap)
    if flag is None:
        return None

    # Classify pattern
    pattern = classify_pattern(flag)
    if pattern is None:
        pattern = "PEG Base"  # default for PEG mode even if no clean flag shape

    # Did it hold the gap? (key metric)
    gap_day_open = opens[gap["pole_end"]]
    gap_day_low = lows[gap["pole_end"]]
    flag_start_idx = flag["flag_start"]
    post_closes = closes[flag_start_idx:]
    post_lows = lows[flag_start_idx:]

    held_gap_open = bool(float(np.min(post_closes)) >= gap_day_open * 0.98)
    held_gap_low = bool(float(np.min(post_lows)) >= gap_day_low * 0.95)

    # Gap hold score (0-5)
    gap_hold = 0
    if held_gap_open:
        gap_hold += 1
    if held_gap_low:
        gap_hold += 1
    if flag["vol_contraction"] <= 0.7:
        gap_hold += 1
    # Made higher high within 5 days?
    post_highs_5d = highs[flag_start_idx:min(flag_start_idx + 5, len(highs))]
    if len(post_highs_5d) > 0 and float(np.max(post_highs_5d)) > closes[gap["pole_end"]]:
        gap_hold += 1
    # Current price above gap close?
    if price >= closes[gap["pole_end"]]:
        gap_hold += 1

    gap_hold_label = "HELD" if gap_hold >= 4 else "BASING" if gap_hold >= 2 else "FADING"

    # Score — use base flag score + PEG bonuses
    score = compute_score(gap, flag, pattern, price, highs, closes)

    # PEG-specific bonuses
    if gap["gap_pct"] >= 10:
        score += 15.0  # monster gap
    elif gap["gap_pct"] >= 7:
        score += 10.0
    elif gap["gap_pct"] >= 5:
        score += 5.0

    if gap["vol_ratio"] >= 5:
        score += 10.0  # extreme volume
    elif gap["vol_ratio"] >= 3:
        score += 5.0

    if held_gap_open:
        score += 15.0  # held above gap open = institutional demand
    if held_gap_low:
        score += 5.0

    if gap_hold >= 4:
        score += 10.0  # strong hold pattern

    # Minimum threshold
    if score < 40:
        return None

    # Days since gap
    days_since = len(closes) - 1 - gap["pole_end"]

    return {
        "ticker": ticker,
        "engine": "PEG",
        "pattern": pattern,
        "score": round(score, 1),
        "gap_pct": gap["gap_pct"],
        "change_pct": gap["change_pct"],
        "vol_ratio": gap["vol_ratio"],
        "days_since": days_since,
        "flag_bars": flag["flag_bars"],
        "retracement": round(flag["retracement"], 1),
        "close_pos": round(flag["close_pos"], 2),
        "near_high": round(flag["near_high"], 2),
        "width_metric": round(flag["width_metric"], 1),
        "compression": round(flag["compression"], 2),
        "vol_contraction": round(flag["vol_contraction"], 2),
        "gap_hold": gap_hold,
        "gap_hold_label": gap_hold_label,
        "held_gap": held_gap_open,
        "atr_pct": round(flag["atr_pct"], 2),
        "last_close": round(price, 2),
        # Internal
        "_pole": gap,
        "_flag_start": flag["flag_start"],
        "_flag_high": flag["flag_high"],
        "_flag_low": flag["flag_low"],
    }


# ---------------------------------------------------------------------------
# Flag Detection
# ---------------------------------------------------------------------------

def detect_flag(closes, highs, lows, volumes, pole):
    """
    Measure the consolidation after the pole.
    Returns dict of flag metrics or None if invalid.
    """
    pole_end = pole["pole_end"]
    pole_high = pole["pole_high"]
    n = len(closes)

    flag_start = pole_end + 1
    if flag_start >= n:
        return None

    flag_highs = highs[flag_start:]
    flag_lows = lows[flag_start:]
    flag_closes = closes[flag_start:]
    flag_volumes = volumes[flag_start:]
    flag_bars = len(flag_closes)

    if flag_bars < 2 or flag_bars > 40:
        return None

    flag_high = float(np.max(flag_highs))
    flag_low = float(np.min(flag_lows))
    current_close = float(closes[-1])

    # Retracement from pole high
    retracement = (current_close - pole_high) / pole_high * 100
    if retracement < -25:
        return None

    # Width
    width_metric = (flag_high - flag_low) / flag_high * 100 if flag_high > 0 else 0
    if width_metric > 20:
        return None

    # Close position within flag range
    flag_range = flag_high - flag_low
    close_pos = (current_close - flag_low) / flag_range if flag_range > 0 else 0.5
    close_pos = max(0.0, min(1.0, close_pos))

    # Near high — ratio of close to flag high (1.0 = at the high)
    near_high = current_close / flag_high if flag_high > 0 else 0
    near_high = max(0.0, min(1.0, near_high))

    # Compression: ATR of last N bars vs first N bars of flag
    split = min(3, flag_bars // 2)
    if split >= 1:
        early_ranges = flag_highs[:split] - flag_lows[:split]
        late_ranges = flag_highs[-split:] - flag_lows[-split:]
        early_atr = float(np.mean(early_ranges))
        late_atr = float(np.mean(late_ranges))
        compression = late_atr / early_atr if early_atr > 0 else 1.0
    else:
        compression = 1.0

    # Volume contraction: flag volume vs pole volume
    pole_vol = pole["pole_volume_avg"]
    flag_vol_avg = float(np.mean(flag_volumes))
    vol_contraction = flag_vol_avg / pole_vol if pole_vol > 0 else 1.0

    # ATR%
    bar_ranges = flag_highs - flag_lows
    atr_pct = float(np.mean(bar_ranges)) / current_close * 100 if current_close > 0 else 0

    return {
        "flag_bars": flag_bars,
        "flag_high": flag_high,
        "flag_low": flag_low,
        "flag_start": flag_start,
        "retracement": retracement,
        "close_pos": close_pos,
        "near_high": near_high,
        "width_metric": width_metric,
        "compression": compression,
        "vol_contraction": vol_contraction,
        "atr_pct": atr_pct,
        "flag_highs": flag_highs,
        "flag_lows": flag_lows,
    }


# ---------------------------------------------------------------------------
# Pattern Classification
# ---------------------------------------------------------------------------

def classify_pattern(flag):
    """
    Classify flag shape using linear regression on highs and lows.
    Returns pattern name string.
    """
    flag_highs = flag["flag_highs"]
    flag_lows = flag["flag_lows"]
    flag_bars = flag["flag_bars"]
    width = flag["width_metric"]

    if flag_bars < 2:
        return "consolidation"

    x = np.arange(flag_bars, dtype=float)
    mean_high = np.mean(flag_highs)
    mean_low = np.mean(flag_lows)

    # Normalized slopes (%/bar)
    if mean_high > 0 and flag_bars >= 2:
        high_slope = np.polyfit(x, flag_highs, 1)[0] / mean_high * 100
    else:
        high_slope = 0.0
    if mean_low > 0 and flag_bars >= 2:
        low_slope = np.polyfit(x, flag_lows, 1)[0] / mean_low * 100
    else:
        low_slope = 0.0

    HIGH_FLAT = abs(high_slope) < 0.20
    LOW_FLAT = abs(low_slope) < 0.20
    HIGH_DOWN = high_slope < -0.20
    LOW_DOWN = low_slope < -0.20
    LOW_UP = low_slope > 0.20

    # Classification (priority order)
    if width < 5 and HIGH_FLAT and flag_bars >= 3:
        return "Flat Top Squeeze"

    if HIGH_DOWN and LOW_DOWN and width < 8:
        return "Tight Bull Flag"

    if HIGH_FLAT and (LOW_FLAT or LOW_UP) and flag_bars >= 3:
        return "Flat Top Squeeze"

    if HIGH_DOWN and LOW_DOWN and flag_bars >= 3:
        return "Descending Flag"

    if HIGH_FLAT and flag_bars >= 3:
        return "Flat Top Squeeze"

    if HIGH_DOWN and flag_bars >= 3:
        return "Descending Flag"

    return None  # doesn't match any of the 3 core patterns


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def compute_score(pole, flag, pattern, price, highs, closes):
    """Composite quality score. Can exceed 100."""
    score = 0.0

    # 1. Pole Gain (0-40) — larger pole = stronger setup
    pg = pole["pole_gain"]
    score += min(40.0, pg * 1.3)

    # 2. Close Position (0-20) — higher in flag = coiled for breakout
    score += flag["close_pos"] * 20.0

    # 3. Near High (0-20) — close to flag high is key
    nh = flag["near_high"]
    if nh >= 0.95:
        score += 20.0
    elif nh >= 0.90:
        score += 15.0 + (nh - 0.90) / 0.05 * 5.0
    elif nh >= 0.80:
        score += 8.0 + (nh - 0.80) / 0.10 * 7.0
    else:
        score += max(0, nh * 8.0)

    # 4. Compression (0-15) — lower = tighter = better
    comp = flag["compression"]
    if comp < 0.5:
        score += 15.0
    elif comp < 0.8:
        score += 10.0 + (0.8 - comp) / 0.3 * 5.0
    elif comp < 1.0:
        score += (1.0 - comp) / 0.2 * 5.0

    # 5. Volume Contraction (0-15) — lower = more drying up
    vc = flag["vol_contraction"]
    if vc < 0.3:
        score += 15.0
    elif vc < 0.5:
        score += 10.0 + (0.5 - vc) / 0.2 * 5.0
    elif vc < 0.7:
        score += (0.7 - vc) / 0.2 * 5.0

    # 6. Width (0-15) — tighter = better
    w = flag["width_metric"]
    if w < 3:
        score += 15.0
    elif w < 5:
        score += 10.0
    elif w < 8:
        score += 6.0
    elif w < 12:
        score += 3.0

    # 7. Flag Bars (0-10) — 5-10 ideal
    fb = flag["flag_bars"]
    if 5 <= fb <= 10:
        score += 10.0
    elif 3 <= fb <= 15:
        score += 6.0
    elif fb <= 25:
        score += 3.0

    # 8. Retracement (0-15) — shallower = better
    retr = abs(flag["retracement"])
    if retr < 3:
        score += 15.0
    elif retr < 5:
        score += 10.0
    elif retr < 8:
        score += 6.0
    elif retr < 12:
        score += 3.0

    # --- Bonuses ---
    # Near 52-week high (+15)
    n = len(highs)
    high_52w = float(np.max(highs[-252:])) if n >= 252 else float(np.max(highs))
    dist_52w = (price - high_52w) / high_52w * 100
    if dist_52w > -3:
        score += 15.0
    elif dist_52w > -5:
        score += 10.0
    elif dist_52w > -10:
        score += 5.0

    # Above 10 & 20 SMA (+10)
    if n >= 20:
        sma10 = float(np.mean(closes[-10:]))
        sma20 = float(np.mean(closes[-20:]))
        if price > sma10 and price > sma20:
            score += 10.0
        elif price > sma20:
            score += 5.0

    # Power pole (+10)
    if pg > 30:
        score += 10.0
    elif pg > 25:
        score += 5.0

    # Premium pattern bonus (+5)
    if pattern == "Flat Top Squeeze":
        score += 5.0

    return round(score, 1)


# ---------------------------------------------------------------------------
# Main scan per stock
# ---------------------------------------------------------------------------

def scan_stock(ticker, df):
    """Scan a single stock. Returns result dict or None."""
    if df is None or len(df) < 60:
        return None

    closes = df["Close"].values.astype(float)
    highs = df["High"].values.astype(float)
    lows = df["Low"].values.astype(float)
    volumes = df["Volume"].values.astype(float)

    price = closes[-1]
    if price <= 0 or np.isnan(price):
        return None

    # Skip very low ADR stocks (< 2%)
    if len(closes) >= 20:
        daily_ranges = (highs[-20:] - lows[-20:]) / closes[-20:] * 100
        if float(np.mean(daily_ranges)) < 1.5:
            return None

    # Try POLE engine first (sharp move >= 15%)
    pole = detect_pole(closes, highs, lows, volumes, min_gain=15.0, max_pole_len=10)
    if pole:
        engine = "POLE"
    else:
        # NO_POLE: relaxed — 8%+ over up to 20 bars
        pole = detect_pole(closes, highs, lows, volumes, min_gain=8.0, max_pole_len=20)
        if pole is None:
            return None
        engine = "NO_POLE"

    # Detect flag
    flag = detect_flag(closes, highs, lows, volumes, pole)
    if flag is None:
        return None

    # Classify pattern
    pattern = classify_pattern(flag)
    if pattern is None:
        return None  # doesn't match any core pattern

    # Score
    score = compute_score(pole, flag, pattern, price, highs, closes)
    if engine == "NO_POLE":
        score -= 15.0

    # Minimum score threshold
    if score < 30:
        return None

    return {
        "ticker": ticker,
        "engine": engine,
        "pattern": pattern,
        "score": score,
        "pole_gain": round(pole["pole_gain"], 1),
        "flag_bars": flag["flag_bars"],
        "retracement": round(flag["retracement"], 1),
        "close_pos": round(flag["close_pos"], 2),
        "near_high": round(flag["near_high"], 2),
        "width_metric": round(flag["width_metric"], 1),
        "compression": round(flag["compression"], 2),
        "vol_contraction": round(flag["vol_contraction"], 2),
        "atr_pct": round(flag["atr_pct"], 2),
        "last_close": round(price, 2),
        # Internal — used for charting
        "_pole": pole,
        "_flag_start": flag["flag_start"],
        "_flag_high": flag["flag_high"],
        "_flag_low": flag["flag_low"],
    }


# ---------------------------------------------------------------------------
# Chart Generation
# ---------------------------------------------------------------------------

def generate_charts(results, price_data, output_dir, per_page=4):
    """Generate 2x2 candlestick chart grids with pattern overlays."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import mplfinance as mpf

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Dark theme matching the screenshots
    mc = mpf.make_marketcolors(
        up="#26a69a", down="#ef5350",
        edge={"up": "#26a69a", "down": "#ef5350"},
        wick={"up": "#26a69a", "down": "#ef5350"},
        volume={"up": "#26a69a80", "down": "#ef535080"},
    )
    style = mpf.make_mpf_style(
        marketcolors=mc,
        figcolor="#0a0e27",
        facecolor="#0a0e27",
        gridcolor="#1a1e37",
        gridstyle="--",
        gridaxis="both",
        y_on_right=True,
        rc={
            "axes.labelcolor": "#888",
            "xtick.color": "#666",
            "ytick.color": "#888",
            "font.size": 8,
        },
    )

    # Pattern-to-color mapping for boundary lines
    pattern_colors = {
        "Flat Top Squeeze": "#26a69a",
        "Descending Flag": "#ff9800",
        "Tight Bull Flag": "#42a5f5",
    }

    pages = []
    for page_idx in range(0, len(results), per_page):
        page_results = results[page_idx:page_idx + per_page]
        n_charts = len(page_results)
        if n_charts == 0:
            break

        rows = (n_charts + 1) // 2
        cols = 2
        fig, axes_grid = plt.subplots(rows, cols, figsize=(16, 5 * rows),
                                       squeeze=False)
        fig.patch.set_facecolor("#0a0e27")
        axes_flat = axes_grid.flatten().tolist()

        for idx, result in enumerate(page_results):
            ticker = result["ticker"]
            rank = page_idx + idx + 1
            df = price_data.get(ticker)
            if df is None:
                continue

            ax = axes_flat[idx]

            # Prepare data for mplfinance
            plot_df = df.copy()
            plot_df.index = pd.DatetimeIndex(plot_df.index)

            # Focus on the pole + flag region with some context before
            pole_start = result["_pole"]["pole_start"]
            context_start = max(0, pole_start - 20)  # 20 bars before pole
            plot_df = plot_df.iloc[context_start:]

            # Moving averages
            sma10 = plot_df["Close"].rolling(10).mean()
            sma20 = plot_df["Close"].rolling(20).mean()

            # Flag boundary lines
            flag_start_idx = result["_flag_start"] - context_start
            flag_high = result["_flag_high"]
            flag_low = result["_flag_low"]

            # Build horizontal lines for flag boundaries
            flag_high_line = pd.Series(np.nan, index=plot_df.index)
            flag_low_line = pd.Series(np.nan, index=plot_df.index)
            if flag_start_idx >= 0 and flag_start_idx < len(plot_df):
                flag_high_line.iloc[flag_start_idx:] = flag_high
                flag_low_line.iloc[flag_start_idx:] = flag_low

            pcolor = pattern_colors.get(result["pattern"], "#26a69a")

            addplots = [
                mpf.make_addplot(sma10, ax=ax, color="#ffd740", width=1.0),
                mpf.make_addplot(sma20, ax=ax, color="#ce93d8", width=1.0),
                mpf.make_addplot(flag_high_line, ax=ax, color=pcolor,
                                 linestyle="--", width=0.8),
                mpf.make_addplot(flag_low_line, ax=ax, color=pcolor,
                                 linestyle="--", width=0.8),
            ]

            try:
                mpf.plot(
                    plot_df, type="candle", style=style, ax=ax,
                    addplot=addplots, datetime_format="%m/%d",
                )
            except Exception as e:
                ax.text(0.5, 0.5, f"Chart error: {e}",
                        transform=ax.transAxes, color="red",
                        ha="center", va="center")
                continue

            title = (f"#{rank}  {ticker}  |  {result['pattern']}  |  "
                     f"{result['engine']}  |  Score {result['score']}/100")
            ax.set_title(title, color="white", fontsize=9, fontweight="bold",
                         pad=8)
            ax.set_facecolor("#0d1130")

            # Legend
            from matplotlib.lines import Line2D
            legend_items = [
                Line2D([0], [0], color=pcolor, lw=6, label=result["pattern"]),
                Line2D([0], [0], color="#ffd740", lw=1, label="10MA"),
                Line2D([0], [0], color="#ce93d8", lw=1, label="20MA"),
            ]
            ax.legend(handles=legend_items, loc="upper left", fontsize=7,
                      facecolor="#0a0e2799", edgecolor="#333",
                      labelcolor="white")

        # Hide unused axes
        for idx in range(n_charts, len(axes_flat)):
            axes_flat[idx].set_visible(False)

        plt.tight_layout(pad=2.0)
        page_num = page_idx // per_page + 1
        out_path = output_dir / f"flag_charts_{page_num}.png"
        fig.savefig(out_path, dpi=150, facecolor="#0a0e27",
                    bbox_inches="tight")
        plt.close(fig)
        pages.append(out_path)
        print(f"  Saved {out_path}")

    return pages


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Flag Pattern Scanner")
    parser.add_argument("--tickers", type=str, default=None,
                        help="Comma-separated ticker list")
    parser.add_argument("--file", type=str, default=None,
                        help="File with tickers (one per line)")
    parser.add_argument("--top", type=int, default=40,
                        help="Show top N results (default: 40)")
    parser.add_argument("--no-charts", action="store_true",
                        help="Skip chart generation")
    parser.add_argument("--output-dir", type=str, default=".",
                        help="Chart output directory")
    parser.add_argument("--peg", action="store_true",
                        help="Power Earnings Gap mode: find gap-ups consolidating")
    parser.add_argument("--universe", type=str, default="pipeline",
                        choices=["pipeline", "sp500", "all"],
                        help="Stock universe: pipeline (~2000 liquid), "
                             "sp500 (S&P500+NDX100), all (full pipeline ~4800)")
    args = parser.parse_args()

    t0 = time.time()
    print("=" * 70)
    print("  FLAG PATTERN SCANNER")
    print("=" * 70)

    # Build ticker list
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",")]
    elif args.file:
        with open(args.file) as f:
            tickers = [line.strip().upper() for line in f if line.strip()]
    elif args.universe == "sp500":
        print("\nFetching universe (S&P 500 + Nasdaq 100)...")
        sp500 = get_sp500_tickers()
        ndx100 = get_nasdaq100_tickers()
        tickers = sorted(set(sp500 + ndx100))
        print(f"  Universe: {len(tickers)} unique tickers")
    elif args.universe == "all":
        print("\nLoading full pipeline universe...")
        tickers = get_pipeline_tickers(min_dollar_vol=1_000_000, min_price=5.0)
        if not tickers:
            print("  Pipeline data not found, falling back to S&P 500 + NDX 100")
            tickers = sorted(set(get_sp500_tickers() + get_nasdaq100_tickers()))
        print(f"  Universe: {len(tickers)} tickers")
    else:  # pipeline (default)
        print("\nLoading pipeline universe (liquid stocks)...")
        tickers = get_pipeline_tickers(min_dollar_vol=5_000_000, min_price=5.0)
        if not tickers:
            print("  Pipeline data not found, falling back to S&P 500 + NDX 100")
            tickers = sorted(set(get_sp500_tickers() + get_nasdaq100_tickers()))
        print(f"  Universe: {len(tickers)} tickers")

    # Fetch data
    print()
    price_data = fetch_ohlcv(tickers)

    # Filter: price > $5, avg volume > 500K
    filtered = {}
    for ticker, df in price_data.items():
        if len(df) < 60:
            continue
        price = float(df["Close"].iloc[-1])
        avg_vol = float(df["Volume"].mean())
        if price > 5 and avg_vol > 500_000:
            filtered[ticker] = df
    print(f"  After filters: {len(filtered)} stocks (price>$5, vol>500K)")

    # Scan
    if args.peg:
        print("\nScanning for Power Earnings Gaps...")
        results = []
        for ticker, df in filtered.items():
            result = scan_peg(ticker, df)
            if result:
                results.append(result)
        results.sort(key=lambda x: -x["score"])
    else:
        print("\nScanning for flag patterns...")
        results = []
        for ticker, df in filtered.items():
            result = scan_stock(ticker, df)
            if result:
                results.append(result)
        results.sort(key=lambda x: -x["score"])

    top_n = min(args.top, len(results))

    # --- Print results ---
    print()
    print("=" * 70)

    if args.peg:
        # PEG output format
        print(f"  TOP {top_n} POWER EARNINGS GAPS:")
        print("=" * 70)

        hdr = (f"{'Ticker':<7} {'Pattern':<20} {'Score':>6} "
               f"{'Gap%':>6} {'Chg%':>6} {'RVol':>5} {'Days':>5} "
               f"{'Bars':>5} {'Retr%':>7} {'Hold':>5} {'Status':<7} "
               f"{'ClPos':>6} {'Width':>6} {'VolC':>6} {'Close':>8}")
        print(hdr)
        print("-" * len(hdr))

        for r in results[:top_n]:
            print(
                f"{r['ticker']:<7} {r['pattern']:<20} "
                f"{r['score']:>6.1f} {r['gap_pct']:>6.1f} "
                f"{r['change_pct']:>6.1f} {r['vol_ratio']:>5.1f} "
                f"{r['days_since']:>5} {r['flag_bars']:>5} "
                f"{r['retracement']:>7.1f} {r['gap_hold']:>5} "
                f"{r['gap_hold_label']:<7} {r['close_pos']:>6.2f} "
                f"{r['width_metric']:>6.1f} {r['vol_contraction']:>6.2f} "
                f"{r['last_close']:>8.2f}"
            )

        # PEG summary
        held = [r for r in results if r["gap_hold_label"] == "HELD"]
        basing = [r for r in results if r["gap_hold_label"] == "BASING"]
        fading = [r for r in results if r["gap_hold_label"] == "FADING"]
        print()
        print("  Gap hold status:")
        print(f"    HELD (4-5)     {len(held):>4}  — strong institutional demand")
        print(f"    BASING (2-3)   {len(basing):>4}  — building support")
        print(f"    FADING (0-1)   {len(fading):>4}  — weak hold")
        print(f"    Total          {len(results):>4}")

        # Pattern counts
        pattern_counts = {}
        for r in results:
            pattern_counts[r["pattern"]] = pattern_counts.get(r["pattern"], 0) + 1
        print()
        print("  Pattern counts:")
        for p, c in sorted(pattern_counts.items(), key=lambda x: -x[1]):
            print(f"    {p:<25} {c:>4}")
    else:
        print(f"  TOP {top_n} RESULTS:")
        print("=" * 70)

        # Separate by engine
        pole_results = [r for r in results if r["engine"] == "POLE"]
        no_pole_results = [r for r in results if r["engine"] == "NO_POLE"]

        # Pattern counts
        pattern_counts = {}
        for r in results:
            p = r["pattern"]
            pattern_counts[p] = pattern_counts.get(p, 0) + 1

        hdr = (f"{'Ticker':<7} {'Engine':<8} {'Pattern':<20} {'Score':>6} "
               f"{'PoleG%':>7} {'Bars':>5} {'Retr%':>7} {'ClPos':>6} "
               f"{'NrHi':>6} {'Width':>6} {'Compr':>6} {'VolC':>6} "
               f"{'ATR%':>6} {'Close':>8}")
        print(hdr)
        print("-" * len(hdr))

        for r in results[:top_n]:
            print(
                f"{r['ticker']:<7} {r['engine']:<8} {r['pattern']:<20} "
                f"{r['score']:>6.1f} {r['pole_gain']:>7.1f} {r['flag_bars']:>5} "
                f"{r['retracement']:>7.1f} {r['close_pos']:>6.2f} "
                f"{r['near_high']:>6.2f} {r['width_metric']:>6.1f} "
                f"{r['compression']:>6.2f} {r['vol_contraction']:>6.2f} "
                f"{r['atr_pct']:>6.2f} {r['last_close']:>8.2f}"
            )

        # Summary
        print()
        print("  Pattern counts:")
        for p, c in sorted(pattern_counts.items(), key=lambda x: -x[1]):
            print(f"    {p:<25} {c:>4}")

        print(f"\n  Engine breakdown:")
        print(f"    POLE        {len(pole_results):>4}")
        print(f"    NO_POLE     {len(no_pole_results):>4}")
        print(f"    Total       {len(results):>4}")

    # Charts
    if not args.no_charts and results:
        print(f"\nGenerating charts for top {top_n} setups...")
        chart_results = results[:top_n]
        pages = generate_charts(chart_results, price_data, args.output_dir)
        print(f"  Generated {len(pages)} chart pages")

    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.1f}s")


if __name__ == "__main__":
    main()
