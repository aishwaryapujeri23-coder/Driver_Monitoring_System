/**
 * Analytics charts (history.html) — Chart.js from CDN, no build step.
 * Reads /api/analytics/summary and /api/analytics/timeline.
 */

const CHART_COLORS = {
  safe: "#33d17a", warn: "#f5a623", danger: "#ff6b4a", critical: "#ef3b56", info: "#4da3ff",
  grid: "rgba(255,255,255,0.06)", text: "#8b95a7",
};

Chart.defaults.color = CHART_COLORS.text;
Chart.defaults.font.family = "Inter, sans-serif";
Chart.defaults.borderColor = CHART_COLORS.grid;

function riskLevelColorHex(level) {
  return { SAFE: CHART_COLORS.safe, LOW: CHART_COLORS.safe, MEDIUM: CHART_COLORS.warn, HIGH: CHART_COLORS.danger, CRITICAL: CHART_COLORS.critical }[level] || CHART_COLORS.info;
}

function renderSummaryStats(summary) {
  document.getElementById("stat-total-sessions").textContent = summary.total_sessions;
  document.getElementById("stat-total-time").textContent = formatDuration(summary.total_driving_time_seconds);
  document.getElementById("stat-drowsiness-events").textContent = summary.total_drowsiness_events;
  document.getElementById("stat-distraction-events").textContent = summary.total_distraction_events;
  document.getElementById("stat-yawns").textContent = summary.total_yawns;
  document.getElementById("stat-blinks").textContent = summary.total_blinks;
  document.getElementById("stat-phone").textContent = summary.total_phone_detections;
  document.getElementById("stat-avg-risk").textContent = summary.average_risk_score.toFixed(1);

  const highestEl = document.getElementById("stat-highest-risk");
  highestEl.innerHTML = `<span class="risk-badge risk-badge--${summary.highest_risk_level.toLowerCase()}">${summary.highest_risk_level}</span>`;
}

function renderCharts(timeline) {
  const labels = timeline.map((p) => formatDateTime(p.started_at));

  new Chart(document.getElementById("chart-risk-timeline"), {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Average risk score",
        data: timeline.map((p) => p.average_risk_score),
        borderColor: CHART_COLORS.info,
        backgroundColor: "rgba(77,163,255,0.15)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100 } } },
  });

  new Chart(document.getElementById("chart-events"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Drowsiness events", data: timeline.map((p) => p.drowsiness_events), backgroundColor: CHART_COLORS.danger },
        { label: "Distraction events", data: timeline.map((p) => p.distraction_events), backgroundColor: CHART_COLORS.warn },
      ],
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } },
  });

  new Chart(document.getElementById("chart-duration"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "Session duration (min)", data: timeline.map((p) => p.duration_seconds / 60), backgroundColor: CHART_COLORS.safe }],
    },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });

  const levelCounts = { SAFE: 0, LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  timeline.forEach((p) => { levelCounts[p.maximum_risk_level] = (levelCounts[p.maximum_risk_level] || 0) + 1; });

  new Chart(document.getElementById("chart-distribution"), {
    type: "doughnut",
    data: {
      labels: Object.keys(levelCounts),
      datasets: [{
        data: Object.values(levelCounts),
        backgroundColor: Object.keys(levelCounts).map(riskLevelColorHex),
        borderColor: "#171c24",
        borderWidth: 2,
      }],
    },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } },
  });
}
