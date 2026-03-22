import pytz
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from scraper import scrape_prices, scrape_history
from database import insert_price, insert_prices_bulk

IST = pytz.timezone("Asia/Kolkata")


def fetch_and_store():
    """Scrape today's prices and persist to SQLite."""
    try:
        data = scrape_prices()
        if data.get("gold_22k") or data.get("silver"):
            insert_price(data)
            print(f"[OK] Stored prices at {data['timestamp']}")
        else:
            print(f"[WARN] No prices extracted at {data['timestamp']}")
    except Exception as e:
        print(f"[ERR] Scrape failed: {e}")


def backfill_history():
    """Scrape historical data from the site and bulk-insert into DB."""
    try:
        rows = scrape_history()
        if rows:
            insert_prices_bulk(rows)
            print(f"[OK] Backfilled {len(rows)} historical rows")
        else:
            print("[WARN] No historical rows found")
    except Exception as e:
        print(f"[ERR] History backfill failed: {e}")


def start_scheduler():
    scheduler = BackgroundScheduler(timezone=IST)
    scheduler.add_job(
        fetch_and_store,
        CronTrigger(hour=10, minute=0, timezone=IST),
        id="morning",
    )
    scheduler.add_job(
        fetch_and_store,
        CronTrigger(hour=13, minute=0, timezone=IST),
        id="afternoon",
    )
    scheduler.add_job(
        fetch_and_store,
        CronTrigger(hour=17, minute=0, timezone=IST),
        id="evening",
    )
    scheduler.start()
    return scheduler
