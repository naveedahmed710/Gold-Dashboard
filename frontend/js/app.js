/* ================================================================
   Gold & Silver Dashboard — Client
   ================================================================ */

const API = window.location.origin;
let goldChart = null;
let silverChart = null;
let currentRange = "week";

/* ---------- Security: HTML escaping ---------- */
function esc(str) {
  const el = document.createElement("span");
  el.textContent = String(str);
  return el.innerHTML;
}

/* ---------- Theme ---------- */
const root = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const savedTheme = localStorage.getItem("gs-theme") || "dark";
root.setAttribute("data-theme", savedTheme);

themeToggle.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  localStorage.setItem("gs-theme", next);
  updateChartTheme();
});

/* ---------- Toast ---------- */
const toastEl = document.getElementById("toast");
let toastTimer = null;

function showToast(msg, durationMs = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), durationMs);
}

/* ---------- Filter Buttons ---------- */
const customRangeEl = document.getElementById("customRange");

document.querySelectorAll(".btn-group .btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".btn-group .btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;

    if (currentRange === "custom") {
      customRangeEl.classList.add("visible");
    } else {
      customRangeEl.classList.remove("visible");
      fetchPrices();
    }
  });
});

document.getElementById("applyCustom").addEventListener("click", () => {
  const s = document.getElementById("startDate").value;
  const e = document.getElementById("endDate").value;
  if (!s || !e) {
    showToast("Please select both start and end dates");
    return;
  }
  if (s > e) {
    showToast("Start date must be before end date");
    return;
  }
  fetchPrices();
});

/* ---------- Refresh Button ---------- */
const refreshBtn = document.getElementById("refresh-btn");
refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  try {
    const res = await fetch(`${API}/api/scrape-now`, { method: "POST" });
    if (res.ok) {
      showToast("Prices refreshed successfully");
      await Promise.all([fetchLatest(), fetchPrices()]);
    } else {
      showToast("Refresh failed — try again");
    }
  } catch (err) {
    showToast("Network error — check if server is running");
  } finally {
    refreshBtn.classList.remove("spinning");
  }
});

/* ---------- Fetch Latest Prices ---------- */
async function fetchLatest() {
  try {
    const res = await fetch(`${API}/api/latest`);
    const d = await res.json();
    if (d.error) return;

    animateValue("gold22k", d.gold_22k);
    animateValue("gold24k", d.gold_24k);
    animateValue("silver", d.silver);

    document.getElementById("lastUpdated").textContent =
      `Last updated: ${formatDate(d.date)} \u2022 ${capitalize(d.time_slot)}`;
  } catch (e) {
    console.error("Failed to fetch latest:", e);
  }
}

function animateValue(elId, value) {
  const el = document.getElementById(elId);
  if (value == null) {
    el.textContent = "--";
    return;
  }
  const formatted = "\u20B9" + Number(value).toLocaleString("en-IN");
  el.textContent = formatted;
  el.style.transform = "scale(1.08)";
  el.style.transition = "transform 0.3s ease";
  setTimeout(() => (el.style.transform = "scale(1)"), 300);
}

function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* ---------- Fetch Historical Prices ---------- */
async function fetchPrices() {
  let url = `${API}/api/prices?range=${currentRange}`;
  if (currentRange === "custom") {
    const s = document.getElementById("startDate").value;
    const e = document.getElementById("endDate").value;
    if (!s || !e) return;
    url += `&start=${s}&end=${e}`;
  }

  try {
    const res = await fetch(url);
    const data = await res.json();
    renderCharts(data);
    renderTable(data);
  } catch (e) {
    console.error("Failed to fetch prices:", e);
    showToast("Failed to load price history");
  }
}

/* ---------- Chart Colors ---------- */
function getColors() {
  const s = getComputedStyle(root);
  const g = (v) => s.getPropertyValue(v).trim();
  return {
    gold:        g("--chart-gold"),
    goldFill:    g("--chart-gold-fill"),
    gold24:      g("--chart-gold24"),
    gold24Fill:  g("--chart-gold24-fill"),
    silver:      g("--chart-silver"),
    silverFill:  g("--chart-silver-fill"),
    grid:        g("--chart-grid"),
    text:        g("--text-muted"),
  };
}

function baseOptions(c) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.75)",
        titleColor: "#fff",
        bodyColor: "#ddd",
        cornerRadius: 10,
        padding: 10,
        displayColors: true,
        callbacks: {
          label: (ctx) => ` ${ctx.dataset.label}: \u20B9${Number(ctx.raw).toLocaleString("en-IN")}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: c.text, maxRotation: 50, font: { size: 11 } },
        grid: { color: c.grid, drawBorder: false },
      },
      y: {
        ticks: {
          color: c.text,
          font: { size: 11 },
          callback: (v) => "\u20B9" + Number(v).toLocaleString("en-IN"),
        },
        grid: { color: c.grid, drawBorder: false },
      },
    },
  };
}

function datasetStyle(borderColor, fillColor, dashed) {
  return {
    borderColor,
    backgroundColor: fillColor,
    fill: true,
    tension: 0.4,
    pointRadius: 4,
    pointHoverRadius: 6,
    pointBackgroundColor: borderColor,
    pointBorderColor: "transparent",
    borderWidth: 2.5,
    borderDash: dashed ? [6, 4] : [],
  };
}

/* ---------- Render Charts ---------- */
function renderCharts(data) {
  const c = getColors();
  const labels = data.map((d) => shortLabel(d.date, d.time_slot));

  if (goldChart) goldChart.destroy();
  if (silverChart) silverChart.destroy();

  const goldCtx = document.getElementById("goldChart").getContext("2d");
  goldChart = new Chart(goldCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "22K Gold",
          data: data.map((d) => d.gold_22k),
          ...datasetStyle(c.gold, c.goldFill, false),
        },
        {
          label: "24K Gold",
          data: data.map((d) => d.gold_24k),
          ...datasetStyle(c.gold24, c.gold24Fill, true),
        },
      ],
    },
    options: {
      ...baseOptions(c),
      plugins: {
        ...baseOptions(c).plugins,
        legend: {
          display: true,
          labels: { color: c.text, usePointStyle: true, pointStyle: "circle", padding: 16 },
        },
      },
    },
  });

  const silverCtx = document.getElementById("silverChart").getContext("2d");
  silverChart = new Chart(silverCtx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Silver",
          data: data.map((d) => d.silver),
          ...datasetStyle(c.silver, c.silverFill, false),
        },
      ],
    },
    options: baseOptions(c),
  });
}

function shortLabel(date, slot) {
  const d = new Date(date + "T00:00:00");
  const day = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const slotMap = { morning: "10a", afternoon: "1p", evening: "5p" };
  return `${day} ${slotMap[slot] || slot}`;
}

/* ---------- Update Chart Theme ---------- */
function updateChartTheme() {
  const c = getColors();

  [goldChart, silverChart].forEach((chart) => {
    if (!chart) return;
    chart.options.scales.x.ticks.color = c.text;
    chart.options.scales.y.ticks.color = c.text;
    chart.options.scales.x.grid.color = c.grid;
    chart.options.scales.y.grid.color = c.grid;
  });

  if (goldChart) {
    goldChart.data.datasets[0].borderColor = c.gold;
    goldChart.data.datasets[0].backgroundColor = c.goldFill;
    goldChart.data.datasets[0].pointBackgroundColor = c.gold;
    if (goldChart.data.datasets[1]) {
      goldChart.data.datasets[1].borderColor = c.gold24;
      goldChart.data.datasets[1].backgroundColor = c.gold24Fill;
      goldChart.data.datasets[1].pointBackgroundColor = c.gold24;
    }
    if (goldChart.options.plugins.legend) {
      goldChart.options.plugins.legend.labels.color = c.text;
    }
    goldChart.update("none");
  }

  if (silverChart) {
    silverChart.data.datasets[0].borderColor = c.silver;
    silverChart.data.datasets[0].backgroundColor = c.silverFill;
    silverChart.data.datasets[0].pointBackgroundColor = c.silver;
    silverChart.update("none");
  }
}

/* ---------- Render Table ---------- */
function renderTable(data) {
  const tbody = document.querySelector("#priceTable tbody");
  const emptyState = document.getElementById("emptyState");

  if (!data.length) {
    tbody.innerHTML = "";
    emptyState.classList.add("visible");
    return;
  }

  emptyState.classList.remove("visible");
  const slotMap = { morning: "10:00 AM", afternoon: "1:00 PM", evening: "5:00 PM" };

  tbody.innerHTML = data
    .slice()
    .reverse()
    .map(
      (d) => `<tr>
        <td>${esc(formatDate(d.date))}</td>
        <td>${esc(slotMap[d.time_slot] || d.time_slot)}</td>
        <td>${d.gold_22k != null ? "\u20B9" + esc(Number(d.gold_22k).toLocaleString("en-IN")) : "--"}</td>
        <td>${d.gold_24k != null ? "\u20B9" + esc(Number(d.gold_24k).toLocaleString("en-IN")) : "--"}</td>
        <td>${d.silver != null ? "\u20B9" + esc(Number(d.silver).toLocaleString("en-IN")) : "--"}</td>
      </tr>`
    )
    .join("");
}

/* ---------- Init ---------- */
fetchLatest();
fetchPrices();

setInterval(fetchLatest, 5 * 60 * 1000);
