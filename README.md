# Gold & Silver Price Dashboard

A real-time dashboard that tracks gold (22K, 24K) and silver prices, stores them in SQLite, and displays interactive charts and tables with a glassmorphism UI.

---

## Features

| Feature | Description |
|---------|-------------|
| **Live price cards** | Current Gold 22K, Gold 24K, and Silver prices per gram |
| **Historical backfill** | Automatically imports ~10 days of historical data from the website on first run |
| **Scheduled scraping** | APScheduler fetches prices daily at **10:00 AM**, **1:00 PM**, and **5:00 PM IST** |
| **Interactive charts** | Chart.js line charts with 22K/24K gold overlay and separate silver chart |
| **Date filters** | Week, Month, and Custom date range selectors |
| **Dark / Light mode** | Toggle with `localStorage` persistence |
| **Glassmorphism UI** | Frosted glass cards, animated gradient blobs, shimmer effects |
| **Responsive design** | Adapts to desktop, tablet, and mobile (breakpoints at 900px, 768px, 480px) |
| **Manual refresh** | One-click button to trigger an immediate scrape |
| **Toast notifications** | User feedback for refresh, validation, and error states |

---

## Tech Stack & Versions

| Component | Version |
|-----------|---------|
| Python | 3.12.10 |
| SQLite | 3.49.1 (driver 2.6.0) |
| Flask | 3.1.3 |
| Flask-CORS | 6.0.2 |
| Requests | 2.32.5 |
| BeautifulSoup4 | 4.14.3 |
| APScheduler | 3.11.2 |
| pytz | 2026.1.post1 |
| Chart.js (CDN) | 4.x |
| chartjs-adapter-date-fns (CDN) | 3.x |
| Font | Inter (Google Fonts) |

---

## Project Structure

```
GD/
├── backend/
│   ├── app.py              # Flask server — API + static file serving
│   ├── scraper.py          # Web scraper with history backfill support
│   ├── scheduler.py        # APScheduler cron jobs (10am, 1pm, 5pm IST)
│   ├── database.py         # SQLite ORM — init, insert, query, bulk ops
│   └── requirements.txt    # Pinned Python dependencies
├── frontend/
│   ├── index.html          # Dashboard SPA
│   ├── css/
│   │   └── styles.css      # Glassmorphism + dark/light CSS variables
│   └── js/
│       └── app.js          # Chart.js rendering, filters, theme toggle
├── data/
│   └── prices.db           # SQLite database (auto-created on first run)
└── README.md
```

---

## Getting Started

### Prerequisites

- **Python 3.10+** installed (tested with 3.12.10)
- Internet connection (to fetch live price data and load CDN assets)

### Installation

```bash
# Clone or navigate to the project directory
cd GD

# Install Python dependencies
pip install -r backend/requirements.txt
```

### Running the Dashboard

```bash
cd backend
python app.py
```

Open your browser to **http://127.0.0.1:5000**

On first startup the server will:
1. Initialize the SQLite database
2. Backfill ~10 days of historical gold and silver prices from the website
3. Start the background scheduler for automatic daily updates
4. Begin serving the dashboard

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve the dashboard frontend |
| `GET` | `/api/latest` | Get the most recent price record |
| `GET` | `/api/prices?range=week` | Get prices for the last 7 days |
| `GET` | `/api/prices?range=month` | Get prices for the last 30 days |
| `GET` | `/api/prices?range=custom&start=YYYY-MM-DD&end=YYYY-MM-DD` | Custom date range (max 365 days) |
| `POST` | `/api/scrape-now` | Trigger an immediate scrape and store |

---

## Database Schema

```sql
CREATE TABLE prices (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,           -- YYYY-MM-DD
    timestamp TEXT NOT NULL,           -- ISO 8601 with timezone
    time_slot TEXT NOT NULL,           -- 'morning' | 'afternoon' | 'evening'
    gold_22k  REAL,                    -- price per gram in INR
    gold_24k  REAL,                    -- price per gram in INR
    silver    REAL,                    -- price per gram in INR
    UNIQUE(date, time_slot)
);
```

The `UNIQUE(date, time_slot)` constraint prevents duplicate entries. `INSERT OR REPLACE` is used for scheduled updates and `INSERT OR IGNORE` for historical backfill to avoid overwriting fresher data.

---

## Scraping Strategy

The data source page contains four HTML tables:

| Table | Content | Columns |
|-------|---------|---------|
| 0 | Today's summary | Date, 22K per gram, Silver per gram |
| 1 | Gold history (~10 days) | Date, 24K/gm, 24K/8gm, 22K/gm, 22K/8gm |
| 2 | Navigation links | (skipped) |
| 3 | Silver history (~10 days) | Date, Silver/gm, Silver/kg |

The scraper uses a **three-tier parsing strategy**:
1. **Targeted table parsing** — matches tables by header text
2. **Element-level fallback** — scans spans/divs when tables are restructured
3. **Regex fallback** — extracts prices from raw page text

Date format on the source (`DD/Mon/YYYY`, e.g., `22/Mar/2026`) is converted to ISO `YYYY-MM-DD` for consistent storage.

---

## Security Measures

### Backend

| Protection | Implementation |
|------------|----------------|
| **Security headers** | `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Content-Security-Policy` |
| **Rate limiting** | In-memory per-IP limit: 30 requests per 60 seconds on API endpoints |
| **Input validation** | Date parameters validated with regex + `datetime.strptime` before any DB query |
| **Range capping** | Custom date ranges capped at 365 days to prevent resource exhaustion |
| **Path traversal prevention** | Static file paths normalized and checked to stay within `frontend/` |
| **Parameterized queries** | All SQLite queries use parameter binding — no string interpolation |
| **CORS restriction** | API access restricted to `localhost:5000` / `127.0.0.1:5000` origins |
| **Bind to localhost** | Server binds to `127.0.0.1` (not `0.0.0.0`) to prevent external access |
| **WAL mode** | SQLite uses Write-Ahead Logging for safe concurrent reads during writes |
| **Connection timeout** | SQLite connections use a 10-second timeout to prevent deadlocks |

### Frontend

| Protection | Implementation |
|------------|----------------|
| **XSS prevention** | All dynamic table content passed through `esc()` HTML-escaping function |
| **Subresource Integrity** | CDN scripts (`chart.js`, `chartjs-adapter-date-fns`) use SRI `integrity` hashes |
| **CSP meta** | Content Security Policy headers restrict script and style sources |

---

## Scheduling Details

| Time (IST) | Slot Label | Cron Expression |
|------------|------------|-----------------|
| 10:00 AM | `morning` | `0 10 * * *` |
| 1:00 PM | `afternoon` | `0 13 * * *` |
| 5:00 PM | `evening` | `0 17 * * *` |

The scheduler runs in a background thread via APScheduler's `BackgroundScheduler`. Jobs persist across the server process lifetime. If the server is restarted, historical data is preserved in SQLite and only missing rows are backfilled.

---

## Responsive Breakpoints

| Breakpoint | Layout Changes |
|------------|---------------|
| > 900px | 2-column chart grid, 3-column price cards |
| 768px | 1-column charts, 2-column cards, stacked filters |
| 480px | 1-column everything, compact header |

---

## License

This project is for personal/educational use.
