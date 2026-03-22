import re
from datetime import datetime

import pytz
import requests
from bs4 import BeautifulSoup

IST = pytz.timezone("Asia/Kolkata")

SITE_URL = "https://www.livechennai.com/gold_silverrate.asp"
REQUEST_TIMEOUT = 20
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


def _fetch_soup():
    """Fetch and parse the livechennai gold/silver page."""
    response = requests.get(SITE_URL, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return BeautifulSoup(response.text, "html.parser")


def scrape_prices():
    """Scrape today's gold and silver prices.

    The site has a known table layout:
      Table 0  — today's summary: Date | 22K 1gm | Silver 1gm
      Table 1  — gold history:    Date | 24K 1gm | 24K 8gm | 22K 1gm | 22K 8gm
      Table 3  — silver history:  Date | Silver 1gm | Silver 1kg
    """
    soup = _fetch_soup()
    now = datetime.now(IST)
    data = {
        "timestamp": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
        "time_slot": _current_slot(),
        "gold_22k": None,
        "gold_24k": None,
        "silver": None,
    }

    tables = soup.find_all("table")
    _parse_summary_table(tables, data)

    if data["gold_24k"] is None:
        _parse_gold_history_table(tables, data)

    if data["silver"] is None:
        _parse_silver_history_table(tables, data)

    if data["gold_22k"] is None:
        _fallback_regex(soup.get_text(), data)

    return data


def scrape_history():
    """Scrape the full 7-10 day price history from the site.

    Returns a list of dicts, one per historical date, with keys:
        date, timestamp, time_slot, gold_22k, gold_24k, silver
    The site publishes one row per calendar day.
    """
    soup = _fetch_soup()
    tables = soup.find_all("table")

    gold_by_date = {}
    silver_by_date = {}

    _extract_gold_history(tables, gold_by_date)
    _extract_silver_history(tables, silver_by_date)

    all_dates = sorted(set(gold_by_date.keys()) | set(silver_by_date.keys()))
    now = datetime.now(IST)

    results = []
    for date_str in all_dates:
        gold = gold_by_date.get(date_str, {})
        silver = silver_by_date.get(date_str)
        results.append({
            "date": date_str,
            "timestamp": now.isoformat(),
            "time_slot": "morning",
            "gold_22k": gold.get("gold_22k"),
            "gold_24k": gold.get("gold_24k"),
            "silver": silver,
        })

    return results


# ── Gold history table parser ──────────────────────────────────────

def _extract_gold_history(tables, out):
    """Parse Table 1: Date | 24K 1gm | 24K 8gm | 22K 1gm | 22K 8gm."""
    for table in tables:
        header = _header_text(table)
        if "24" not in header or "22" not in header:
            continue

        rows = table.find_all("tr")
        for row in rows[2:]:
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            date_str = _parse_site_date(cells[0].get_text(strip=True))
            if not date_str:
                continue
            gold_24k = _parse_price(cells[1].get_text(strip=True))
            gold_22k = _parse_price(cells[3].get_text(strip=True))
            if gold_22k and gold_22k > 100:
                out[date_str] = {
                    "gold_22k": gold_22k,
                    "gold_24k": gold_24k if gold_24k and gold_24k > 100 else None,
                }
        return


def _extract_silver_history(tables, out):
    """Parse Table 3: Date | Silver 1gm | Silver 1kg."""
    for table in tables:
        header = _header_text(table)
        if "silver" not in header.lower():
            continue
        if "22" in header or "24" in header:
            continue

        rows = table.find_all("tr")
        for row in rows[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            date_str = _parse_site_date(cells[0].get_text(strip=True))
            if not date_str:
                continue
            silver = _parse_price(cells[1].get_text(strip=True))
            if silver and silver > 10:
                out[date_str] = silver
        return


# ── Summary table (today only) ─────────────────────────────────────

def _parse_summary_table(tables, data):
    """Table 0: Date | 22K 1gm | Silver 1gm."""
    for table in tables:
        header = _header_text(table)
        if "22" not in header and "silver" not in header.lower():
            continue
        if "1 gm" not in header.lower() and "22 k" not in header.lower():
            continue

        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if len(cells) < 3:
                continue
            gold_22k = _parse_price(cells[1].get_text(strip=True))
            silver = _parse_price(cells[2].get_text(strip=True))
            if gold_22k and gold_22k > 100:
                data["gold_22k"] = gold_22k
            if silver and silver > 10:
                data["silver"] = silver
            break
        if data["gold_22k"]:
            return


def _parse_gold_history_table(tables, data):
    """Fallback: pull today's row from gold history table."""
    for table in tables:
        header = _header_text(table)
        if "24" not in header or "22" not in header:
            continue

        for row in table.find_all("tr")[2:]:
            cells = row.find_all("td")
            if len(cells) < 5:
                continue
            gold_24k = _parse_price(cells[1].get_text(strip=True))
            gold_22k = _parse_price(cells[3].get_text(strip=True))
            if gold_24k and gold_24k > 100:
                data["gold_24k"] = gold_24k
            if gold_22k and gold_22k > 100 and data["gold_22k"] is None:
                data["gold_22k"] = gold_22k
            break
        if data["gold_24k"]:
            return


def _parse_silver_history_table(tables, data):
    """Fallback: pull today's row from silver history table."""
    for table in tables:
        header = _header_text(table)
        if "silver" not in header.lower():
            continue
        if "22" in header or "24" in header:
            continue

        for row in table.find_all("tr")[1:]:
            cells = row.find_all("td")
            if len(cells) < 2:
                continue
            silver = _parse_price(cells[1].get_text(strip=True))
            if silver and silver > 10:
                data["silver"] = silver
            break
        if data["silver"]:
            return


# ── Helpers ────────────────────────────────────────────────────────

def _header_text(table):
    first_row = table.find("tr")
    return first_row.get_text(separator=" ", strip=True) if first_row else ""


def _parse_site_date(text):
    """Convert 'DD/Mon/YYYY' (e.g. '22/Mar/2026') → 'YYYY-MM-DD'."""
    text = text.strip()
    for fmt in ("%d/%b/%Y", "%d-%b-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _fallback_regex(text, data):
    patterns = {
        "gold_22k": r"22\s*(?:carat|ct|k)\D{0,30}?(\d{1,2},\d{3})",
        "gold_24k": r"24\s*(?:carat|ct|k)\D{0,30}?(\d{1,2},\d{3})",
        "silver": r"silver\s*1\s*gm\D{0,20}?(\d{2,3}(?:\.\d{2})?)",
    }
    for key, pattern in patterns.items():
        if data[key] is None:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                data[key] = float(match.group(1).replace(",", ""))


def _parse_price(text):
    """Extract numeric price from text like '13,620' or '250.00 (0.00)'."""
    text = text.split("(")[0].strip()
    cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _current_slot():
    hour = datetime.now(IST).hour
    if hour < 12:
        return "morning"
    elif hour < 15:
        return "afternoon"
    return "evening"
