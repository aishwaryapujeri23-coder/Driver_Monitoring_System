/**
 * Dashboard page controller. Wires together: webcam -> face analyzer ->
 * MonitoringController -> UI (gauge, metric tiles, alert feed, session
 * controls). Kept separate from monitoring.js so "how to compute state"
 * and "how to render it" stay independent and each is easier to test/reason
 * about on its own.
 */

document.addEventListener("DOMContentLoaded", async () => {
  Auth.requireAuth();

  const els = {
    video: document.getElementById("webcam-video"),
    canvas: document.getElementById("overlay-canvas"),
    cameraPanel: document.getElementById("camera-panel"),
    placeholder: document.getElementById("camera-placeholder"),
    statusPill: document.getElementById("status-pill"),
    statusLabel: document.getElementById("status-label"),
    sessionTimer: document.getElementById("session-timer"),
    startBtn: document.getElementById("start-session-btn"),
    stopBtn: document.getElementById("stop-session-btn"),
    needle: document.getElementById("gauge-needle"),
    gaugeScore: document.getElementById("gauge-score"),
    gaugeLevel: document.getElementById("gauge-level"),
    drowsinessScore: document.getElementById("drowsiness-score"),
    distractionScore: document.getElementById("distraction-score"),
    reasonsList: document.getElementById("gauge-reasons-list"),
    alertFeed: document.getElementById("alert-feed"),
    eventTimeline: document.getElementById("event-timeline"),
    errorBanner: document.getElementById("error-banner"),
    summaryModal: document.getElementById("summary-modal"),
    summaryBody: document.getElementById("summary-body"),
    summaryCloseBtn: document.getElementById("summary-close-btn"),
    calibrateBtn: document.getElementById("calibrate-btn"),
    calibrationStatus: document.getElementById("calibration-status"),
    calibrationModal: document.getElementById("calibration-modal"),
    calibrationCancelBtn: document.getElementById("calibration-cancel-btn"),
    calibrationStartBtn: document.getElementById("calibration-start-btn"),
    calibrationInstruction: document.getElementById("calibration-instruction"),
    calibrationProgressBar: document.getElementById("calibration-progress-bar"),
    calibrationProgressLabel: document.getElementById("calibration-progress-label"),
    metricFps: document.getElementById("metric-fps"),
    metricLatency: document.getElementById("metric-latency"),

    metricEar: document.getElementById("metric-ear"),
    metricMar: document.getElementById("metric-mar"),
    metricYaw: document.getElementById("metric-yaw"),
    metricPitch: document.getElementById("metric-pitch"),
    metricRoll: document.getElementById("metric-roll"),
    metricBlinks: document.getElementById("metric-blinks"),
    metricYawns: document.getElementById("metric-yawns"),
    metricEyeClosed: document.getElementById("metric-eye-closed"),
    metricPhone: document.getElementById("metric-phone"),
    metricFace: document.getElementById("metric-face"),
  };

  function showError(message) {
    els.errorBanner.textContent = message;
    els.errorBanner.classList.remove("hidden");
  }
  function clearError() {
    els.errorBanner.classList.add("hidden");
  }

  const webcam = new Webcam(els.video);
  const faceAnalyzer = new FaceAnalyzer();
  const alertManager = new AlertManager(window.APP_CONFIG.ALERT_COOLDOWN_SECONDS);
  let monitoring = null;
  let timerHandle = null;
  let calibrationTimer = null;
  let signalsChart = null;
  let riskChart = null;

  function setupCharts() {
    if (!window.Chart) return;
    const options = { animation: false, responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: "#a9b3c2" } } }, scales: { x: { display: false }, y: { ticks: { color: "#7f8b9d" }, grid: { color: "#27313d" } } } };
    signalsChart = new Chart(document.getElementById("signals-chart"), { type: "line", data: { labels: [], datasets: [{ label: "EAR", data: [], borderColor: "#4da3ff", pointRadius: 0 }, { label: "MAR", data: [], borderColor: "#f5a623", pointRadius: 0 }] }, options });
    riskChart = new Chart(document.getElementById("risk-chart"), { type: "line", data: { labels: [], datasets: [{ label: "Risk", data: [], borderColor: "#ff6b4a", pointRadius: 0, fill: true, backgroundColor: "rgba(255,107,74,.12)" }] }, options });
  }

  function addChartPoint(chart, values) {
    if (!chart) return;
    chart.data.labels.push("");
    chart.data.datasets.forEach((dataset, index) => dataset.data.push(values[index] ?? null));
    while (chart.data.labels.length > 80) { chart.data.labels.shift(); chart.data.datasets.forEach((dataset) => dataset.data.shift()); }
    chart.update("none");
  }

  els.placeholder.textContent = "Loading face-detection model…";

  const modelResult = await faceAnalyzer.init();
  if (!modelResult.ok) {
    showError(modelResult.message);
    els.placeholder.textContent = "Model failed to load — see error above.";
  } else {
    els.placeholder.textContent = "Click \u201cStart Session\u201d to begin monitoring.";
  }
  setupCharts();
  try {
    window.DRIVER_PROFILE = await SessionApi.getCalibration();
    if (window.DRIVER_PROFILE) els.calibrationStatus.textContent = `Calibrated ${formatClockTime(window.DRIVER_PROFILE.calibrated_at)}`;
  } catch { /* Calibration is optional; fixed defaults remain active. */ }

  els.calibrateBtn.addEventListener("click", () => {
    if (monitoring?.running) { showError("Stop the active session before recalibrating."); return; }
    els.calibrationModal.classList.remove("hidden");
  });
  els.calibrationCancelBtn.addEventListener("click", () => { if (!calibrationTimer) els.calibrationModal.classList.add("hidden"); });
  els.calibrationStartBtn.addEventListener("click", () => {
    if (els.calibrationStartBtn.dataset.done === "true") {
      els.calibrationModal.classList.add("hidden");
      els.calibrationStartBtn.dataset.done = "false";
      els.calibrationStartBtn.textContent = "Begin Calibration";
    } else {
      runCalibration();
    }
  });

  async function runCalibration() {
    els.calibrationStartBtn.disabled = true;
    const camera = await webcam.start();
    if (!camera.ok) { showError(camera.message); els.calibrationStartBtn.disabled = false; return; }
    const samples = [];
    const started = performance.now();
    const duration = 12000;
    els.calibrationInstruction.textContent = "Look straight ahead, blink naturally, then slowly open and close your mouth.";
    calibrationTimer = setInterval(() => {
      const elapsed = performance.now() - started;
      const analysis = faceAnalyzer.analyze(els.video, performance.now());
      if (analysis.faceCount === 1) samples.push({ ear: analysis.ear, mar: analysis.mar, ...analysis.headPose });
      const progress = Math.min(elapsed / duration, 1);
      els.calibrationProgressBar.style.width = `${progress * 100}%`;
      els.calibrationProgressLabel.textContent = `${Math.round(progress * 100)}% • ${samples.length} face samples`;
      if (progress >= 1) finishCalibration(samples);
    }, 100);
  }

  async function finishCalibration(samples) {
    clearInterval(calibrationTimer); calibrationTimer = null;
    if (samples.length < 20) { showError("Calibration needs a clear view of your face. Please try again."); els.calibrationStartBtn.disabled = false; return; }
    const values = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b);
    const percentile = (key, fraction) => { const list = values(key); return list[Math.min(list.length - 1, Math.floor(list.length * fraction))]; };
    const mean = (key) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
    const std = (key, average) => Math.sqrt(samples.reduce((sum, sample) => sum + (sample[key] - average) ** 2, 0) / samples.length);
    const ear = percentile("ear", 0.7); const mar = percentile("mar", 0.35);
    const profile = { ear_baseline: ear, ear_std: std("ear", ear), mar_baseline: mar, mar_std: std("mar", mar), head_yaw_baseline: mean("yaw"), head_pitch_baseline: mean("pitch"), head_roll_baseline: mean("roll"), sample_count: samples.length };
    try {
      window.DRIVER_PROFILE = await SessionApi.saveCalibration(profile);
      els.calibrationStatus.textContent = `Calibrated ${formatClockTime(window.DRIVER_PROFILE.calibrated_at)}`;
      els.calibrationInstruction.textContent = "Calibration saved. Your personal baseline is active.";
      els.calibrationStartBtn.textContent = "Done";
      els.calibrationStartBtn.disabled = false;
      els.calibrationStartBtn.dataset.done = "true";
    } catch (err) { showError(err.message || "Could not save calibration."); els.calibrationStartBtn.disabled = false; }
    webcam.stop();
  }

  els.startBtn.addEventListener("click", async () => {
    clearError();
    // Must happen synchronously inside this click handler — browsers block
    // audio that isn't initiated by a direct user gesture. This unlocks the
    // AudioContext so alert tones fired later from the monitoring loop
    // (not a click) are actually audible instead of silently blocked.
    alertManager.unlock();

    if (!faceAnalyzer.ready) {
      showError("Face-detection model isn't ready yet. Please wait or refresh the page.");
      return;
    }

    els.startBtn.disabled = true;
    const camResult = await webcam.start();
    if (!camResult.ok) {
      showError(camResult.message);
      els.startBtn.disabled = false;
      return;
    }
    els.placeholder.classList.add("hidden");

    monitoring = new MonitoringController({
      faceAnalyzer,
      alertManager,
      videoEl: els.video,
      canvasEl: els.canvas,
      onUpdate: renderUpdate,
    });
    monitoring.onAlert(renderAlert);

    try {
      await monitoring.start();
    } catch (err) {
      showError(err.message || "Could not start the session — is the backend running?");
      webcam.stop();
      els.startBtn.disabled = false;
      return;
    }

    els.alertFeed.innerHTML = "";
    els.startBtn.classList.add("hidden");
    els.stopBtn.classList.remove("hidden");
    els.stopBtn.disabled = false;

    timerHandle = setInterval(() => {
      const elapsed = (performance.now() - monitoring.sessionStartedAt) / 1000;
      els.sessionTimer.textContent = formatDuration(elapsed);
    }, 1000);
  });

  els.stopBtn.addEventListener("click", async () => {
    els.stopBtn.disabled = true;
    clearInterval(timerHandle);
    let summary = null;
    try {
      summary = await monitoring.stop();
    } catch (err) {
      showError(err.message || "Could not save the session summary.");
    }
    webcam.stop();
    els.placeholder.classList.remove("hidden");
    els.placeholder.textContent = "Session ended. Click \u201cStart Session\u201d to begin again.";
    els.stopBtn.classList.add("hidden");
    els.startBtn.classList.remove("hidden");
    els.startBtn.disabled = false;
    setStatus("SAFE");
    els.sessionTimer.textContent = "00:00";

    if (summary) renderSessionSummary(summary);
  });

  els.summaryCloseBtn.addEventListener("click", () => {
    els.summaryModal.classList.add("hidden");
  });

  function setStatus(level) {
    const cls = riskLevelToStatusClass(level);
    els.cameraPanel.className = `camera-panel ${cls}`;
    els.statusPill.className = `status-pill`;
    els.statusLabel.textContent = level;
  }

  function renderUpdate(update) {
    setStatus(update.risk.level);

    els.gaugeScore.textContent = Math.round(update.risk.overallScore);
    els.gaugeLevel.textContent = update.risk.level;
    els.gaugeLevel.style.color = riskLevelColor(update.risk.level);
    els.drowsinessScore.textContent = Math.round(update.risk.drowsinessScore);
    els.distractionScore.textContent = Math.round(update.risk.distractionScore);
    els.metricFps.textContent = update.processingFps.toFixed(1);
    els.metricLatency.textContent = `${update.detectionLatencyMs.toFixed(0)} ms`;
    addChartPoint(signalsChart, [update.ear, update.mar]);
    addChartPoint(riskChart, [update.risk.overallScore]);

    // Needle sweeps -90deg (score 0) to +90deg (score 100)
    const angle = -90 + (update.risk.overallScore / 100) * 180;
    els.needle.setAttribute("transform", `rotate(${angle} 150 150)`);

    els.reasonsList.innerHTML = update.risk.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("");

    els.metricEar.textContent = update.ear !== null ? update.ear.toFixed(2) : "—";
    els.metricMar.textContent = update.mar !== null ? update.mar.toFixed(2) : "—";
    els.metricYaw.textContent = `${update.headPose.yaw.toFixed(1)}°`;
    els.metricPitch.textContent = `${update.headPose.pitch.toFixed(1)}°`;
    els.metricRoll.textContent = `${update.headPose.roll.toFixed(1)}°`;
    els.metricBlinks.textContent = update.stats.blinkCount;
    els.metricYawns.textContent = update.stats.yawnCount;

    els.metricEyeClosed.textContent = update.eyeClosed ? "YES" : "NO";
    els.metricEyeClosed.classList.toggle("value--danger", update.eyeClosed);
    els.metricEyeClosed.classList.toggle("value--ok", !update.eyeClosed);

    els.metricPhone.textContent = update.phoneDetected ? "DETECTED" : "NOT DETECTED";
    els.metricPhone.classList.toggle("value--warn", update.phoneDetected);
    els.metricPhone.classList.toggle("value--ok", !update.phoneDetected);

    els.metricFace.textContent = update.faceState.replace("_", " ");
    els.metricFace.classList.toggle("value--danger", update.faceState !== "DETECTED");
    els.metricFace.classList.toggle("value--ok", update.faceState === "DETECTED");
    els.eventTimeline.innerHTML = update.events.slice().reverse().map((event) => `
      <div class="event-row"><span class="event-row__time">${formatClockTime(event.timestamp)}</span><span>${escapeHtml(event.event_type.replaceAll("_", " "))}</span><span class="event-row__severity">${escapeHtml(event.severity)}</span></div>
    `).join("");
  }

  function riskLevelColor(level) {
    return {
      SAFE: "var(--accent-safe)", LOW: "var(--accent-safe)",
      MEDIUM: "var(--accent-warn)", HIGH: "var(--accent-danger)", CRITICAL: "var(--accent-critical)",
    }[level] || "var(--text-primary)";
  }

  function renderAlert(alert) {
    const row = document.createElement("div");
    row.className = `alert-row alert-row--${alert.level.toLowerCase()}`;
    row.innerHTML = `
      <span class="alert-row__time">${formatClockTime(alert.timestamp)}</span>
      <span class="alert-row__msg">${escapeHtml(alert.message)}</span>
    `;
    els.alertFeed.prepend(row);
    while (els.alertFeed.children.length > 25) {
      els.alertFeed.removeChild(els.alertFeed.lastChild);
    }
  }

  function renderSessionSummary(summary) {
    els.summaryBody.innerHTML = `
      <div class="summary-grid">
        <div class="summary-stat"><div class="summary-stat__label">Duration</div><div class="summary-stat__value">${formatDuration(summary.duration_seconds)}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Blinks</div><div class="summary-stat__value">${summary.blink_count}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Yawns</div><div class="summary-stat__value">${summary.yawn_count}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Drowsiness Events</div><div class="summary-stat__value">${summary.drowsiness_events}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Distraction Events</div><div class="summary-stat__value">${summary.distraction_events}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Phone Detections</div><div class="summary-stat__value">${summary.phone_detection_count}</div></div>
        <div class="summary-stat"><div class="summary-stat__label">Maximum Risk</div><div class="summary-stat__value"><span class="risk-badge risk-badge--${summary.maximum_risk_level.toLowerCase()}">${summary.maximum_risk_level}</span></div></div>
        <div class="summary-stat"><div class="summary-stat__label">Average Risk Score</div><div class="summary-stat__value">${summary.average_risk_score.toFixed(1)}</div></div>
      </div>
    `;
    els.summaryModal.classList.remove("hidden");
  }
});