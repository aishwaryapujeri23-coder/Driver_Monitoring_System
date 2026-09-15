/**
 * Small shared helpers used across dashboard/monitoring/charts modules.
 */

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function euclideanDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Formats seconds as MM:SS (or HH:MM:SS if over an hour). */
function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

function formatClockTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** Throttles a function to run at most once per `intervalMs`. */
function throttle(fn, intervalMs) {
  let last = 0;
  let timeoutId = null;
  return (...args) => {
    const now = performance.now();
    const remaining = intervalMs - (now - last);
    if (remaining <= 0) {
      last = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        last = performance.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

function riskLevelRank(level) {
  return ["SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(level);
}

function maxRiskLevel(a, b) {
  return riskLevelRank(a) >= riskLevelRank(b) ? a : b;
}

function riskLevelToStatusClass(level) {
  return `status--${(level || "safe").toLowerCase()}`;
}

/** Downscales a <video> frame onto an offscreen canvas and returns a base64 JPEG (no data: prefix). */
function captureFrameAsBase64(videoEl, maxWidth) {
  const scale = Math.min(1, maxWidth / videoEl.videoWidth);
  const w = Math.round(videoEl.videoWidth * scale);
  const h = Math.round(videoEl.videoHeight * scale);
  if (!w || !h) return null;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
  return dataUrl.split(",")[1];
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
