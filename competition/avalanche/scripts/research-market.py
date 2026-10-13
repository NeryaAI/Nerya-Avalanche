"""Download public price evidence; no account access and no transaction methods."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "research" / "2026-10-07"
START = int(datetime(2025, 6, 1, tzinfo=timezone.utc).timestamp())
END = int(datetime(2026, 10, 7, tzinfo=timezone.utc).timestamp())
SOURCES = []


def store(name, value):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fetch(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "Nerya-Competition-Research/1.0"})
    with urllib.request.urlopen(req, timeout=22) as response:
        data = response.read()
    return json.loads(data), hashlib.sha256(data).hexdigest()


def validate(rows, seconds):
    result = sorted([r for r in rows if START <= r["ts"] and r["ts"] + seconds <= END], key=lambda r: r["ts"])
    if len(result) < 365 * 86400 // seconds:
        raise ValueError("Insufficient real history for the fixed one-year window")
    if len({r["ts"] for r in result}) != len(result):
        raise ValueError("Duplicate candles")
    for i, row in enumerate(result):
        if row["ts"] % seconds or any(not math.isfinite(float(row[k])) or row[k] <= 0 for k in ("open", "high", "low", "close")):
            raise ValueError("Malformed OHLC")
        if row["high"] < max(row["open"], row["close"]) or row["low"] > min(row["open"], row["close"]):
            raise ValueError("Invalid OHLC bounds")
        if i and row["ts"] - result[i-1]["ts"] != seconds:
            raise ValueError("History contains gaps; refusing synthetic fill")
    if result[-1]["ts"] != END - seconds:
        raise ValueError("Dataset does not reach the fixed end boundary")
    return result


def binance(tf):
    seconds = {"1d": 86400, "4h": 14400}[tf]
    cursor, rows, requests = START, [], []
    while cursor < END:
        url = "https://data-api.binance.vision/api/v3/klines?" + urllib.parse.urlencode({
            "symbol": "AVAXUSDT", "interval": tf, "startTime": cursor * 1000, "endTime": END * 1000 - 1, "limit": 1000})
        raw, digest = fetch(url)
        if not isinstance(raw, list) or not raw:
            raise ValueError("Binance history ended prematurely")
        requests.append({"url": url, "rawSha256": digest})
        rows.extend({"ts": int(r[0])//1000, "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
                     "close": float(r[4]), "volume": float(r[5])} for r in raw)
        cursor = int(raw[-1][0])//1000 + seconds
        time.sleep(.25)
    rows = validate(rows, seconds)
    data = {"source": "Binance public AVAX/USDT", "sourceType": "cex_price_proxy_not_LFJ_fills", "timeframe": tf,
            "observedAt": datetime.now(timezone.utc).isoformat(), "start": START, "endExclusive": END,
            "requests": requests, "rows": len(rows), "candles": rows}
    digest = store(f"data/binance-{tf}.json", data)
    return {"source": "Binance", "timeframe": tf, "rows": len(rows), "fileSha256": digest, "status": "ready"}


def gmx(tf):
    seconds = {"1d": 86400, "4h": 14400}[tf]
    # The public fallback is explicitly documented by GMX; no access-control bypass.
    url = "https://avalanche-api-fallback.gmxinfra2.io/prices/candles?" + urllib.parse.urlencode({
        "tokenSymbol": "AVAX", "period": tf, "limit": 3500 if tf == "4h" else 550})
    raw, digest = fetch(url)
    if raw.get("period") != tf:
        raise ValueError("GMX candle timeframe mismatch")
    rows = validate([{"ts": int(r[0]), "open": float(r[1]), "high": float(r[2]), "low": float(r[3]),
                      "close": float(r[4])} for r in raw["candles"]], seconds)
    # Oracle OHLC has no traded-volume field; do not fabricate one.
    data = {"source": "GMX Avalanche oracle OHLC", "sourceType": "oracle_price_proxy_not_LFJ_fills", "timeframe": tf,
            "observedAt": datetime.now(timezone.utc).isoformat(), "start": START, "endExclusive": END,
            "requests": [{"url": url, "rawSha256": digest}], "rows": len(rows), "candles": rows,
            "volumeAvailable": False}
    digest = store(f"data/gmx-{tf}.json", data)
    return {"source": "GMX", "timeframe": tf, "rows": len(rows), "fileSha256": digest, "status": "ready"}


def market_info():
    url = "https://avalanche-api-fallback.gmxinfra2.io/markets/info"
    raw, digest = fetch(url)
    store("data/gmx-markets-info.json", {"sourceUrl": url, "rawSha256": digest,
          "observedAt": datetime.now(timezone.utc).isoformat(), "data": raw,
          "scope": "Current market snapshot, not historical realized funding or LP returns"})
    return {"source": "GMX market snapshot", "status": "ready", "rawSha256": digest}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    plan = OUT / "PLAN.zh-CN.md"
    if not plan.is_file():
        raise RuntimeError("Write a fixed research plan before downloading the evidence")
    calls = [("binance-1d", lambda: binance("1d")), ("binance-4h", lambda: binance("4h")),
             ("gmx-1d", lambda: gmx("1d")), ("gmx-4h", lambda: gmx("4h")), ("gmx-markets-info", market_info)]
    manifest = {"startedAt": datetime.now(timezone.utc).isoformat(), "planSha256": hashlib.sha256(plan.read_bytes()).hexdigest(),
                "endExclusive": END, "syntheticFallback": False, "records": []}
    with ThreadPoolExecutor(max_workers=3) as executor:
        pending = [(name, executor.submit(fn)) for name, fn in calls]
        for name, future in pending:
            try:
                row = future.result()
            except Exception as exc:
                row = {"source": name, "status": "unavailable", "error": str(exc)}
            manifest["records"].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
    store("data-manifest.json", manifest)
    if not all((OUT / f"data/binance-{tf}.json").is_file() for tf in ("1d", "4h")):
        raise RuntimeError("Required CEX comparison history was not obtained")


if __name__ == "__main__":
    main()
