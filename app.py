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
    "hourly": {"period": "2d", "interval": "5m", "date_fmt": "%H:%M", "max_points": 144},
    "daily": {"period": "1mo", "interval": "1d", "date_fmt": "%d %b", "max_points": 3},
    "weekly": {"period": "1mo", "interval": "1d", "date_fmt": "%d %b", "max_points": 7},
    "monthly": {"period": "3mo", "interval": "1d", "date_fmt": "%d %b", "max_points": 30},
}


@app.route("/")
def index():
    return render_template("index.html")


def get_global_data(range_key: str = "daily"):
    """
    ONS Altin (GC=F), USD/TRY (TRY=X) ve ABD 10Y (^TNX) verilerini çeker.
    Son kapanış ve yüzde değişimi döndürür.
    Ayrıca ONS ve USD/TRY için seçilen aralığa göre kapanış serisini döndürür.
    """
    if range_key == "yearly":
        range_key = "monthly"
    preset = HISTORY_PRESETS.get(range_key, HISTORY_PRESETS["daily"])
    tickers = {
        "ONS": ["GC=F", "XAUUSD=X"],
        "USDTRY": ["TRY=X"],
        "US10Y": ["^TNX"],
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
        series_map = {}
        interval = preset["interval"]
        intraday = interval in {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"}

        if intraday:
            # Intraday'de tek tek çek + gerekirse daha geniş interval fallback
            fallback_intervals = ["15m", "30m", "60m", "1h"]
            interval_candidates = [interval] + [iv for iv in fallback_intervals if iv != interval]

            def _download_close(symbol: str):
                for iv in interval_candidates:
                    try:
                        df = yf.download(
                            symbol,
                            period=preset["period"],
                            interval=iv,
                            progress=False,
                            threads=False,
                        )
                    except Exception:
                        continue
                    if df is None or df.empty:
                        continue
                    close_data = df.get("Close")
                    if close_data is None:
                        continue
                    if isinstance(close_data, pd.DataFrame):
                        if symbol in close_data.columns:
                            close_series = close_data[symbol]
                        elif close_data.shape[1] == 1:
                            close_series = close_data.iloc[:, 0]
                        else:
                            continue
                    else:
                        close_series = close_data
                    close_series = close_series.dropna()
                    if not close_series.empty:
                        return close_series
                return None

            for key, symbols in tickers.items():
                close_series = None
                for symbol in symbols:
                    close_series = _download_close(symbol)
                    if close_series is not None and not close_series.empty:
                        break
                if close_series is not None and not close_series.empty:
                    series_map[key] = close_series
        else:
            primary_symbols = [symbols[0] for symbols in tickers.values()]
            hist_df = yf.download(
                primary_symbols,
                period=preset["period"],
                interval=interval,
                progress=False,
                threads=False,
            )
            if isinstance(hist_df.columns, pd.MultiIndex):
                close_df = hist_df["Close"]
            else:
                close_df = hist_df
            if isinstance(close_df, pd.Series):
                close_df = close_df.to_frame()

            for key, symbols in tickers.items():
                symbol = symbols[0]
                if symbol not in close_df.columns:
                    continue
                series = close_df[symbol].dropna()
                if not series.empty:
                    series_map[key] = series

            # Eksik kalanlar için fallback sembolleri dene
            for key, symbols in tickers.items():
                if key in series_map:
                    continue
                for symbol in symbols[1:]:
                    try:
                        df = yf.download(
                            symbol,
                            period=preset["period"],
                            interval=interval,
                            progress=False,
                            threads=False,
                        )
                    except Exception:
                        continue
                    if df is None or df.empty:
                        continue
                    close_data = df.get("Close")
                    if close_data is None:
                        continue
                    if isinstance(close_data, pd.DataFrame):
                        if symbol in close_data.columns:
                            close_series = close_data[symbol]
                        elif close_data.shape[1] == 1:
                            close_series = close_data.iloc[:, 0]
                        else:
                            continue
                    else:
                        close_series = close_data
                    close_series = close_series.dropna()
                    if not close_series.empty:
                        series_map[key] = close_series
                        break

        if series_map:
            history_df = pd.DataFrame(series_map).sort_index()
            history_df = history_df.dropna(axis=1, how="all")
            if not history_df.empty:
                history_df = history_df.ffill().bfill()
                if range_key == "hourly":
                    history_df = history_df.resample("10min").last().ffill()
                max_points = preset.get("max_points")
                if max_points:
                    history_df = history_df.tail(max_points)

                history["dates"] = [idx.strftime(preset["date_fmt"]) for idx in history_df.index]
                if "ONS" in history_df:
                    history["ons_prices"] = [round(float(v), 2) for v in history_df["ONS"].tolist()]
                if "USDTRY" in history_df:
                    history["usd_prices"] = [round(float(v), 4) for v in history_df["USDTRY"].tolist()]
                if "US10Y" in history_df:
                    history["us10y_prices"] = [round(float(v), 2) for v in history_df["US10Y"].tolist()]

                if "ONS" in history_df and "USDTRY" in history_df:
                    gram_series = history_df["ONS"] * history_df["USDTRY"] / 31.1035
                    history["gram_prices"] = [round(float(v), 2) for v in gram_series.tolist()]

                history["arbitrage_prices"] = []
                history["arbitrage_dates"] = []

            for key in ["ONS", "USDTRY", "US10Y"]:
                series = series_map.get(key)
                if series is None or series.empty:
                    result[key] = {"price": 0, "change": 0}
                    continue
                current = float(series.iloc[-1])
                if len(series) > 1:
                    prev = float(series.iloc[-2])
                else:
                    prev = current
                change = ((current - prev) / prev) * 100 if prev != 0 else 0
                result[key] = {
                    "price": round(current, 2),
                    "change": round(change, 2),
                }

            if history["dates"] and range_key != "hourly":
                _ensure_today_tail(
                    history["dates"],
                    [
                        history["ons_prices"],
                        history["usd_prices"],
                        history["us10y_prices"],
                        history["gram_prices"],
                    ],
                    preset["date_fmt"],
                    preset.get("max_points"),
                )
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
        if range_key == "yearly":
            range_key = "monthly"
        if range_key == "hourly":
            series = df["arbitrage"].resample("10min").last().ffill().dropna().tail(144)
            date_fmt = "%H:%M"
        else:
            series = df["arbitrage"].resample("D").last().dropna()
            if range_key == "daily":
                series = series.tail(3)
            elif range_key == "weekly":
                series = series.tail(7)
            else:
                series = series.tail(30)
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


def _ensure_today_tail(dates, series_list, date_fmt, max_points=None):
    if not dates:
        return
    today_label = datetime.now().strftime(date_fmt)
    if dates[-1] != today_label:
        dates.append(today_label)
        for series in series_list:
            if series:
                series.append(series[-1])
    if max_points and len(dates) > max_points:
        keep = max_points
        del dates[:-keep]
        for series in series_list:
            if series and len(series) > keep:
                del series[:-keep]


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
    preset_key = "monthly" if range_key == "yearly" else range_key
    preset = HISTORY_PRESETS.get(preset_key, HISTORY_PRESETS["daily"])
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

        # Saatlikte tek nokta gelirse grafiği doldurmak için hizala
        if range_key == "hourly" and hist.get("dates"):
            if len(hist["arbitrage_dates"]) < len(hist["dates"]):
                last_val = hist["arbitrage_prices"][-1] if hist["arbitrage_prices"] else 0
                hist["arbitrage_dates"] = hist["dates"]
                hist["arbitrage_prices"] = [last_val for _ in hist["dates"]]
    if hist.get("arbitrage_dates") and hist.get("arbitrage_prices") and range_key != "hourly":
        _ensure_today_tail(
            hist["arbitrage_dates"],
            [hist["arbitrage_prices"]],
            preset["date_fmt"],
            preset.get("max_points"),
        )

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
