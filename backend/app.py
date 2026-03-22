import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from functools import wraps

import pytz
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from database import init_db, query_prices, get_latest, count_rows
from scheduler import start_scheduler, fetch_and_store, backfill_history

FRONTEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
)

app = Flask(__name__, static_folder=None)

CORS(app, resources={r"/api/*": {"origins": ["http://localhost:5000", "http://127.0.0.1:5000"]}})

IST = pytz.timezone("Asia/Kolkata")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_RANGE_DAYS = 365


# ── Security middleware ────────────────────────────────────────────

@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' https://cdn.jsdelivr.net; "
        "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; "
        "font-src 'self' https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self'"
    )
    return response


# ── Rate limiting (in-memory, per-IP) ─────────────────────────────

_rate_buckets = defaultdict(list)
RATE_LIMIT = 30          # requests
RATE_WINDOW = 60          # seconds


def rate_limit(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        ip = request.remote_addr or "unknown"
        now = time.time()
        bucket = _rate_buckets[ip]
        _rate_buckets[ip] = [t for t in bucket if now - t < RATE_WINDOW]
        if len(_rate_buckets[ip]) >= RATE_LIMIT:
            return jsonify({"error": "Rate limit exceeded. Try again later."}), 429
        _rate_buckets[ip].append(now)
        return f(*args, **kwargs)
    return decorated


# ── Input validation ──────────────────────────────────────────────

def _validate_date(value):
    if not value or not DATE_RE.match(value):
        return None
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return value
    except ValueError:
        return None


def _safe_path(filename):
    """Prevent path traversal by resolving and checking the path stays within FRONTEND_DIR."""
    safe = os.path.normpath(os.path.join(FRONTEND_DIR, filename))
    if not safe.startswith(FRONTEND_DIR):
        abort(403)
    return safe


# ── Routes ────────────────────────────────────────────────────────

@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/css/<path:filename>")
def serve_css(filename):
    _safe_path(os.path.join("css", filename))
    return send_from_directory(os.path.join(FRONTEND_DIR, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    _safe_path(os.path.join("js", filename))
    return send_from_directory(os.path.join(FRONTEND_DIR, "js"), filename)


@app.route("/api/latest")
@rate_limit
def api_latest():
    data = get_latest()
    return jsonify(data or {"error": "No data available yet"})


@app.route("/api/prices")
@rate_limit
def api_prices():
    range_type = request.args.get("range", "week")
    start = request.args.get("start")
    end = request.args.get("end")
    today = datetime.now(IST).date()

    if range_type == "today":
        start_date = today.isoformat()
        end_date = today.isoformat()
    elif range_type == "week":
        start_date = (today - timedelta(days=7)).isoformat()
        end_date = today.isoformat()
    elif range_type == "month":
        start_date = (today - timedelta(days=30)).isoformat()
        end_date = today.isoformat()
    elif range_type == "custom":
        start_date = _validate_date(start)
        end_date = _validate_date(end)
        if not start_date or not end_date:
            return jsonify({"error": "Invalid date format. Use YYYY-MM-DD."}), 400
        d_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        d_end = datetime.strptime(end_date, "%Y-%m-%d").date()
        if d_start > d_end:
            return jsonify({"error": "Start date must be before end date."}), 400
        if (d_end - d_start).days > MAX_RANGE_DAYS:
            return jsonify({"error": f"Range cannot exceed {MAX_RANGE_DAYS} days."}), 400
    else:
        start_date = (today - timedelta(days=7)).isoformat()
        end_date = today.isoformat()

    data = query_prices(start_date, end_date)
    return jsonify(data)


@app.route("/api/stats")
@rate_limit
def api_stats():
    total = count_rows()
    now = datetime.now(IST)
    hour = now.hour
    if hour < 10:
        next_slot = now.replace(hour=10, minute=0, second=0, microsecond=0)
    elif hour < 13:
        next_slot = now.replace(hour=13, minute=0, second=0, microsecond=0)
    elif hour < 17:
        next_slot = now.replace(hour=17, minute=0, second=0, microsecond=0)
    else:
        next_slot = (now + timedelta(days=1)).replace(hour=10, minute=0, second=0, microsecond=0)
    return jsonify({
        "total_records": total,
        "next_update": next_slot.strftime("%I:%M %p IST"),
    })


@app.route("/api/scrape-now", methods=["POST"])
@rate_limit
def api_scrape_now():
    """Manual trigger for testing / on-demand refresh."""
    fetch_and_store()
    latest = get_latest()
    return jsonify({"status": "ok", "latest": latest})


# ── Startup ───────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    scheduler = start_scheduler()
    print("Scheduler running \u2014 jobs at 10:00 AM, 1:00 PM, 5:00 PM IST")

    row_count = count_rows()
    if row_count <= 1:
        print("Backfilling historical data from site...")
        backfill_history()

    if not get_latest():
        print("No data in DB \u2014 running initial scrape...")
        fetch_and_store()

    app.run(host="127.0.0.1", port=5000, debug=False)
