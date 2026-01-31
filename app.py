from flask import Flask, render_template, jsonify, request
import requests
from bs4 import BeautifulSoup
import yfinance as yf
import pandas as pd
from urllib.parse import quote_plus
from email.utils import parsedate_to_datetime
import xml.etree.ElementTree as ET
import time
import csv
from pathlib import Path
from datetime import datetime
import os


def _parse_tr_number(text: str):
    if not text:
        return None
    return float(text.replace(".", "").replace(",", ".").strip())


def _extract_bid_ask(html: str):
    soup = BeautifulSoup(html, "html.parser")
    bid_el = soup.select_one('span[data-socket-attr="bid"]')
    ask_el = soup.select_one('span[data-socket-attr="ask"]')
    if not bid_el or not ask_el:
        return None, None
    bid = _parse_tr_number(bid_el.get_text())
    ask = _parse_tr_number(ask_el.get_text())
    return bid, ask


def get_local_gold_data():
    """
    Garanti BBVA ve piyasa verilerini doviz.com'dan çeker.
    Hata olursa dummy veri döndürür.
    """
    url_garanti = "https://altin.doviz.com/garanti-bbva/gram-altin"
    url_piyasa = "https://altin.doviz.com/gram-altin"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
    }

    data = {
        "garanti": {"alis": 0.0, "satis": 0.0},
        "piyasa": {"alis": 0.0, "satis": 0.0},
        "status": "live",
    }

    try:
        res_g = requests.get(url_garanti, headers=headers, timeout=8)
        res_g.raise_for_status()
        g_alis, g_satis = _extract_bid_ask(res_g.text)
        if g_alis is not None and g_satis is not None:
            data["garanti"]["alis"] = g_alis
            data["garanti"]["satis"] = g_satis

        res_p = requests.get(url_piyasa, headers=headers, timeout=8)
        res_p.raise_for_status()
        p_alis, p_satis = _extract_bid_ask(res_p.text)
        if p_alis is not None and p_satis is not None:
            data["piyasa"]["alis"] = p_alis
            data["piyasa"]["satis"] = p_satis

        return data
    except Exception:
        data["status"] = "offline"
        data["garanti"] = {"alis": 2950.50, "satis": 3080.00}
        data["piyasa"] = {"alis": 3000.00, "satis": 3010.00}
        return data

app = Flask(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
ARBITRAGE_LOG_PATH = DATA_DIR / "arbitrage_history.csv"
ARBITRAGE_LOG_INTERVAL = 900
_LAST_ARBITRAGE_TS = 0

NEWS_CACHE = {
    "timestamp": 0,
    "data": {"status": "offline", "national": [], "international": [], "updated_at": None},
}
NEWS_TTL_SECONDS = 300
TRANSLATE_CACHE = {}

HISTORY_PRESETS = {
    "daily": {"period": "1mo", "interval": "1d", "date_fmt": "%d %b"},
    "weekly": {"period": "6mo", "interval": "1wk", "date_fmt": "%d %b"},
    "yearly": {"period": "1y", "interval": "1wk", "date_fmt": "%b %y"},
}


@app.route("/")
def index():
    return render_template("index.html")


def get_global_data(range_key: str = "daily"):
    """
    ONS Altin (GC=F), USD/TRY (TRY=X) ve ABD 10Y (^TNX) verilerini çeker.
    Son kapanış ve yüzde değişimi döndürür.
    Ayrıca ONS ve USD/TRY için son 30 gün kapanış serisini döndürür.
    """
    preset = HISTORY_PRESETS.get(range_key, HISTORY_PRESETS["daily"])
    tickers = {
        "ONS": "GC=F",
        "USDTRY": "TRY=X",
        "US10Y": "^TNX",
    }
    result = {}
    history = {
        "dates": [],
        "ons_prices": [],
        "usd_prices": [],
        "us10y_prices": [],
        "gram_prices": [],
        "arbitrage_prices": [],
        "arbitrage_dates": [],
    }
    try:
        hist_df = yf.download(
            ["GC=F", "TRY=X", "^TNX"],
            period=preset["period"],
            interval=preset["interval"],
            progress=False,
        )
        if isinstance(hist_df.columns, pd.MultiIndex):
            close_df = hist_df["Close"]
        else:
            close_df = hist_df
        if isinstance(close_df, pd.Series):
            close_df = close_df.to_frame()
        if "GC=F" in close_df.columns and "TRY=X" in close_df.columns and "^TNX" in close_df.columns:
            close_df = close_df[["GC=F", "TRY=X", "^TNX"]].dropna()
            history["dates"] = [idx.strftime(preset["date_fmt"]) for idx in close_df.index]
            ons_list = [float(v) for v in close_df["GC=F"].tolist()]
            usd_list = [float(v) for v in close_df["TRY=X"].tolist()]
            us10y_list = [float(v) for v in close_df["^TNX"].tolist()]

            history["ons_prices"] = [round(v, 2) for v in ons_list]
            history["usd_prices"] = [round(v, 4) for v in usd_list]
            history["us10y_prices"] = [round(v, 2) for v in us10y_list]

            gram_list = [round(ons * usd / 31.1035, 2) for ons, usd in zip(ons_list, usd_list)]
            history["gram_prices"] = gram_list
            history["arbitrage_prices"] = []
            history["arbitrage_dates"] = []

            series_map = {
                "ONS": ons_list,
                "USDTRY": usd_list,
                "US10Y": us10y_list,
            }
            for key, series in series_map.items():
                if len(series) < 2:
                    result[key] = {"price": 0, "change": 0}
                    continue
                current = float(series[-1])
                prev = float(series[-2])
                change = ((current - prev) / prev) * 100 if prev != 0 else 0
                result[key] = {
                    "price": round(current, 2),
                    "change": round(change, 2),
                }
    except Exception:
        result = {
            "ONS": {"price": 0, "change": 0},
            "USDTRY": {"price": 0, "change": 0},
            "US10Y": {"price": 0, "change": 0},
        }

    result["history"] = history
    return result


def _ensure_arbitrage_log():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ARBITRAGE_LOG_PATH.exists():
        with ARBITRAGE_LOG_PATH.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(
                ["timestamp", "garanti_alis", "garanti_satis", "piyasa_alis", "piyasa_satis", "arbitrage"]
            )


def _get_last_arbitrage_ts():
    if not ARBITRAGE_LOG_PATH.exists():
        return 0
    try:
        with ARBITRAGE_LOG_PATH.open("r", encoding="utf-8") as f:
            lines = f.read().strip().splitlines()
        if len(lines) < 2:
            return 0
        last = lines[-1].split(",")[0]
        dt = datetime.strptime(last, "%Y-%m-%d %H:%M:%S")
        return int(dt.timestamp())
    except Exception:
        return 0


def log_arbitrage(local):
    global _LAST_ARBITRAGE_TS
    if local.get("status") != "live":
        return
    _ensure_arbitrage_log()
    now = int(time.time())
    if _LAST_ARBITRAGE_TS == 0:
        _LAST_ARBITRAGE_TS = _get_last_arbitrage_ts()
    if now - _LAST_ARBITRAGE_TS < ARBITRAGE_LOG_INTERVAL:
        return

    g_alis = local.get("garanti", {}).get("alis", 0) or 0
    g_satis = local.get("garanti", {}).get("satis", 0) or 0
    p_alis = local.get("piyasa", {}).get("alis", 0) or 0
    p_satis = local.get("piyasa", {}).get("satis", 0) or 0
    arbitrage = round(p_satis - g_alis, 2)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    with ARBITRAGE_LOG_PATH.open("a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([ts, g_alis, g_satis, p_alis, p_satis, arbitrage])

    _LAST_ARBITRAGE_TS = now


def get_arbitrage_history(range_key: str):
    if not ARBITRAGE_LOG_PATH.exists():
        return {"dates": [], "values": []}
    try:
        df = pd.read_csv(ARBITRAGE_LOG_PATH, parse_dates=["timestamp"])
        if df.empty:
            return {"dates": [], "values": []}
        df = df.sort_values("timestamp").set_index("timestamp")
        now = pd.Timestamp.now()
        if range_key == "weekly":
            start = now - pd.Timedelta(days=180)
            series = df.loc[start:]["arbitrage"].resample("W").last().dropna()
            date_fmt = "%d %b"
        elif range_key == "yearly":
            start = now - pd.Timedelta(days=365)
            series = df.loc[start:]["arbitrage"].resample("W").last().dropna()
            date_fmt = "%b %y"
        else:
            start = now - pd.Timedelta(days=30)
            series = df.loc[start:]["arbitrage"].resample("D").last().dropna()
            date_fmt = "%d %b"
        return {
            "dates": [idx.strftime(date_fmt) for idx in series.index],
            "values": [round(float(v), 2) for v in series.tolist()],
        }
    except Exception:
        return {"dates": [], "values": []}


def _format_pubdate(pubdate: str):
    if not pubdate:
        return ""
    try:
        dt = parsedate_to_datetime(pubdate)
        return dt.strftime("%d %b %H:%M")
    except Exception:
        return pubdate


def _fetch_google_news(query: str, hl: str, gl: str, ceid: str, limit: int = 6):
    url = (
        "https://news.google.com/rss/search?q="
        + quote_plus(query)
        + f"&hl={hl}&gl={gl}&ceid={ceid}"
    )
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/122.0.0.0 Safari/537.36"
        )
    }
    res = requests.get(url, headers=headers, timeout=8)
    res.raise_for_status()
    root = ET.fromstring(res.text)
    channel = root.find("channel")
    items = []
    if channel is None:
        return items
    for item in channel.findall("item")[:limit]:
        title_el = item.find("title")
        link_el = item.find("link")
        source_el = item.find("source")
        pub_el = item.find("pubDate")
        items.append(
            {
                "title": title_el.text if title_el is not None else "",
                "link": link_el.text if link_el is not None else "",
                "source": source_el.text if source_el is not None else "",
                "published": _format_pubdate(pub_el.text if pub_el is not None else ""),
            }
        )
    return items


def _translate_to_tr(text: str):
    if not text:
        return ""
    cached = TRANSLATE_CACHE.get(text)
    if cached is not None:
        return cached
    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {
            "client": "gtx",
            "sl": "auto",
            "tl": "tr",
            "dt": "t",
            "q": text,
        }
        res = requests.get(url, params=params, timeout=6)
        res.raise_for_status()
        payload = res.json()
        translated = "".join([seg[0] for seg in payload[0]]) if payload else ""
        TRANSLATE_CACHE[text] = translated
        return translated
    except Exception:
        TRANSLATE_CACHE[text] = ""
        return ""


def get_news_data():
    now = int(time.time())
    if now - NEWS_CACHE["timestamp"] < NEWS_TTL_SECONDS:
        return NEWS_CACHE["data"]

    data = {"status": "live", "national": [], "international": [], "updated_at": None}
    try:
        data["national"] = _fetch_google_news(
            "altın fiyatı OR gram altın OR ons altın",
            "tr",
            "TR",
            "TR:tr",
            limit=6,
        )
        data["international"] = _fetch_google_news(
            "gold price OR bullion OR XAU",
            "en",
            "US",
            "US:en",
            limit=6,
        )
        for item in data["international"]:
            tr_title = _translate_to_tr(item.get("title", ""))
            if tr_title and tr_title != item.get("title"):
                item["title_tr"] = tr_title
        data["updated_at"] = time.strftime("%H:%M:%S")
    except Exception:
        data = NEWS_CACHE["data"]
        data["status"] = "offline"

    NEWS_CACHE["timestamp"] = now
    NEWS_CACHE["data"] = data
    return data


@app.route("/api/metrics")
def metrics():
    local = get_local_gold_data()
    log_arbitrage(local)
    range_key = request.args.get("range", "daily")
    global_data = get_global_data(range_key=range_key)
    hist = global_data.get("history", {})
    if hist.get("dates"):
        arb_hist = get_arbitrage_history(range_key)
        if arb_hist["dates"]:
            hist["arbitrage_dates"] = arb_hist["dates"]
            hist["arbitrage_prices"] = arb_hist["values"]
        else:
            arb_val = round(
                (local.get("piyasa", {}).get("satis", 0) or 0)
                - (local.get("garanti", {}).get("alis", 0) or 0),
                2,
            )
            hist["arbitrage_dates"] = hist["dates"]
            hist["arbitrage_prices"] = [arb_val for _ in hist["dates"]]

    garanti_alis = local.get("garanti", {}).get("alis", 0) or 0
    garanti_satis = local.get("garanti", {}).get("satis", 0) or 0
    spread = garanti_satis - garanti_alis
    spread_pct = (spread / garanti_alis) * 100 if garanti_alis else 0

    if spread_pct > 1.5:
        signal = "BEKLE (Yüksek Makas)"
    else:
        signal = "İŞLEM UYGUN"

    response = {
        "local": local,
        "global": global_data,
        "analysis": {
            "spread_tl": round(spread, 2),
            "spread_pct": round(spread_pct, 2),
            "signal": signal,
        },
    }
    return jsonify(response)


@app.route("/api/news")
def news():
    return jsonify(get_news_data())


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
