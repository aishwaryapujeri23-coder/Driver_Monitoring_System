/**
 * Session lifecycle REST calls — thin wrapper over Api for
 * /api/sessions/*. Kept separate from monitoring.js so the "what to send
 * to the backend" concern is isolated from "how to compute it".
 */

const SessionApi = {
  start() {
    return Api.post("/sessions", {});
  },
  stop(sessionId, summaryPayload) {
    return Api.post(`/sessions/${sessionId}/stop`, summaryPayload);
  },
  list() {
    return Api.get("/sessions");
  },
  get(sessionId) {
    return Api.get(`/sessions/${sessionId}`);
  },
  detectPhone(imageBase64) {
    return Api.post("/sessions/detect-phone", { image_base64: imageBase64 });
  },
  getCalibration() {
    return Api.get("/calibration");
  },
  saveCalibration(profile) {
    return Api.put("/calibration", profile);
  },
};
