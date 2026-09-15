/**
 * Shared client-side configuration.
 *
 * These values mirror backend/.env.example so that the live, in-browser
 * scoring (monitoring.js) uses the same thresholds the backend documents.
 * If you calibrate the backend .env, update the matching value here too —
 * this is the single place the frontend reads thresholds from.
 *
 * CALIBRATION NOTE: these are reasonable starting points, not universal or
 * medically validated constants. Camera position, lighting, and individual
 * facial geometry all shift ideal thresholds — see the in-app calibration
 * flow (dashboard "Calibrate" button) to personalize EAR/MAR baselines.
 */
window.APP_CONFIG = Object.freeze({
  API_BASE: "/api",

  // Drowsiness — Eye Aspect Ratio
  EAR_THRESHOLD: 0.21,
  EYE_CLOSED_DURATION: 1.5,
  EYE_CLOSED_CRITICAL_DURATION: 2.5,
  BLINK_MIN_DURATION: 0.08,
  BLINK_MAX_DURATION: 0.4,

  // Yawning — Mouth Aspect Ratio
  YAWN_THRESHOLD: 0.6,
  YAWN_DURATION: 1.2,

  // Head pose / distraction
  HEAD_YAW_THRESHOLD: 25.0,
  HEAD_PITCH_THRESHOLD: 20.0,
  DISTRACTION_DURATION: 2.0,
  FACE_ABSENT_DURATION: 2.0,

  // Risk engine weights
  RISK_WEIGHT_DROWSINESS: 0.6,
  RISK_WEIGHT_DISTRACTION: 0.4,

  // Alerts
  ALERT_COOLDOWN_SECONDS: 5.0,

  // Performance
  PROCESSING_INTERVAL_MS: 150, // ~6-7 analysis FPS — decoupled from camera display FPS
  PHONE_CHECK_INTERVAL_MS: 3000, // YOLO phone-detection sample cadence (server round trip)
  SAMPLE_FRAME_MAX_WIDTH: 480,
  RISK_SAMPLE_INTERVAL_MS: 2000, // how often a risk score is pushed into session averaging
  TEMPORAL_WINDOW_SECONDS: 30,
  SMOOTHING_WINDOW_SAMPLES: 8,
});

window.DRIVER_PROFILE = null;

function getEffectiveMonitoringConfig() {
  const profile = window.DRIVER_PROFILE;
  if (!profile) return window.APP_CONFIG;
  return {
    ...window.APP_CONFIG,
    EAR_THRESHOLD: Math.max(0.12, Math.min(profile.ear_baseline * 0.72, profile.ear_baseline - 0.03)),
    YAWN_THRESHOLD: profile.mar_baseline + Math.max(0.15, profile.mar_std * 2),
    HEAD_YAW_THRESHOLD: Math.max(12, window.APP_CONFIG.HEAD_YAW_THRESHOLD),
    HEAD_PITCH_THRESHOLD: Math.max(12, window.APP_CONFIG.HEAD_PITCH_THRESHOLD),
  };
}
