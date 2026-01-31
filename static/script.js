let onsChart = null;
let usdChart = null;
let us10yChart = null;
let gramChart = null;
let arbitrageChart = null;
let currentRange = "daily";

const CHART_PALETTE = {
  ons: { pos: "#16c784", neg: "#ef4444", neu: "#f5c451" },
  usd: { pos: "#22c55e", neg: "#f87171", neu: "#fbbf24" },
  us10y: { pos: "#10b981", neg: "#dc2626", neu: "#f59e0b" },
  gram: { pos: "#34d399", neg: "#f87171", neu: "#fbbf24" },
  arbitrage: { pos: "#14b8a6", neg: "#ef4444", neu: "#f59e0b" },
};

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
          fill: false,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: {
            color: "#8b949e",
            maxTicksLimit: 4,
          },
        },
        y: {
          display: true,
          grid: { display: false },
          ticks: {
            color: "#8b949e",
            maxTicksLimit: 4,
          },
        },
      },
      plugins: {
        legend: { display: false },
      },
      elements: {
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

const rangeButtons = document.querySelectorAll(".range-btn");
if (rangeButtons && rangeButtons.length > 0) {
  rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      rangeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentRange = btn.dataset.range || "daily";
      const statusEl = document.getElementById("range-status");
      if (statusEl) {
        const label =
          currentRange === "weekly"
            ? "Haftalık"
            : currentRange === "yearly"
              ? "Yıllık"
              : "Günlük";
        statusEl.textContent = `Grafik aralığı: ${label}`;
      }
      updateDashboard();
    });
  });
}

// Initial + interval
updateDashboard();
updateClock();
updateNews();
setInterval(updateDashboard, 10000);
setInterval(updateClock, 1000);
setInterval(updateNews, 300000);
