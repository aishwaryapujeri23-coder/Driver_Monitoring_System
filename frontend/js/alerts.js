/**
 * Alert manager: decides whether an alert should actually fire (respecting
 * a per-alert-type cooldown so the same warning doesn't spam every frame),
 * plays a level-appropriate tone via the Web Audio API, and hands the
 * decision back to the caller to render in the UI / log for the session.
 *
 * Audio is synthesized with oscillators rather than shipped as sound files
 * — this keeps the project dependency-free while still satisfying "use
 * browser audio for alerts" (spec section 14). Real files can be dropped
 * into frontend/assets/sounds/ and swapped in later if desired.
 */

class AlertManager {
  constructor(cooldownSeconds) {
    this.cooldownSeconds = cooldownSeconds;
    this.lastFired = new Map(); // alertType -> timestamp (ms)
    this.audioCtx = null;
  }

  _ensureAudioContext() {
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new Ctx();
    }
    return this.audioCtx;
  }

  /**
   * Browsers block audio from starting unless it's initiated by a direct
   * user gesture (a click). Alerts fire from the background monitoring
   * loop, not a click, so without this the AudioContext stays "suspended"
   * forever and no sound plays — silently, with no error.
   *
   * Call this once, synchronously, inside the "Start Session" click
   * handler. That unlocks the AudioContext for the rest of the session,
   * so later alerts triggered from the monitoring loop can actually play.
   */
  unlock() {
    try {
      const ctx = this._ensureAudioContext();
      if (ctx.state === "suspended") ctx.resume();
      // Play a near-silent blip so some browsers fully commit the unlock.
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // Non-fatal — worst case, the first alert tone re-attempts the unlock.
    }
  }

  /**
   * @returns {boolean} whether the alert actually fired (false = suppressed by cooldown)
   */
  maybeFire(alertType, level, message, reasons = []) {
    const now = performance.now();
    const last = this.lastFired.get(alertType) || 0;
    if ((now - last) / 1000 < this.cooldownSeconds) {
      return { fired: false };
    }
    this.lastFired.set(alertType, now);
    this._playTone(level);
    return {
      fired: true,
      alert: { alert_type: alertType, level, message, reasons, timestamp: new Date().toISOString() },
    };
  }

  _playTone(level) {
    try {
      const ctx = this._ensureAudioContext();
      if (ctx.state === "suspended") ctx.resume();

      // CRITICAL gets a distinct two-tone siren (like a klaxon) rather than
      // a beep sequence, since it means "wake up immediately" — it should
      // be unmistakably different from the lower-severity tones.
      if (level === "CRITICAL") {
        this._playSiren(ctx);
        return;
      }

      const tones = {
        INFO: [{ freq: 660, dur: 0.12, gain: 0.15 }],
        WARNING: [{ freq: 520, dur: 0.15, gain: 0.22 }, { freq: 520, dur: 0.15, gap: 0.08, gain: 0.22 }],
        DANGER: [
          { freq: 400, dur: 0.18, gain: 0.3 }, { freq: 400, dur: 0.18, gap: 0.06, gain: 0.3 },
          { freq: 400, dur: 0.18, gap: 0.06, gain: 0.3 },
        ],
      };
      const sequence = tones[level] || tones.INFO;
      let t = ctx.currentTime;
      sequence.forEach((tone) => {
        t += tone.gap || 0;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = level === "DANGER" ? "square" : "sine";
        osc.frequency.value = tone.freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(tone.gain, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + tone.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + tone.dur + 0.02);
        t += tone.dur;
      });
    } catch {
      // Audio is a nice-to-have; never let it break the monitoring loop.
    }
  }

  /** A loud, alternating two-tone siren — unmistakable "wake up" alarm. */
  _playSiren(ctx) {
    const duration = 1.4; // total siren length in seconds
    const stepMs = 140; // how fast it alternates between the two tones
    const freqHigh = 880;
    const freqLow = 620;
    const start = ctx.currentTime;
    const steps = Math.floor((duration * 1000) / stepMs);

    for (let i = 0; i < steps; i++) {
      const t = start + (i * stepMs) / 1000;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = i % 2 === 0 ? freqHigh : freqLow;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + stepMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + stepMs / 1000 + 0.02);
    }
  }
}