"""
stockanalysis.com scraper — primary fundamentals source post-FMP.

Covers: income statement, cash flow, ratios, profile, statistics
(float/short interest), analyst forecast, earnings calendar.

Rules:
  - Pipeline-side only. Cloudflare blocks Vercel datacenter IPs.
  - 1 req/s, serial. Shared rate-limit token bucket if multiple scripts run.
  - 24h disk cache under ~/.themepulse/sa_cache/. Override with fresh=True.
  - Identifies as ThemePulse-Research with contact email. Good-faith scraping.
  - HTML shape can change; run canary() daily to detect breakage.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ThemePulse-Research/1.0 (+nprabhak2018@gmail.com)"
BASE = "https://stockanalysis.com"
CACHE_DIR = Path.home() / ".themepulse" / "sa_cache"
DEFAULT_TTL = timedelta(hours=24)
CALENDAR_TTL = timedelta(hours=1)

_LAST_REQ_AT = 0.0
_MIN_INTERVAL_S = 1.0


def _rate_limit():
    """Block until ≥1s has passed since the last request."""
    global _LAST_REQ_AT
    dt = time.monotonic() - _LAST_REQ_AT
    if dt < _MIN_INTERVAL_S:
        time.sleep(_MIN_INTERVAL_S - dt)
    _LAST_REQ_AT = time.monotonic()


def _cache_path(url: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", url.replace(BASE + "/", ""))
    return CACHE_DIR / f"{safe}.html"


def fetch(url: str, *, ttl: timedelta = DEFAULT_TTL, fresh: bool = False) -> str:
    """Fetch a URL, respecting rate limit + cache. Returns HTML text."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = _cache_path(url)
    if not fresh and path.exists():
        age = datetime.now(timezone.utc) - datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        )
        if age < ttl:
            return path.read_text()

    _rate_limit()
    last_err = None
    for attempt in range(3):
        try:
            resp = requests.get(url, headers={"User-Agent": UA}, timeout=15)
            if resp.status_code == 429:
                time.sleep(5 * (attempt + 1))
                continue
            resp.raise_for_status()
            path.write_text(resp.text)
            return resp.text
        except requests.RequestException as e:
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch failed after 3 tries: {url}: {last_err}")


# ── Parsing helpers ──────────────────────────────────────────────────────


def _parse_main_table(html: str) -> dict[str, Any]:
    """Parse a stockanalysis financials table: headers + row labels → values.

    Returns: {"periods": [...], "rows": {label: [vals]}}
    Numbers kept as strings ("143,756", "15.65%", "-", etc.) — caller normalizes.
    """
    tbody_start = re.search(r'<tbody[^>]*>', html)
    if not tbody_start:
        raise ValueError("no <tbody> in response")
    body = html[tbody_start.end() : html.find("</tbody>", tbody_start.end())]
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.DOTALL)
    parsed: dict[str, list[str]] = {}
    for r in rows:
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.DOTALL)
        clean = [re.sub(r"<[^>]+>", "", c).replace("&amp;", "&").strip() for c in cells]
        if not clean:
            continue
        parsed[clean[0]] = clean[1:]

    # Header (for period labels)
    thead = re.search(r"<thead[^>]*>(.*?)</thead>", html, re.DOTALL)
    periods: list[str] = []
    if thead:
        hdr_cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", thead.group(1), re.DOTALL)
        hdr_clean = [re.sub(r"<[^>]+>", "", c).strip() for c in hdr_cells]
        # Drop the first cell ("Fiscal Quarter" / "Fiscal Year")
        if hdr_clean:
            periods = hdr_clean[1:]

    return {"periods": periods, "rows": parsed}


def _num(val: str) -> float | None:
    """'143,756' → 143756.0.  '15.65%' → 15.65.  '-' → None."""
    if not val or val.strip() in {"-", "—", "N/A", ""}:
        return None
    s = val.replace(",", "").replace("$", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


# ── Public API ───────────────────────────────────────────────────────────


@dataclass
class FinancialRow:
    metric: str
    values: list[float | None]  # aligned with periods


def get_financials(ticker: str, *, period: str = "quarterly", fresh: bool = False):
    """Income statement.  period='quarterly' | 'annual' | 'trailing'.

    Returns {
      'periods': ['Q1 2026', 'Q4 2025', ...],
      'revenue':        [143756.0, 102466.0, ...],
      'gross_profit':   [...],
      'operating_income': [...],
      'net_income':     [...],
      'eps_diluted':    [...],
      'fcf':            [...],
      'shares_diluted': [...],
      'gross_margin':   [...],
      'operating_margin':[...],
      'profit_margin':  [...],
      'updated':        ISO timestamp
    }
    """
    url = f"{BASE}/stocks/{ticker.lower()}/financials/?p={period}"
    html = fetch(url, fresh=fresh)
    tbl = _parse_main_table(html)

    wanted = {
        "Revenue": "revenue",
        "Gross Profit": "gross_profit",
        "Operating Income": "operating_income",
        "Net Income": "net_income",
        "EPS (Diluted)": "eps_diluted",
        "EPS (Basic)": "eps_basic",
        "Free Cash Flow": "fcf",
        "Shares Outstanding (Diluted)": "shares_diluted",
        "Gross Margin": "gross_margin",
        "Operating Margin": "operating_margin",
        "Profit Margin": "profit_margin",
        "EBITDA": "ebitda",
    }
    out: dict[str, Any] = {
        "ticker": ticker.upper(),
        "period": period,
        "periods": tbl["periods"][: 20 if period == "quarterly" else 10],
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    for label, key in wanted.items():
        raw = tbl["rows"].get(label, [])
        out[key] = [_num(v) for v in raw]
    return out


def get_cash_flow(ticker: str, *, period: str = "quarterly", fresh: bool = False):
    """Cash flow statement (extra detail beyond `fcf` already in financials)."""
    url = f"{BASE}/stocks/{ticker.lower()}/financials/cash-flow-statement/?p={period}"
    html = fetch(url, fresh=fresh)
    tbl = _parse_main_table(html)

    wanted = {
        "Operating Cash Flow": "operating_cf",
        "Investing Cash Flow": "investing_cf",
        "Financing Cash Flow": "financing_cf",
        "Capital Expenditures": "capex",
        "Free Cash Flow": "fcf",
        "Stock-Based Compensation": "sbc",
    }
    out = {
        "ticker": ticker.upper(),
        "period": period,
        "periods": tbl["periods"],
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    for label, key in wanted.items():
        raw = tbl["rows"].get(label, [])
        out[key] = [_num(v) for v in raw]
    return out


def get_ratios(ticker: str, *, period: str = "quarterly", fresh: bool = False):
    url = f"{BASE}/stocks/{ticker.lower()}/financials/ratios/?p={period}"
    html = fetch(url, fresh=fresh)
    tbl = _parse_main_table(html)
    wanted = {
        "PE Ratio": "pe",
        "PS Ratio": "ps",
        "PB Ratio": "pb",
        "P/FCF Ratio": "pfcf",
        "EV/Sales": "ev_sales",
        "EV/EBITDA": "ev_ebitda",
        "Debt / Equity Ratio": "de",
        "Return on Equity (ROE)": "roe",
        "Return on Assets (ROA)": "roa",
        "Return on Invested Capital (ROIC)": "roic",
    }
    out = {
        "ticker": ticker.upper(),
        "period": period,
        "periods": tbl["periods"],
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    for label, key in wanted.items():
        raw = tbl["rows"].get(label, [])
        out[key] = [_num(v) for v in raw]
    return out


# ── Profile ──────────────────────────────────────────────────────────────

_PROFILE_FIELDS = {
    "CEO": "ceo",
    "Employees": "employees",
    "Sector": "sector",
    "Industry": "industry",
    "Headquarters": "headquarters",
    "Founded": "founded",
    "IPO Date": "ipo_date",
    "Exchange": "exchange",
    "Website": "website",
    "Phone": "phone",
    "Country": "country",
}


def _extract_table_kv(html: str) -> dict[str, str]:
    """Scan all <tr><td>Label</td><td>Value</td></tr> pairs in the page."""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
    kv: dict[str, str] = {}
    for r in rows:
        cells = re.findall(r"<td[^>]*>(.*?)</td>", r, re.DOTALL)
        if len(cells) >= 2:
            label = re.sub(r"<[^>]+>", "", cells[0]).strip()
            value = re.sub(r"<[^>]+>", "", cells[1]).replace("&amp;", "&").strip()
            if label and label not in kv:
                kv[label] = value
    return kv


def get_profile(ticker: str, *, fresh: bool = False):
    """Company profile: sector, industry, description, CEO, employees, etc."""
    url = f"{BASE}/stocks/{ticker.lower()}/company/"
    html = fetch(url, fresh=fresh)
    out = {"ticker": ticker.upper(), "updated": datetime.now(timezone.utc).isoformat()}

    # Description: the "Company Description" heading is followed by <p> blocks.
    m = re.search(
        r"Company Description</h1>\s*<div[^>]*>(.*?)</div>",
        html,
        re.DOTALL,
    )
    if m:
        paras = re.findall(r"<p[^>]*>(.*?)</p>", m.group(1), re.DOTALL)
        out["description"] = "\n\n".join(
            re.sub(r"<[^>]+>", "", p).strip() for p in paras
        ).strip() or None

    kv = _extract_table_kv(html)
    for label, key in _PROFILE_FIELDS.items():
        if label in kv:
            out[key] = kv[label] or None
    return out


# ── Statistics: float + short interest + shares outstanding ──────────────

# Stats page embeds a JSON payload with stable machine-readable ids — far more
# reliable than parsing the rendered table. Map the ids we care about here.
_STATS_ID_MAP = {
    "sharesout": "shares_outstanding",
    "float": "shares_float",
    "shortInterest": "short_interest",
    "shortFloat": "short_pct_float",
    "shortShares": "short_pct_shares",
    "shortRatio": "short_ratio",
    "sharesInsiders": "insider_pct",
    "sharesInstitutions": "institution_pct",
    "beta": "beta_5y",
    "ch1y": "change_52w_pct",
    "sma50": "sma_50",
    "sma200": "sma_200",
    "rsi": "rsi",
    "averageVolume": "avg_vol_20d",
    "marketcap": "market_cap",
    "enterpriseValue": "enterprise_value",
    "pe": "pe",
    "peForward": "pe_forward",
    "ps": "ps",
    "pb": "pb",
    "pfcf": "pfcf",
    "pegRatio": "peg",
    "evSales": "ev_sales",
    "evEbitda": "ev_ebitda",
    "roe": "roe",
    "roa": "roa",
    "roic": "roic",
    "employees": "employees",
    "earningsdate": "earnings_date",
    "exdivdate": "ex_dividend_date",
}

_STATS_JSON_RE = re.compile(
    r'\{id:"([^"]+)",title:"([^"]+)",value:"([^"]*)"(?:,hover:"([^"]*)")?'
)


def get_statistics(ticker: str, *, fresh: bool = False):
    """Float, short interest, avg volume, valuation ratios, etc.

    Pulls from the embedded Nuxt/Svelte data payload, which gives us exact
    numerical `hover` values alongside the display `value`.
    """
    url = f"{BASE}/stocks/{ticker.lower()}/statistics/"
    html = fetch(url, fresh=fresh)
    out = {"ticker": ticker.upper(), "updated": datetime.now(timezone.utc).isoformat()}

    for id_, title, value, hover in _STATS_JSON_RE.findall(html):
        if id_ not in _STATS_ID_MAP:
            continue
        key = _STATS_ID_MAP[id_]
        out[key] = value
        # Prefer hover (precise) for numerical coercion.
        raw = hover or value
        num = _num(raw)
        # hover for big numbers ("3,976,827,203,200") is raw; for percents
        # ("-2.497%") _num strips the % and returns the float directly.
        out[f"{key}_num"] = num
    return out


# ── Analyst forecast ─────────────────────────────────────────────────────


def get_analyst_forecast(ticker: str, *, fresh: bool = False):
    """Analyst price targets + EPS/revenue forecasts."""
    url = f"{BASE}/stocks/{ticker.lower()}/forecast/"
    html = fetch(url, fresh=fresh)
    out = {"ticker": ticker.upper(), "updated": datetime.now(timezone.utc).isoformat()}

    # Price target block — stockanalysis puts these in specific divs
    for label, key in [
        ("Average Target", "target_avg"),
        ("High Target", "target_high"),
        ("Low Target", "target_low"),
        ("Upside", "upside_pct"),
        ("Number of Analysts", "analyst_count"),
    ]:
        m = re.search(
            rf">{re.escape(label)}</[^>]+>.*?<td[^>]*>(.*?)</td>",
            html,
            re.DOTALL,
        )
        if m:
            raw = re.sub(r"<[^>]+>", "", m.group(1)).strip()
            out[key] = raw
            out[f"{key}_num"] = _num(raw)
    return out


# ── Earnings calendar ────────────────────────────────────────────────────


_CALENDAR_ENTRY_RE = re.compile(
    r'\{s:"([A-Z.]{1,6})",\s*n:"([^"]{1,120})",\s*t:"([^"]*)",\s*'
    r'e:([\d.\-null]+),\s*eg:([\d.\-null]+),\s*r:([\d.\-null]+),\s*'
    r'rg:([\d.\-null]+),\s*m:([\d.\-null]+)\s*\}'
)


def _num_or_none(token: str) -> float | None:
    if token in ("null", "", "None"):
        return None
    try:
        return float(token)
    except ValueError:
        return None


def get_earnings_calendar(date: str | None = None, *, fresh: bool = False):
    """Upcoming earnings (no date segment in URL — returns all upcoming).

    The stockanalysis /stocks/earnings-calendar/ page renders client-side
    from a SvelteKit hydration payload. We parse the payload directly.

    `date` is accepted but ignored for URL routing — the page gives you the
    whole upcoming list. Caller can filter by cross-referencing the
    earnings_date from get_statistics(ticker) if needed, or use the Nasdaq
    API fallback for date-specific queries.
    """
    url = f"{BASE}/stocks/earnings-calendar/"
    html = fetch(url, ttl=CALENDAR_TTL, fresh=fresh)

    time_map = {"bmo": "before market open", "amc": "after market close", "": None}
    entries = []
    for m in _CALENDAR_ENTRY_RE.finditer(html):
        sym, name, t, e, eg, r, rg, mcap = m.groups()
        entries.append(
            {
                "ticker": sym,
                "name": name,
                "time": time_map.get(t, t),
                "eps_est": _num_or_none(e),
                "eps_growth_pct": _num_or_none(eg),
                "rev_est": _num_or_none(r),
                "rev_growth_pct": _num_or_none(rg),
                "market_cap": _num_or_none(mcap),
            }
        )
    return {
        "date_requested": date,
        "count": len(entries),
        "entries": entries,
        "updated": datetime.now(timezone.utc).isoformat(),
    }


# ── Canary ───────────────────────────────────────────────────────────────


def canary() -> dict[str, Any]:
    """Daily-run validator: fetch AAPL and assert we can parse the shapes.
    Returns a status dict — wire this to Pushover if anything fails.
    """
    results = {}
    for name, fn, validate in [
        (
            "financials",
            lambda: get_financials("AAPL", fresh=True),
            lambda d: len(d["revenue"]) >= 4 and d["revenue"][0] is not None,
        ),
        (
            "cash_flow",
            lambda: get_cash_flow("AAPL", fresh=True),
            lambda d: len(d["fcf"]) >= 4,
        ),
        (
            "profile",
            lambda: get_profile("AAPL", fresh=True),
            lambda d: d.get("sector") and d.get("ceo"),
        ),
        (
            "statistics",
            lambda: get_statistics("AAPL", fresh=True),
            lambda d: d.get("shares_outstanding_num") is not None,
        ),
        (
            "calendar",
            lambda: get_earnings_calendar(fresh=True),
            lambda d: isinstance(d["entries"], list),
        ),
    ]:
        try:
            data = fn()
            ok = validate(data)
            results[name] = {"ok": ok, "sample": _sample(data)}
        except Exception as e:
            results[name] = {"ok": False, "error": str(e)}
    return results


def _sample(data: dict) -> dict:
    """Truncated sample of a response, for canary logs."""
    out = {}
    for k, v in data.items():
        if isinstance(v, list):
            out[k] = v[:3] + (["..."] if len(v) > 3 else [])
        elif isinstance(v, str) and len(v) > 100:
            out[k] = v[:100] + "..."
        else:
            out[k] = v
    return out


if __name__ == "__main__":
    import pprint
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "canary":
        pprint.pprint(canary())
    else:
        pprint.pprint(get_financials(sys.argv[1] if len(sys.argv) > 1 else "AAPL"))
