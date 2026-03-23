/* ================================================================
   Gold & Silver Dashboard — Client v1.1
   ================================================================ */

const API = window.location.origin;
let goldChart = null;
let silverChart = null;
let currentRange = "week";
let goldChartType = "line";
let silverChartType = "line";
let lastPricesData = [];
let previousValues = { gold22k: null, gold24k: null, silver: null };

/* ---------- Security ---------- */
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
  renderSparklines(lastPricesData);
});

/* ---------- Toast ---------- */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("visible"), ms);
}

/* ---------- Filters (with Today button) ---------- */
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
  if (!s || !e) { showToast("Please select both start and end dates"); return; }
  if (s > e) { showToast("Start date must be before end date"); return; }
  fetchPrices();
});

/* ---------- Chart Type Toggles ---------- */
document.querySelectorAll(".chart-type-toggle").forEach((group) => {
  group.querySelectorAll(".chart-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      group.querySelectorAll(".chart-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const target = group.dataset.target;
      const type = btn.dataset.type;
      if (target === "gold") goldChartType = type;
      else silverChartType = type;
      if (lastPricesData.length) renderCharts(lastPricesData);
    });
  });
});

/* ---------- Refresh ---------- */
const refreshBtn = document.getElementById("refresh-btn");
refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  try {
    const res = await fetch(`${API}/api/scrape-now`, { method: "POST" });
    if (res.ok) {
      showToast("Prices refreshed successfully");
      await Promise.all([fetchLatest(), fetchPrices(), fetchStats()]);
    } else {
      showToast("Refresh failed \u2014 try again");
    }
  } catch (_) {
    showToast("Network error \u2014 check if server is running");
  } finally {
    refreshBtn.classList.remove("spinning");
  }
});

/* ---------- Animated Counter ---------- */
function countUp(el, from, to, duration) {
  const start = performance.now();
  const diff = to - from;
  if (Math.abs(diff) < 0.01) { el.textContent = "\u20B9" + to.toLocaleString("en-IN"); return; }

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = from + diff * ease;
    el.textContent = "\u20B9" + Number(current.toFixed(2)).toLocaleString("en-IN");
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- Fetch Latest ---------- */
async function fetchLatest() {
  try {
    const res = await fetch(`${API}/api/latest`);
    const d = await res.json();
    if (d.error) return;

    removeSkeleton("card-gold22k");
    removeSkeleton("card-gold24k");
    removeSkeleton("card-silver");

    updateCard("gold22k", d.gold_22k);
    updateCard("gold24k", d.gold_24k);
    updateCard("silver", d.silver);

    document.getElementById("lastUpdated").textContent =
      `Last updated: ${formatDate(d.date)} \u2022 ${capitalize(d.time_slot)}`;
  } catch (e) {
    console.error("Failed to fetch latest:", e);
  }
}

function updateCard(key, value) {
  const el = document.getElementById(key);
  if (value == null) { el.textContent = "--"; return; }
  const prev = previousValues[key];
  if (prev != null && prev !== value) {
    countUp(el, prev, value, 600);
  } else {
    el.textContent = "\u20B9" + Number(value).toLocaleString("en-IN");
  }
  previousValues[key] = value;
}

function removeSkeleton(cardId) {
  const card = document.getElementById(cardId);
  if (card) card.classList.remove("skeleton-card");
}

/* ---------- Price Deltas ---------- */
function findLastChanged(data, key) {
  const latest = data[data.length - 1];
  if (latest[key] == null) return null;
  for (let i = data.length - 2; i >= 0; i--) {
    if (data[i][key] != null && data[i][key] !== latest[key]) return data[i];
  }
  return null;
}

function updateDeltas(data) {
  if (data.length < 2) {
    ["delta-gold22k", "delta-gold24k", "delta-silver"].forEach((id) => {
      document.getElementById(id).className = "card-delta";
      document.getElementById(id).textContent = "";
    });
    return;
  }
  const latest = data[data.length - 1];

  const refGold22k = findLastChanged(data, "gold_22k");
  const refGold24k = findLastChanged(data, "gold_24k");
  const refSilver = findLastChanged(data, "silver");

  setDelta("delta-gold22k", latest.gold_22k, refGold22k ? refGold22k.gold_22k : null);
  setDelta("delta-gold24k", latest.gold_24k, refGold24k ? refGold24k.gold_24k : null);
  setDelta("delta-silver", latest.silver, refSilver ? refSilver.silver : null);
}

function setDelta(elId, current, previous) {
  const el = document.getElementById(elId);
  if (current == null || previous == null || previous === 0) {
    el.className = "card-delta";
    el.textContent = "";
    return;
  }
  const diff = current - previous;
  const pct = ((diff / previous) * 100).toFixed(1);
  const arrow = diff > 0 ? "\u25B2" : diff < 0 ? "\u25BC" : "\u25CF";
  const cls = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const sign = diff > 0 ? "+" : "";
  el.className = `card-delta ${cls}`;
  el.textContent = `${arrow} ${sign}${Number(diff.toFixed(2)).toLocaleString("en-IN")} (${sign}${pct}%)`;
}

/* ---------- Sparklines ---------- */
function renderSparklines(data) {
  if (!data.length) return;
  const slice = data.slice(-7);
  drawSparkline("spark-gold22k", slice.map((d) => d.gold_22k), "--chart-gold");
  drawSparkline("spark-gold24k", slice.map((d) => d.gold_24k), "--chart-gold24");
  drawSparkline("spark-silver", slice.map((d) => d.silver), "--chart-silver");
}

function drawSparkline(canvasId, values, colorVar) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const color = getComputedStyle(root).getPropertyValue(colorVar).trim();

  const nums = values.filter((v) => v != null);
  if (nums.length < 2) return;

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const step = w / (nums.length - 1);

  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  nums.forEach((v, i) => {
    const x = i * step;
    const y = h - 3 - ((v - min) / range) * (h - 6);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color.replace(")", ", 0.15)").replace("rgb", "rgba"));
  grad.addColorStop(1, "transparent");
  ctx.lineTo((nums.length - 1) * step, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

/* ---------- Fetch Prices ---------- */
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
    lastPricesData = data;
    renderCharts(data);
    renderTable(data);
    updateDeltas(data);
    renderSparklines(data);
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
    gold: g("--chart-gold"), goldFill: g("--chart-gold-fill"),
    gold24: g("--chart-gold24"), gold24Fill: g("--chart-gold24-fill"),
    silver: g("--chart-silver"), silverFill: g("--chart-silver-fill"),
    grid: g("--chart-grid"), text: g("--text-muted"),
  };
}

function baseOptions(c) {
  return {
    responsive: true, maintainAspectRatio: true,
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(0,0,0,0.75)", titleColor: "#fff", bodyColor: "#ddd",
        cornerRadius: 10, padding: 10, displayColors: true,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: \u20B9${Number(ctx.raw).toLocaleString("en-IN")}` },
      },
    },
    scales: {
      x: { ticks: { color: c.text, maxRotation: 50, font: { size: 11 } }, grid: { color: c.grid, drawBorder: false } },
      y: { ticks: { color: c.text, font: { size: 11 }, callback: (v) => "\u20B9" + Number(v).toLocaleString("en-IN") }, grid: { color: c.grid, drawBorder: false } },
    },
  };
}

function datasetStyle(borderColor, fillColor, dashed, chartType) {
  const isBar = chartType === "bar";
  return {
    borderColor,
    backgroundColor: isBar ? borderColor + "44" : fillColor,
    fill: !isBar,
    tension: isBar ? 0 : 0.4,
    pointRadius: isBar ? 0 : 4,
    pointHoverRadius: isBar ? 0 : 6,
    pointBackgroundColor: borderColor,
    pointBorderColor: "transparent",
    borderWidth: isBar ? 0 : 2.5,
    borderDash: dashed && !isBar ? [6, 4] : [],
    borderRadius: isBar ? 6 : 0,
    barPercentage: 0.7,
  };
}

/* ---------- Render Charts ---------- */
function renderCharts(data) {
  const c = getColors();
  const labels = data.map((d) => shortLabel(d.date, d.time_slot));

  if (goldChart) goldChart.destroy();
  if (silverChart) silverChart.destroy();

  goldChart = new Chart(document.getElementById("goldChart").getContext("2d"), {
    type: goldChartType,
    data: {
      labels,
      datasets: [
        { label: "22K Gold", data: data.map((d) => d.gold_22k), ...datasetStyle(c.gold, c.goldFill, false, goldChartType) },
        { label: "24K Gold", data: data.map((d) => d.gold_24k), ...datasetStyle(c.gold24, c.gold24Fill, true, goldChartType) },
      ],
    },
    options: {
      ...baseOptions(c),
      plugins: {
        ...baseOptions(c).plugins,
        legend: { display: true, labels: { color: c.text, usePointStyle: true, pointStyle: "circle", padding: 16 } },
      },
    },
  });

  silverChart = new Chart(document.getElementById("silverChart").getContext("2d"), {
    type: silverChartType,
    data: {
      labels,
      datasets: [{ label: "Silver", data: data.map((d) => d.silver), ...datasetStyle(c.silver, c.silverFill, false, silverChartType) }],
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

/* ---------- Theme Update ---------- */
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
    goldChart.data.datasets[0].backgroundColor = goldChartType === "bar" ? c.gold + "44" : c.goldFill;
    goldChart.data.datasets[0].pointBackgroundColor = c.gold;
    if (goldChart.data.datasets[1]) {
      goldChart.data.datasets[1].borderColor = c.gold24;
      goldChart.data.datasets[1].backgroundColor = goldChartType === "bar" ? c.gold24 + "44" : c.gold24Fill;
      goldChart.data.datasets[1].pointBackgroundColor = c.gold24;
    }
    if (goldChart.options.plugins.legend) goldChart.options.plugins.legend.labels.color = c.text;
    goldChart.update("none");
  }
  if (silverChart) {
    silverChart.data.datasets[0].borderColor = c.silver;
    silverChart.data.datasets[0].backgroundColor = silverChartType === "bar" ? c.silver + "44" : c.silverFill;
    silverChart.data.datasets[0].pointBackgroundColor = c.silver;
    silverChart.update("none");
  }
}

/* ---------- Table with Row Highlights ---------- */
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
  const THRESHOLD = 0.015;

  const reversed = data.slice().reverse();
  tbody.innerHTML = reversed.map((d, i) => {
    let rowClass = "";
    const prev = reversed[i + 1];
    if (prev && d.gold_22k != null && prev.gold_22k != null && prev.gold_22k !== 0) {
      const pctChange = (d.gold_22k - prev.gold_22k) / prev.gold_22k;
      if (pctChange > THRESHOLD) rowClass = "row-up";
      else if (pctChange < -THRESHOLD) rowClass = "row-down";
    }
    return `<tr class="${rowClass}">
      <td>${esc(formatDate(d.date))}</td>
      <td>${esc(slotMap[d.time_slot] || d.time_slot)}</td>
      <td>${d.gold_22k != null ? "\u20B9" + esc(Number(d.gold_22k).toLocaleString("en-IN")) : "--"}</td>
      <td>${d.gold_24k != null ? "\u20B9" + esc(Number(d.gold_24k).toLocaleString("en-IN")) : "--"}</td>
      <td>${d.silver != null ? "\u20B9" + esc(Number(d.silver).toLocaleString("en-IN")) : "--"}</td>
    </tr>`;
  }).join("");
}

/* ---------- Footer Stats ---------- */
async function fetchStats() {
  try {
    const res = await fetch(`${API}/api/stats`);
    const d = await res.json();
    document.getElementById("footer-next").textContent = `Next update: ${d.next_update}`;
    document.getElementById("footer-records").textContent = `${d.total_records} records`;
  } catch (_) {}
}

/* ---------- Helpers ---------- */
function formatDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

/* ---------- Init ---------- */
fetchLatest();
fetchPrices();
fetchStats();

setInterval(() => { fetchLatest(); fetchStats(); }, 5 * 60 * 1000);
