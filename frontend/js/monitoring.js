/**
 * MonitoringController — the central orchestrator of the real-time loop.
 *
 * On each tick (throttled to APP_CONFIG.PROCESSING_INTERVAL_MS — decoupled
 * from the video's own display framerate, per the "don't process every
 * frame" performance requirement):
 *
 *   1. Run face landmark analysis (face.js, in-browser, no network).
 *   2. Feed EAR/MAR/head-pose into temporal state machines (this file) —
 *      single-frame dips are NEVER treated as events; everything requires
 *      a sustained duration past a configured threshold.
 *   3. Compute an explainable risk score (mirrors backend
 *      services/risk_engine.py exactly, so live scoring and the
 *      server-recomputed session summary agree).
 *   4. Decide + fire debounced alerts (alerts.js).
 *   5. Accumulate session statistics for the eventual POST to
 *      /api/sessions/{id}/stop.
 *   6. Periodically (every PHONE_CHECK_INTERVAL_MS) sample a downscaled
 *      frame and ask the backend's YOLO service whether a phone is visible
 *      — this is the one thing that genuinely needs a heavier model, so
 *      it's the only thing sent to the server, and only occasionally.
 */

// ---------------------------------------------------------------------
// Risk engine (JS mirror of backend/app/services/risk_engine.py)
// ---------------------------------------------------------------------
function computeDrowsinessScore(inputs) {
  const cfg = getEffectiveMonitoringConfig();
  const reasons = [];
  let score = 0;

  if (inputs.eyeClosedDuration >= cfg.EYE_CLOSED_DURATION) {
    const overshoot = inputs.eyeClosedDuration - cfg.EYE_CLOSED_DURATION;
    const span = Math.max(cfg.EYE_CLOSED_CRITICAL_DURATION - cfg.EYE_CLOSED_DURATION, 0.01);
    score += 30 + 30 * clamp(overshoot / span, 0, 1);
    reasons.push(`Eyes closed for ${inputs.eyeClosedDuration.toFixed(1)}s`);
  } else if (inputs.ear < cfg.EAR_THRESHOLD) {
    score += 8;
    reasons.push("Eyes appear partially closed");
  }

  if (inputs.isYawning && inputs.yawnDuration >= cfg.YAWN_DURATION) {
    score += 25;
    reasons.push(`Yawning for ${inputs.yawnDuration.toFixed(1)}s`);
  }

  score += Math.min(inputs.drowsinessEventCount * 3, 15);
  if (inputs.drowsinessEventCount >= 3) {
    reasons.push(`${inputs.drowsinessEventCount} drowsiness events this session`);
  }

  const frequencyComponent = Math.min(inputs.blinkFrequency / 12 * 5 + inputs.yawnFrequency / 3 * 10, 15);
  score += frequencyComponent;
  if (inputs.yawnFrequency >= 1) reasons.push(`Yawning frequency is ${inputs.yawnFrequency.toFixed(1)}/min`);

  return { score: clamp(score, 0, 100), reasons };
}

function computeDistractionScore(inputs) {
  const cfg = getEffectiveMonitoringConfig();
  const reasons = [];
  let score = 0;

  const headOffAxis =
    Math.abs(inputs.headYaw) > cfg.HEAD_YAW_THRESHOLD || Math.abs(inputs.headPitch) > cfg.HEAD_PITCH_THRESHOLD;

  if (headOffAxis && inputs.distractionDuration >= cfg.DISTRACTION_DURATION) {
    score += 40;
    let direction = "away";
    if (inputs.headYaw < -cfg.HEAD_YAW_THRESHOLD) direction = "left";
    else if (inputs.headYaw > cfg.HEAD_YAW_THRESHOLD) direction = "right";
    else if (inputs.headPitch > cfg.HEAD_PITCH_THRESHOLD) direction = "down";
    else if (inputs.headPitch < -cfg.HEAD_PITCH_THRESHOLD) direction = "up";
    reasons.push(`Driver looking ${direction} for ${inputs.distractionDuration.toFixed(1)}s`);
  } else if (headOffAxis) {
    score += 10;
    reasons.push("Driver momentarily looking away");
  }

  if (inputs.faceAbsentDuration >= cfg.FACE_ABSENT_DURATION) {
    score += 35;
    reasons.push(`Face not detected for ${inputs.faceAbsentDuration.toFixed(1)}s`);
  }

  if (inputs.phoneDetected) {
    score += 25;
    reasons.push(inputs.phoneDuration >= 2 ? "Phone persistently detected" : "Phone detected in frame");
  }

  return { score: clamp(score, 0, 100), reasons };
}

function riskLevelFromScore(score) {
  if (score < 15) return "SAFE";
  if (score < 35) return "LOW";
  if (score < 60) return "MEDIUM";
  if (score < 80) return "HIGH";
  return "CRITICAL";
}

function computeOverallRisk(drowsinessInputs, distractionInputs) {
  const cfg = getEffectiveMonitoringConfig();
  const d = computeDrowsinessScore(drowsinessInputs);
  const dist = computeDistractionScore(distractionInputs);
  const overall = clamp(cfg.RISK_WEIGHT_DROWSINESS * d.score + cfg.RISK_WEIGHT_DISTRACTION * dist.score, 0, 100);
  const level = riskLevelFromScore(overall);
  let reasons = [...d.reasons, ...dist.reasons];
  if (reasons.length === 0) reasons = ["Normal eye activity", "Driver looking forward"];
  return { drowsinessScore: d.score, distractionScore: dist.score, overallScore: overall, level, reasons };
}

// ---------------------------------------------------------------------
// MonitoringController
// ---------------------------------------------------------------------
class MonitoringController {
  constructor({ faceAnalyzer, alertManager, videoEl, canvasEl, onUpdate }) {
    this.faceAnalyzer = faceAnalyzer;
    this.alertManager = alertManager;
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onUpdate = onUpdate || (() => {});

    this.sessionId = null;
    this.running = false;
    this.intervalHandle = null;
    this.sessionStartedAt = null;

    this._resetState();
  }

  _resetState() {
    this.eyesClosedSince = null;
    this.blinkStartedAt = null;
    this.stats = {
      blinkCount: 0,
      yawnCount: 0,
      eyeClosureEvents: 0,
      drowsinessEvents: 0,
      distractionEvents: 0,
      phoneDetectionCount: 0,
      totalDrowsinessDuration: 0,
      totalDistractionDuration: 0,
      longestEyeClosure: 0,
      longestDistraction: 0,
    };
    this.yawnStartedAt = null;
    this.isYawningConfirmed = false;
    this.headOffAxisSince = null;
    this.distractionConfirmed = false;
    this.faceAbsentSince = null;
    this.driverNotDetectedFired = false;
    this.multipleFacesFired = false;
    this.phoneDetected = false;
    this.phoneDetectedUntil = 0;
    this.lastPhoneCheckAt = 0;
    this.riskSamples = [];
    this.maximumRiskLevel = "SAFE";
    this.events = [];
    this.alertLog = [];
    this.lastRiskSampleAt = 0;
    this.temporalSamples = [];
    this.phoneDetectedSince = null;
    this.lastTickAt = 0;
    this.processingFps = 0;
  }

  async start() {
    const session = await SessionApi.start();
    this.sessionId = session.id;
    this.sessionStartedAt = performance.now();
    this._resetState();
    this.running = true;
    this.intervalHandle = setInterval(() => this._tick(), window.APP_CONFIG.PROCESSING_INTERVAL_MS);
    return session;
  }

  async stop() {
    this.running = false;
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    this.ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);

    const payload = {
      blink_count: this.stats.blinkCount,
      yawn_count: this.stats.yawnCount,
      eye_closure_events: this.stats.eyeClosureEvents,
      drowsiness_events: this.stats.drowsinessEvents,
      distraction_events: this.stats.distractionEvents,
      phone_detection_count: this.stats.phoneDetectionCount,
      total_drowsiness_duration: this.stats.totalDrowsinessDuration,
      total_distraction_duration: this.stats.totalDistractionDuration,
      longest_eye_closure: this.stats.longestEyeClosure,
      longest_distraction: this.stats.longestDistraction,
      risk_score_samples: this.riskSamples,
      maximum_risk_level: this.maximumRiskLevel,
      events: this.events,
      alerts: this.alertLog,
    };

    const summary = await SessionApi.stop(this.sessionId, payload);
    this.sessionId = null;
    return summary;
  }

  _recordEvent(eventType, severity, durationSeconds = 0, confidence = 1.0, metadata = {}) {
    this.events.push({
      event_type: eventType,
      timestamp: new Date().toISOString(),
      confidence,
      duration_seconds: durationSeconds,
      severity,
      metadata,
    });
  }

  _tick() {
    if (!this.running) return;
    const nowMs = performance.now();
    const nowSec = nowMs / 1000;
    const latencyStart = performance.now();
    const cfg = getEffectiveMonitoringConfig();
    if (this.lastTickAt) this.processingFps = 1000 / Math.max(nowMs - this.lastTickAt, 1);
    this.lastTickAt = nowMs;

    const analysis = this.faceAnalyzer.analyze(this.videoEl, nowMs);
    if (this.canvasEl.width !== this.videoEl.videoWidth && this.videoEl.videoWidth) {
      this.canvasEl.width = this.videoEl.videoWidth;
      this.canvasEl.height = this.videoEl.videoHeight;
    }
    drawFaceOverlay(this.ctx, this.canvasEl, this.videoEl, analysis);

    let faceState = "DETECTED";
    let ear = null, mar = null, headPose = { yaw: 0, pitch: 0, roll: 0 };
    let eyeClosedDuration = 0, isYawning = false, yawnDuration = 0;
    let distractionDuration = 0, faceAbsentDuration = 0;

    if (analysis.faceCount === 0) {
      faceState = "NO_FACE";
      if (this.faceAbsentSince === null) this.faceAbsentSince = nowSec;
      faceAbsentDuration = nowSec - this.faceAbsentSince;
      this.eyesClosedSince = null;
      this.headOffAxisSince = null;

      if (faceAbsentDuration >= cfg.FACE_ABSENT_DURATION && !this.driverNotDetectedFired) {
        this.driverNotDetectedFired = true;
        this.stats.distractionEvents += 1;
        this._recordEvent("FACE_ABSENT", "DANGER", faceAbsentDuration);
        this._fireAlert("FACE_ABSENT", "DANGER", "Driver not detected", ["Face not visible"]);
      }
    } else {
      this.faceAbsentSince = null;
      this.driverNotDetectedFired = false;

      if (analysis.faceCount > 1) {
        faceState = "MULTIPLE_FACES";
        if (!this.multipleFacesFired) {
          this.multipleFacesFired = true;
          this._recordEvent("MULTIPLE_FACES", "WARNING");
          this._fireAlert("MULTIPLE_FACES", "WARNING", "Multiple people detected", ["More than one face in frame"]);
        }
      } else {
        this.multipleFacesFired = false;
      }

      ear = analysis.ear;
      mar = analysis.mar;
      headPose = analysis.headPose;
      const blinkCountBefore = this.stats.blinkCount;
      const yawnCountBefore = this.stats.yawnCount;
      if (window.DRIVER_PROFILE) {
        headPose = {
          yaw: headPose.yaw - window.DRIVER_PROFILE.head_yaw_baseline,
          pitch: headPose.pitch - window.DRIVER_PROFILE.head_pitch_baseline,
          roll: headPose.roll - window.DRIVER_PROFILE.head_roll_baseline,
        };
      }

      // --- Eye closure / blink state machine ---
      if (ear < cfg.EAR_THRESHOLD) {
        if (this.eyesClosedSince === null) this.eyesClosedSince = nowSec;
        eyeClosedDuration = nowSec - this.eyesClosedSince;

        if (eyeClosedDuration >= cfg.EYE_CLOSED_DURATION && !this._sustainedClosureCounted) {
          this._sustainedClosureCounted = true;
          this.stats.eyeClosureEvents += 1;
          this.stats.drowsinessEvents += 1;
        }
      } else {
        if (this.eyesClosedSince !== null) {
          const closureDuration = nowSec - this.eyesClosedSince;
          // Discriminate a real blink from a sustained closure: only count
          // as a blink if it falls within [BLINK_MIN_DURATION, BLINK_MAX_DURATION].
          // Anything longer was already counted as a sustained closure above,
          // and must NOT also be double-counted as a blink here.
          if (closureDuration >= cfg.BLINK_MIN_DURATION && closureDuration <= cfg.BLINK_MAX_DURATION) {
            this.stats.blinkCount += 1;
          }
          if (closureDuration >= cfg.EYE_CLOSED_DURATION) {
            this.stats.totalDrowsinessDuration += closureDuration;
            this.stats.longestEyeClosure = Math.max(this.stats.longestEyeClosure, closureDuration);
            this._recordEvent("EYE_CLOSED", "WARNING", closureDuration);
          }
        }
        this.eyesClosedSince = null;
        this._sustainedClosureCounted = false;
      }

      // --- Yawn state machine ---
      if (mar > cfg.YAWN_THRESHOLD) {
        if (this.yawnStartedAt === null) this.yawnStartedAt = nowSec;
        yawnDuration = nowSec - this.yawnStartedAt;
        isYawning = yawnDuration >= cfg.YAWN_DURATION;
        if (isYawning && !this.isYawningConfirmed) {
          this.isYawningConfirmed = true;
          this.stats.yawnCount += 1;
          this._recordEvent("YAWN", "WARNING", yawnDuration);
          this._fireAlert("YAWN", "WARNING", "Yawning detected", [`Yawning for ${yawnDuration.toFixed(1)}s`]);
        }
      } else {
        this.yawnStartedAt = null;
        this.isYawningConfirmed = false;
      }

      // --- Head pose / distraction state machine ---
      const headOffAxis =
        Math.abs(headPose.yaw) > cfg.HEAD_YAW_THRESHOLD || Math.abs(headPose.pitch) > cfg.HEAD_PITCH_THRESHOLD;
      if (headOffAxis) {
        if (this.headOffAxisSince === null) this.headOffAxisSince = nowSec;
        distractionDuration = nowSec - this.headOffAxisSince;
        if (distractionDuration >= cfg.DISTRACTION_DURATION && !this.distractionConfirmed) {
          this.distractionConfirmed = true;
          this.stats.distractionEvents += 1;
          this._recordEvent("HEAD_TURN", "WARNING", distractionDuration);
          this._fireAlert("DISTRACTION", "WARNING", "Please keep your eyes on the road", [
            `Driver looking away for ${distractionDuration.toFixed(1)}s`,
          ]);
        }
      } else {
        if (this.headOffAxisSince !== null) {
          const duration = nowSec - this.headOffAxisSince;
          this.stats.totalDistractionDuration += duration;
          this.stats.longestDistraction = Math.max(this.stats.longestDistraction, duration);
        }
        this.headOffAxisSince = null;
        this.distractionConfirmed = false;
      }

      this.temporalSamples.push({ timestamp: nowSec, ear, mar, headPose: { ...headPose }, blink: this.stats.blinkCount > blinkCountBefore, yawn: this.stats.yawnCount > yawnCountBefore });
      const cutoff = nowSec - cfg.TEMPORAL_WINDOW_SECONDS;
      this.temporalSamples = this.temporalSamples.filter((sample) => sample.timestamp >= cutoff);
      const recent = this.temporalSamples.slice(-cfg.SMOOTHING_WINDOW_SAMPLES);
      if (recent.length) {
        const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
        ear = average(recent.map((sample) => sample.ear));
        mar = average(recent.map((sample) => sample.mar));
        headPose = {
          yaw: average(recent.map((sample) => sample.headPose.yaw)),
          pitch: average(recent.map((sample) => sample.headPose.pitch)),
          roll: average(recent.map((sample) => sample.headPose.roll)),
        };
      }
    }

    // --- Phone detection sampling (throttled, server round-trip) ---
    if (nowMs - this.lastPhoneCheckAt >= cfg.PHONE_CHECK_INTERVAL_MS && this.videoEl.videoWidth) {
      this.lastPhoneCheckAt = nowMs;
      this._checkForPhone();
    }
    const phoneDetected = performance.now() < this.phoneDetectedUntil;
    if (phoneDetected) this.phoneDetectedSince = this.phoneDetectedSince || nowSec;
    else this.phoneDetectedSince = null;
    const phoneDuration = this.phoneDetectedSince ? nowSec - this.phoneDetectedSince : 0;
    const windowStart = this.temporalSamples[0]?.timestamp || nowSec;
    const windowMinutes = Math.max((nowSec - windowStart) / 60, 1 / 60);

    // --- Risk scoring ---
    const risk = computeOverallRisk(
      {
        ear: ear ?? 0.3,
        eyeClosedDuration,
        isYawning,
        yawnDuration,
        drowsinessEventCount: this.stats.drowsinessEvents,
        blinkFrequency: this.temporalSamples.filter((sample) => sample.blink).length / windowMinutes,
        yawnFrequency: this.temporalSamples.filter((sample) => sample.yawn).length / windowMinutes,
      },
      {
        headYaw: headPose.yaw,
        headPitch: headPose.pitch,
        distractionDuration,
        faceAbsentDuration,
        phoneDetected,
        phoneDuration,
      }
    );
    this.maximumRiskLevel = maxRiskLevel(this.maximumRiskLevel, risk.level);

    if (nowMs - this.lastRiskSampleAt >= window.APP_CONFIG.RISK_SAMPLE_INTERVAL_MS) {
      this.lastRiskSampleAt = nowMs;
      this.riskSamples.push(risk.overallScore);
    }

    if (risk.level === "CRITICAL") {
      this._fireAlert("DROWSINESS_ALERT", "CRITICAL", "WAKE UP — immediate attention required", risk.reasons);
    } else if (risk.level === "HIGH") {
      this._fireAlert("RISK_HIGH", "DANGER", "Drowsiness detected", risk.reasons);
    }

    this.onUpdate({
      faceState,
      ear,
      mar,
      headPose,
      eyeClosed: ear !== null && ear < cfg.EAR_THRESHOLD,
      phoneDetected,
      risk,
      processingFps: this.processingFps,
      detectionLatencyMs: performance.now() - latencyStart,
      stats: this.stats,
      events: this.events.slice(-20),
      sessionElapsedSeconds: this.sessionStartedAt ? (performance.now() - this.sessionStartedAt) / 1000 : 0,
    });
  }

  _fireAlert(type, level, message, reasons) {
    const result = this.alertManager.maybeFire(type, level, message, reasons);
    if (result.fired) {
      this.alertLog.push(result.alert);
      this.onUpdate.alertCallback && this.onUpdate.alertCallback(result.alert);
      if (typeof this._onAlert === "function") this._onAlert(result.alert);
    }
  }

  onAlert(callback) {
    this._onAlert = callback;
  }

  async _checkForPhone() {
    try {
      const frame = captureFrameAsBase64(this.videoEl, window.APP_CONFIG.SAMPLE_FRAME_MAX_WIDTH);
      if (!frame) return;
      const result = await SessionApi.detectPhone(frame);
      if (result.phone_detected) {
        this.phoneDetectedUntil = performance.now() + window.APP_CONFIG.PHONE_CHECK_INTERVAL_MS + 1500;
        this.stats.phoneDetectionCount += 1;
        this._recordEvent("PHONE_DETECTED", "WARNING", 0, 0.8);
        this._fireAlert("PHONE_DETECTED", "WARNING", "Phone detected", [
          "A phone is visible in frame (this does not confirm the driver is using it)",
        ]);
      }
    } catch {
      // Phone detection is best-effort — a failed/slow backend call should
      // never interrupt the core drowsiness/distraction monitoring loop.
    }
  }
}
