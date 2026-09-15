/**
 * Webcam access via getUserMedia. Isolated here so error handling
 * (permission denied, no camera, browser unsupported) has one clear home.
 */

class Webcam {
  constructor(videoEl) {
    this.videoEl = videoEl;
    this.stream = null;
  }

  isSupported() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Starts the webcam. Returns { ok: true } on success or
   * { ok: false, reason, message } on failure — callers render `message`
   * directly rather than needing to interpret DOMException names themselves.
   */
  async start() {
    if (!this.isSupported()) {
      return {
        ok: false,
        reason: "unsupported",
        message:
          "Your browser doesn't support camera access (getUserMedia). Try the latest Chrome, Edge, or Firefox.",
      };
    }

    if (location.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(location.hostname)) {
      return {
        ok: false,
        reason: "insecure-context",
        message:
          "Camera access requires HTTPS (or localhost). Open this app via http://localhost:8000 instead.",
      };
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err.name, message: this._friendlyMessage(err) };
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }

  isActive() {
    return Boolean(this.stream && this.stream.active);
  }

  _friendlyMessage(err) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "Camera permission was denied. Allow camera access in your browser's site settings and try again.";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "No camera was found on this device.";
      case "NotReadableError":
      case "TrackStartError":
        return "The camera is already in use by another application.";
      default:
        return `Could not access the camera (${err.name || "unknown error"}).`;
    }
  }
}
