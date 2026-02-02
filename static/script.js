let onsChart = null;
let usdChart = null;
let us10yChart = null;
let gramChart = null;
let arbitrageChart = null;
let currentRange = "daily";
let lastRenderedRange = "daily";

const CHART_PALETTE = {
  ons: { pos: "#16c784", neg: "#ef4444", neu: "#f5c451" },
  usd: { pos: "#22c55e", neg: "#f87171", neu: "#fbbf24" },
  us10y: { pos: "#10b981", neg: "#dc2626", neu: "#f59e0b" },
  gram: { pos: "#34d399", neg: "#f87171", neu: "#fbbf24" },
  arbitrage: { pos: "#14b8a6", neg: "#ef4444", neu: "#f59e0b" },
};

const LABEL_FONT = "13px \"IBM Plex Mono\", monospace";
const LABEL_TEXT_COLOR = "#c9d1d9";
const LABEL_BG_COLOR = "rgba(13, 17, 23, 0.85)";
const LABEL_BORDER_COLOR = "rgba(48, 54, 61, 0.9)";
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;
const GRID_COLOR = "rgba(148, 163, 184, 0.12)";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`;
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function makeGradientFill(color) {
  return (context) => {
    const { chart } = context;
    const { ctx, chartArea } = chart;
    if (!chartArea) {
      return hexToRgba(color, 0.08);
    }
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, hexToRgba(color, 0.28));
    gradient.addColorStop(1, hexToRgba(color, 0.02));
    return gradient;
  };
}

function formatChartValue(value) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(2);
}

function drawEdgeLabel(ctx, chartArea, x, y, text, position) {
  if (!text) return;
  ctx.save();
  ctx.font = LABEL_FONT;
  const textWidth = ctx.measureText(text).width;
  const textHeight = 11;

  const safeX = clamp(
    x,
    chartArea.left + LABEL_PADDING_X + textWidth / 2,
    chartArea.right - LABEL_PADDING_X - textWidth / 2
  );

  const boxWidth = textWidth + LABEL_PADDING_X * 2;
  const boxHeight = textHeight + LABEL_PADDING_Y * 2;
  const boxY =
    position === "top"
      ? chartArea.top + 2
      : chartArea.bottom - boxHeight - 2;
  const boxX = safeX - boxWidth / 2;

  ctx.fillStyle = LABEL_BG_COLOR;
  ctx.strokeStyle = LABEL_BORDER_COLOR;
  ctx.lineWidth = 1;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  ctx.fillStyle = LABEL_TEXT_COLOR;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(text, safeX, boxY + LABEL_PADDING_Y);
  ctx.restore();
}

const MIN_MAX_LABEL_PLUGIN = {
  id: "minMaxLabel",
  afterDatasetsDraw(chart, _args, opts) {
    if (opts && opts.enabled === false) return;
    const dataset = chart.data?.datasets?.[0];
    if (!dataset || !Array.isArray(dataset.data) || dataset.data.length === 0) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data || meta.data.length === 0) return;
    const { chartArea, ctx } = chart;
    if (!chartArea) return;

    let minValue = Infinity;
    let maxValue = -Infinity;
    let minIndex = -1;
    let maxIndex = -1;

    dataset.data.forEach((raw, i) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      if (value < minValue) {
        minValue = value;
        minIndex = i;
      }
      if (value > maxValue) {
        maxValue = value;
        maxIndex = i;
      }
    });

    if (minIndex === -1 || maxIndex === -1) return;

    const maxPoint = meta.data[maxIndex];
    if (maxPoint) {
      const { x } = maxPoint.getProps ? maxPoint.getProps(["x"], true) : maxPoint;
      drawEdgeLabel(ctx, chartArea, x, chartArea.top, formatChartValue(maxValue), "top");
    }

    if (minIndex !== maxIndex) {
      const minPoint = meta.data[minIndex];
      if (minPoint) {
        const { x } = minPoint.getProps ? minPoint.getProps(["x"], true) : minPoint;
        drawEdgeLabel(ctx, chartArea, x, chartArea.bottom, formatChartValue(minValue), "bottom");
      }
    }
  },
};

if (window.Chart && window.Chart.register) {
  window.Chart.register(MIN_MAX_LABEL_PLUGIN);
}

function trendColor(values, palette) {
  const pal = palette || CHART_PALETTE.ons;
  if (!Array.isArray(values) || values.length < 2) return pal.neu;
  const first = values[0];
  const last = values[values.length - 1];
  if (last > first) return pal.pos;
  if (last < first) return pal.neg;
  return pal.neu;
}

function renderChart(chartInstance, ctx, labels, values, color) {
  if (!ctx || !window.Chart) return chartInstance;
  if (chartInstance) {
    chartInstance.data.labels = labels || [];
    chartInstance.data.datasets[0].data = values || [];
    chartInstance.data.datasets[0].borderColor = color;
    chartInstance.data.datasets[0].backgroundColor = makeGradientFill(color);
    chartInstance.data.datasets[0].fill = true;
    chartInstance.data.datasets[0].tension = 0.35;
    chartInstance.data.datasets[0].cubicInterpolationMode = "monotone";
    chartInstance.data.datasets[0].pointRadius = 0;
    chartInstance.data.datasets[0].pointHoverRadius = 3;
    chartInstance.data.datasets[0].pointHitRadius = 10;
    chartInstance.options.plugins = chartInstance.options.plugins || {};
    chartInstance.options.plugins.minMaxLabel = { enabled: true };
    chartInstance.options.scales = chartInstance.options.scales || {};
    if (chartInstance.options.scales.x) {
      chartInstance.options.scales.x.grid = {
        color: GRID_COLOR,
        drawBorder: false,
      };
    }
    if (chartInstance.options.scales.y) {
      chartInstance.options.scales.y.grid = {
        color: GRID_COLOR,
        drawBorder: false,
      };
    }
    chartInstance.update();
    return chartInstance;
  }

  return new Chart(ctx, {
    type: "line",
    data: {
      labels: labels || [],
      datasets: [
        {
          data: values || [],
          borderColor: color,
          borderWidth: 2,
          backgroundColor: makeGradientFill(color),
          fill: true,
          tension: 0.35,
          cubicInterpolationMode: "monotone",
          stepped: false,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 10,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        x: {
          display: true,
          grid: {
            display: true,
            color: GRID_COLOR,
            drawBorder: false,
          },
          ticks: {
            color: "#8b949e",
            maxTicksLimit: 4,
          },
        },
        y: {
          display: true,
          grid: {
            display: true,
            color: GRID_COLOR,
            drawBorder: false,
          },
          ticks: {
            color: "#8b949e",
            maxTicksLimit: 4,
          },
        },
      },
      plugins: {
        legend: { display: false },
        minMaxLabel: { enabled: true },
        tooltip: {
          backgroundColor: "rgba(15, 23, 42, 0.95)",
          titleColor: "#e2e8f0",
          bodyColor: "#e2e8f0",
          borderColor: "rgba(148, 163, 184, 0.25)",
          borderWidth: 1,
          displayColors: false,
          padding: 8,
        },
      },
      elements: {
        line: { borderJoinStyle: "round" },
        point: { radius: 0 },
      },
    },
  });
}

function setChangeColor(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value > 0) {
    el.classList.add("pos");
    el.classList.remove("neg", "neu");
  } else if (value < 0) {
    el.classList.add("neg");
    el.classList.remove("pos", "neu");
  } else {
    el.classList.add("neu");
    el.classList.remove("pos", "neg");
  }
}

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  const clockEl = document.getElementById("system-time");
  if (clockEl) clockEl.textContent = `${hh}:${mm}:${ss}`;
}

function rangeLabel(rangeKey) {
  if (rangeKey === "hourly") return "Saatlik";
  if (rangeKey === "weekly") return "Haftalık";
  if (rangeKey === "monthly") return "Aylık";
  return "Günlük";
}

function setRangeStatus(count) {
  const statusEl = document.getElementById("range-status");
  if (!statusEl) return;
  const label = rangeLabel(currentRange);
  let suffix = "";
  if (Number.isFinite(count)) {
    if (currentRange === "hourly") {
      suffix = ` (${count} x 10 dk)`;
    } else {
      suffix = ` (${count} gün)`;
    }
  }
  statusEl.textContent = `Grafik aralığı: ${label}${suffix}`;
}

function resetCharts() {
  if (onsChart) onsChart.destroy();
  if (usdChart) usdChart.destroy();
  if (us10yChart) us10yChart.destroy();
  if (gramChart) gramChart.destroy();
  if (arbitrageChart) arbitrageChart.destroy();
  onsChart = null;
  usdChart = null;
  us10yChart = null;
  gramChart = null;
  arbitrageChart = null;
}

function trendText(value) {
  if (value > 0.3) return "yukarı";
  if (value < -0.3) return "aşağı";
  return "yatay";
}

function buildMarketComment(ons, usdtry, us10y, spreadPct) {
  const onsTrend = trendText(ons.change);
  const usdTrend = trendText(usdtry.change);
  const usTrend = trendText(us10y.change);

  let gramBias = "nötr";
  if (ons.change > 0.3 && usdtry.change > 0.3) {
    gramBias = "yukarı yönlü destek";
  } else if (ons.change < -0.3 && usdtry.change < -0.3) {
    gramBias = "aşağı yönlü baskı";
  } else if (ons.change > 0.3 && usdtry.change < -0.3) {
    gramBias = "karışık görünüm";
  } else if (ons.change < -0.3 && usdtry.change > 0.3) {
    gramBias = "karmaşık görünüm";
  }

  const spreadNote = spreadPct > 1.5 ? "Makas yüksek." : "Makas normal.";
  const gramNote =
    gramBias === "yukarı yönlü destek"
      ? "Ons ve kur birlikte yükseldiği için gram altın tarafında ivme güçlü görünüyor ve alıcı iştahı artabilir."
      : gramBias === "aşağı yönlü baskı"
        ? "Ons ve kur birlikte gerilediği için gram altın tarafında baskı öne çıkıyor; kısa vadede geri çekilme görülebilir."
        : "Ons ile kur zıt yönlerde hareket ediyor; bu da gram fiyatında dalgalı ve kararsız bir görünüm yaratıyor.";
  const faizNote =
    us10y.change > 0.3
      ? "ABD 10Y faizindeki yükseliş, riskli varlıkları zayıflatıp altına karşı rekabeti artırabilir."
      : us10y.change < -0.3
        ? "ABD 10Y faizin gerilemesi, güvenli liman talebini destekleyerek altına alan açabilir."
        : "Faiz tarafı net bir yön göstermediği için fiyatlamaya etkisi şimdilik sınırlı görünüyor.";
  const spreadDetail =
    spreadPct > 1.5
      ? "Makas yüksek; bankadan işlem yapmak maliyetli ve hızlı al-sat için uygun değil."
      : "Makas makul seviyede; işlem maliyeti kontrol altında ve al-sat için daha elverişli.";
  const outlook =
    gramBias === "yukarı yönlü destek"
      ? "Bu tablo sürerse gram altında kademeli yükseliş devam edebilir."
    : gramBias === "aşağı yönlü baskı"
      ? "Bu görünüm korunursa gram altında kısa vadeli düşüşler görülebilir."
      : "Karışık görünüm devam ederse gram altında sıkışık ve dalgalı bir bant hareketi beklenebilir.";
  const direction =
    gramBias === "yukarı yönlü destek"
      ? "yukarı"
      : gramBias === "aşağı yönlü baskı"
        ? "aşağı"
        : "yatay";

  return `Ons ${onsTrend} seyrediyor, USD/TRY ${usdTrend} hareket ediyor ve 10Y faiz ${usTrend} görünümünde. Gram görünümü: ${gramBias}. ${gramNote} ${faizNote} ${spreadNote} ${spreadDetail} Sonuç olarak, ${outlook} Kısa vadede yön beklentisi: ${direction}.`;
}

function renderNews(listEl, items, withTranslation) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.className = "news-item";
    li.textContent = "Haber bulunamadı.";
    listEl.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "news-item";
    const link = document.createElement("a");
    link.href = item.link || "#";
    link.target = "_blank";
    link.rel = "noopener";
    const title = item.title || "Başlık yok";
    const tr = withTranslation ? item.title_tr : "";
    link.textContent = tr ? `${title} (${tr})` : title;
    li.appendChild(link);
    const meta = document.createElement("div");
    meta.className = "news-meta";
    const source = item.source ? `• ${item.source}` : "";
    const time = item.published ? `• ${item.published}` : "";
    meta.textContent = `${source} ${time}`.trim();
    li.appendChild(meta);
    listEl.appendChild(li);
  });
}

function buildNewsSummary(national, international) {
  const text = []
    .concat((national || []).map((i) => i.title || ""))
    .concat((international || []).map((i) => i.title || ""))
    .join(" ")
    .toLowerCase();

  const hits = (keywords) => keywords.some((k) => text.includes(k));

  const themes = [];
  if (hits(["faiz", "rate", "yield"])) themes.push("faiz");
  if (hits(["enflasyon", "inflation", "cpi"])) themes.push("enflasyon");
  if (hits(["dolar", "usd", "kur"])) themes.push("kur");
  if (hits(["merkez bank", "fed", "ecb"])) themes.push("merkez bankası");
  if (hits(["jeopolitik", "savaş", "tension"])) themes.push("jeopolitik risk");
  if (hits(["resesyon", "recession", "daralma"])) themes.push("büyüme endişesi");
  if (hits(["altın", "gold", "bullion"])) themes.push("altın teması");

  const themeText = themes.length > 0 ? themes.join(", ") : "genel gündem";
  const natCount = (national || []).length;
  const intCount = (international || []).length;
  let tone = "nötr";
  if (hits(["risk", "savaş", "kriz", "recession", "daralma"])) tone = "riskten kaçış";
  if (hits(["güçlü", "strong", "iyileşme", "ralli"])) tone = "risk iştahı";

  return `Ulusal tarafta ${natCount} haber, uluslararası tarafta ${intCount} haber var. Öne çıkan temalar: ${themeText}. Genel ton: ${tone}.`;
}

function updateHotTicker(local) {
  const hotEl = document.getElementById("hot-news");
  if (!hotEl) return;
  if (!local || !local.garanti || !local.piyasa) {
    hotEl.textContent = "Fiyat verisi bulunamadı.";
    return;
  }
  const gAlis = Number(local.garanti.alis) || 0;
  const gSatis = Number(local.garanti.satis) || 0;
  const pAlis = Number(local.piyasa.alis) || 0;
  const pSatis = Number(local.piyasa.satis) || 0;
  hotEl.textContent =
    `Garanti BBVA Alış: ${gAlis.toFixed(2)} TL • Satış: ${gSatis.toFixed(2)} TL` +
    `  |  Kapalıçarşı Alış: ${pAlis.toFixed(2)} TL • Satış: ${pSatis.toFixed(2)} TL`;
}

async function updateNews() {
  try {
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error("News API error");
    const data = await res.json();
    renderNews(document.getElementById("news-national"), data.national, false);
    renderNews(document.getElementById("news-international"), data.international, true);
    const summaryEl = document.getElementById("news-summary");
    if (summaryEl) {
      summaryEl.textContent = buildNewsSummary(data.national, data.international);
    }
    const updatedEl = document.getElementById("news-updated");
    if (updatedEl) {
      updatedEl.textContent = data.updated_at ? `Son güncelleme: ${data.updated_at}` : "--:--:--";
    }
  } catch (err) {
    console.error("News update failed", err);
  }
}

async function updateDashboard() {
  try {
    const res = await fetch(`/api/metrics?range=${encodeURIComponent(currentRange)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error("API error");
    const data = await res.json();

    // Spread + Signal
    const spreadVal = document.getElementById("spread-val");
    const spreadPct = document.getElementById("spread-pct");
    const signalText = document.getElementById("signal-text");

    if (spreadVal) spreadVal.textContent = data.analysis.spread_tl.toFixed(2);
    if (spreadPct) spreadPct.textContent = data.analysis.spread_pct.toFixed(2) + "%";
    if (signalText) signalText.textContent = data.analysis.signal;

    // Spread card background color
    const spreadCard = spreadVal ? spreadVal.closest(".card") : null;
    if (spreadCard) {
      if (data.analysis.spread_pct > 1.5) {
        spreadCard.style.background = "#3a1414"; // red tint
      } else {
        spreadCard.style.background = "#123022"; // green tint
      }
    }

    // Global data
    const ons = data.global.ONS || { price: 0, change: 0 };
    const usdtry = data.global.USDTRY || { price: 0, change: 0 };
    const us10y = data.global.US10Y || { price: 0, change: 0 };

    const onsPriceEl = document.getElementById("ons-price");
    const onsChangeEl = document.getElementById("ons-change");
    const usdPriceEl = document.getElementById("usdtry-price");
    const usdChangeEl = document.getElementById("usdtry-change");
    const us10yPriceEl = document.getElementById("us10y-price");
    const us10yChangeEl = document.getElementById("us10y-change");

    if (onsPriceEl) onsPriceEl.textContent = ons.price;
    if (onsChangeEl) onsChangeEl.textContent = ons.change + "%";
    if (usdPriceEl) usdPriceEl.textContent = usdtry.price;
    if (usdChangeEl) usdChangeEl.textContent = usdtry.change + "%";
    if (us10yPriceEl) us10yPriceEl.textContent = us10y.price;
    if (us10yChangeEl) us10yChangeEl.textContent = us10y.change + "%";

    setChangeColor("ons-change", ons.change);
    setChangeColor("usdtry-change", usdtry.change);
    setChangeColor("us10y-change", us10y.change);

    // Local data
    const gramPrice = data.local.piyasa.satis;
    const arbitrage = Number.isFinite(data.analysis.arbitrage)
      ? data.analysis.arbitrage
      : data.local.piyasa.satis - data.local.garanti.alis;

    const gramPriceEl = document.getElementById("gram-price");
    const arbitrageEl = document.getElementById("arbitrage-val");
    if (gramPriceEl) gramPriceEl.textContent = gramPrice.toFixed(2);
    if (arbitrageEl) arbitrageEl.textContent = arbitrage.toFixed(2);

    updateHotTicker(data.local);

    const commentEl = document.getElementById("market-comment");
    if (commentEl) {
      commentEl.textContent = buildMarketComment(
        ons,
        usdtry,
        us10y,
        data.analysis.spread_pct
      );
    }

    // Charts
    const history = (data.global && data.global.history) || data.history || {};
    const labels = history.dates || [];
    const onsValues = history.ons_prices || [];
    const usdValues = history.usd_prices || [];
    const us10yValues = history.us10y_prices || [];
    const gramValues = history.gram_prices || [];
    const arbitrageValues = history.arbitrage_prices || [];
    const arbitrageLabels = history.arbitrage_dates || labels;

    setRangeStatus(labels.length);

    if (lastRenderedRange !== currentRange) {
      resetCharts();
      lastRenderedRange = currentRange;
    }

    const onsCanvas = document.getElementById("onsChart");
    const usdCanvas = document.getElementById("usdChart");
    const us10yCanvas = document.getElementById("us10yChart");
    const gramCanvas = document.getElementById("gramChart");
    const arbitrageCanvas = document.getElementById("arbitrageChart");

    if (onsCanvas) {
      onsChart = renderChart(
        onsChart,
        onsCanvas.getContext("2d"),
        labels,
        onsValues,
        trendColor(onsValues, CHART_PALETTE.ons)
      );
    }

    if (usdCanvas) {
      usdChart = renderChart(
        usdChart,
        usdCanvas.getContext("2d"),
        labels,
        usdValues,
        trendColor(usdValues, CHART_PALETTE.usd)
      );
    }

    if (us10yCanvas) {
      us10yChart = renderChart(
        us10yChart,
        us10yCanvas.getContext("2d"),
        labels,
        us10yValues,
        trendColor(us10yValues, CHART_PALETTE.us10y)
      );
    }

    if (gramCanvas) {
      gramChart = renderChart(
        gramChart,
        gramCanvas.getContext("2d"),
        labels,
        gramValues,
        trendColor(gramValues, CHART_PALETTE.gram)
      );
    }

    if (arbitrageCanvas) {
      arbitrageChart = renderChart(
        arbitrageChart,
        arbitrageCanvas.getContext("2d"),
        arbitrageLabels,
        arbitrageValues,
        trendColor(arbitrageValues, CHART_PALETTE.arbitrage)
      );
    }
  } catch (err) {
    console.error("Dashboard update failed", err);
  }
}

// Calculation section
const gramInput = document.getElementById("gram-input");
if (gramInput) {
  gramInput.addEventListener("input", () => {
    const val = parseFloat(gramInput.value) || 0;
    const gramPrice = parseFloat(
      document.getElementById("gram-price").textContent
    ) || 0;
    const tlResult = document.getElementById("tl-result");
    if (tlResult) tlResult.textContent = (val * gramPrice).toFixed(2);
  });
}

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Güncelleniyor...";
    await updateDashboard();
    refreshBtn.textContent = "Güncelle";
    refreshBtn.disabled = false;
  });
}

const statusRefreshBtn = document.getElementById("status-refresh-btn");
if (statusRefreshBtn) {
  statusRefreshBtn.addEventListener("click", async () => {
    statusRefreshBtn.disabled = true;
    const originalText = statusRefreshBtn.textContent;
    statusRefreshBtn.textContent = "Güncelleniyor...";
    await updateDashboard();
    statusRefreshBtn.textContent = originalText;
    statusRefreshBtn.disabled = false;
  });
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest(".range-btn");
  if (!btn) return;
  event.preventDefault();
  const group = btn.closest(".range-buttons");
  if (!group) return;
  group.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentRange = btn.dataset.range || "daily";
  setRangeStatus();
  updateDashboard();
});

// Initial + interval
updateDashboard();
updateClock();
updateNews();
setInterval(updateDashboard, 10000);
setInterval(updateClock, 1000);
setInterval(updateNews, 300000);
