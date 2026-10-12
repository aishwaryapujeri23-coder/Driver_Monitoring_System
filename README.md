# Driver Drowsiness & Distraction Detection System

Live Demo : https://driver-monitoring-system-d6e8.onrender.com

Real-time AI driver monitoring — MediaPipe face-landmark analysis running live in the browser, YOLO-based phone detection and session analytics on a FastAPI backend. Built as an MTech Artificial Intelligence / Computer Vision portfolio project.

> **Not a medical or safety-certified product.** This is a research/portfolio prototype. It is not "100% accurate," not medically validated, and not a production autonomous-driving safety system. Thresholds are configurable starting points, not clinically validated constants — see the Limitations section.

---

## 1. Overview

The system watches a driver through a laptop webcam and flags early signs of drowsiness (closed/drooping eyes, yawning) and distraction (head turned away, phone in frame, face not visible), combining them into a single, explainable risk score. Sessions and detection events are saved so the driver can review history and trends.

## 2. Problem Statement

Drowsy and distracted driving are major, well-documented contributors to road accidents. Most drivers have no objective feedback about *when* their attention starts slipping — by the time they notice, it's often already dangerous. A lightweight, camera-only monitoring layer that runs on hardware people already have (a laptop/dashboard webcam) can close that feedback gap.

## 3. Objectives

- Detect sustained eye closure, blink patterns, and yawning from facial landmarks.
- Estimate head orientation to detect "looking away from the road."
- Detect phone usage via object detection.
- Combine these signals into an explainable, configurable risk score.
- Persist sessions and expose analytics/trends over time.
- Do all of this with reasonable real-time performance on an ordinary laptop, no cloud GPU required.

## 4. Features

- Email/password authentication (JWT, bcrypt-hashed passwords)
- Live webcam dashboard with real-time EAR / MAR / head-pose / blink / yawn / risk metrics
- A five-band (SAFE → CRITICAL) explainable risk gauge with reasons for the current score
- Per-driver 12-second calibration for EAR, MAR, and neutral head orientation
- Rolling 30-second smoothing with blink/yawn frequency and persistent-phone analysis
- Debounced, level-appropriate audio + visual alerts
- Session start/stop with a full summary on completion
- Session history table + per-session detail page (events & alerts log)
- Analytics dashboard: totals, risk-over-time, event distribution charts (Chart.js)
- Phone detection via a pretrained YOLOv8-nano model
- Privacy notice + no raw video persistence by default

## 5. Architecture

```
Browser (vanilla HTML/CSS/JS)
  ├─ getUserMedia() → <video> → MediaPipe Face Landmarker (WASM, CDN, in-browser)
  │     └─ EAR / MAR / head-pose computed client-side, every ~150ms
  │     └─ Temporal state machines (blink vs. sustained closure, yawn, distraction)
  │     └─ Risk engine (mirrors backend risk_engine.py) → live gauge + alerts
  │
  ├─ every ~3s: downscaled JPEG frame ──REST──▶ FastAPI /api/sessions/detect-phone
  │                                                  └─ YOLOv8n (Ultralytics) inference
  │
  └─ on Stop Session: aggregated stats + event/alert log ──REST──▶ FastAPI
                                                                └─ SQLite (SQLAlchemy)
```

**Why this split?** Face landmarks need to run at interactive rates with zero network latency, and MediaPipe's WASM build does that well entirely in-browser — no install, no build step. Object detection (YOLO) is a heavier model better suited to the backend, and phone-in-frame doesn't need to be checked every single frame, so it's sampled every few seconds instead of streamed. This keeps the browser responsive and avoids uploading continuous raw video.

**What runs where, explicitly:**
- **Browser only:** webcam rendering, MediaPipe face-landmark inference, EAR/MAR/head-pose math, blink/yawn/distraction temporal logic, live risk scoring, alert audio, charts.
- **Backend only:** authentication, YOLO phone detection (on sampled frames), session persistence, analytics aggregation, server-side recomputation of average risk score on session stop.
- **Never sent to the backend:** continuous raw video. Only an occasional downscaled JPEG sample for phone detection, which is not stored.

## 6. Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, vanilla JavaScript (no framework, no build step) |
| Client-side CV | MediaPipe Face Landmarker (Tasks Vision, WASM, loaded from CDN) |
| Backend | Python 3.11+, FastAPI, Uvicorn |
| Server-side CV | OpenCV, NumPy, Ultralytics YOLOv8n |
| Database | SQLite + SQLAlchemy ORM |
| Auth | JWT (python-jose) + bcrypt password hashing |
| Charts | Chart.js (CDN) |
| Testing | pytest + FastAPI TestClient |

## 7. How Drowsiness Detection Works — Eye Aspect Ratio (EAR)

Given 6 landmark points around an eye (`p1`, `p4` = horizontal corners; `p2`,`p3` and `p5`,`p6` = upper/lower eyelid pairs):

```
EAR = (‖p2−p6‖ + ‖p3−p5‖) / (2 · ‖p1−p4‖)
```

The numerator is the sum of two vertical "how open is the eye" measurements; the denominator is the (roughly constant) eye width. An open eye gives EAR ≈ 0.25–0.35; as the eyelid closes, the vertical distances shrink toward zero while the width stays about the same, so EAR drops sharply. That sharp, largely person-independent drop is what makes EAR useful — but the exact numbers still depend on the individual and the camera, so **the threshold is a configuration value, not a hardcoded constant** (`EAR_THRESHOLD` in `.env`).

**Blink vs. sustained closure:** a real blink is brief (`BLINK_MIN_DURATION`–`BLINK_MAX_DURATION`, default 0.08–0.4s). Anything shorter is treated as sensor noise; anything longer is reclassified as a *sustained closure*, not a blink — this is what prevents a 3-second eye closure from being miscounted as several rapid blinks. Only after the eyes stay below threshold for `EYE_CLOSED_DURATION` (default 1.5s) does the system raise an "eyes closed" event; past `EYE_CLOSED_CRITICAL_DURATION` (2.5s) it escalates toward a critical alert.

## 8. Yawn Detection — Mouth Aspect Ratio (MAR)

Same structural idea, applied to 6 mouth landmarks: vertical mouth-opening distance over horizontal mouth width. A single wide-mouth frame isn't classified as a yawn — MAR must stay above `YAWN_THRESHOLD` for at least `YAWN_DURATION` (default 1.2s) to filter out talking, laughing, or a single stretch/cough.

## 9. Head Pose Estimation

The full architecture (documented in `docs/`) is designed around `cv2.solvePnP` (a 3D face model + camera intrinsics fit for lab-grade yaw/pitch/roll). For this 3-hour MVP scope, the **browser** instead uses a lightweight geometric heuristic (see `frontend/js/face.js`):

- **Roll** = angle of the line between the two outer eye corners vs. horizontal (this one is directly and fairly accurately measurable).
- **Yaw** = horizontal offset of the nose tip from the eye-corner midpoint, normalized by inter-eye distance, scaled to degrees.
- **Pitch** = vertical offset of the nose tip from the eye→chin midline, normalized by face height, scaled to degrees.

This is stable enough to classify "forward / left / right / up / down" for a webcam demo, but it is an approximation, not a full 3D pose fit — it will drift more than solvePnP at extreme angles or unusual face geometry. That tradeoff (simple heuristic vs. full 3D fit) is intentional and documented rather than hidden.

## 10. Phone Detection (YOLO)

A pretrained **YOLOv8-nano** model (Ultralytics, COCO classes) runs on the backend, checking a downscaled frame roughly every 3 seconds for `cell phone` / `person` detections above `YOLO_CONFIDENCE_THRESHOLD` (default 0.45). The model auto-downloads on first use.

**Limitation, stated plainly:** a "cell phone" detection means a phone is visible in frame — it does **not** prove the driver is holding or actively using it (it could be mounted, on the seat, or held by a passenger). The risk engine treats it as one contributing signal, not proof of misuse, and the UI/API responses say this explicitly.

## 11. Risk Scoring

`backend/app/services/risk_engine.py` (mirrored in `frontend/js/monitoring.js` for live scoring) computes:

```
drowsiness_score = f(sustained eye closure, yawning, drowsiness-event history)   → 0-100
distraction_score = f(head off-axis, face absent, phone detected)                → 0-100
overall_score = RISK_WEIGHT_DROWSINESS × drowsiness_score
              + RISK_WEIGHT_DISTRACTION × distraction_score
```

`overall_score` maps to a band: **SAFE (<15) · LOW (<35) · MEDIUM (<60) · HIGH (<80) · CRITICAL (≥80)**. Every score comes with a `reasons` list (e.g. *"Eyes closed for 2.4s"*, *"Driver looking right for 3.1s"*) — the point is that a HIGH/CRITICAL alert is always explainable, not just a number. These weights and bands are configurable, not asserted as medically validated.

The dashboard first tries to load the authenticated user's calibration from `/api/calibration`. During calibration, the driver looks forward, blinks naturally, and opens/closes their mouth for about 12 seconds. The saved EAR/MAR distributions and neutral pose are then used to personalize the live thresholds. Live samples are smoothed over a configurable rolling window (`TEMPORAL_WINDOW_SECONDS`, default 30) before scoring; the dashboard also exposes processing FPS, detection latency, and EAR/MAR/risk charts.

## 12. Installation & Setup (Windows)

**Step 1 — Check Python:**
```powershell
python --version
```
Needs Python 3.11+. If missing, install from python.org (check "Add to PATH" during install).

**Step 2 — One-command startup:**
Double-click `run.bat` in the project root, or from PowerShell:
```powershell
cd path\to\driver-monitoring-system
.\run.bat
```
This creates a virtual environment, installs dependencies, copies `.env.example` → `.env`, starts the server, and opens `http://localhost:8000` in your browser.

**Manual setup (if you prefer step-by-step control):**
```powershell
cd driver-monitoring-system\backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload
```
Then open `http://localhost:8000`.

**Step 3 — Camera permission:** when you click **Start Session**, your browser will prompt for camera access — click **Allow**. Camera access requires `http://localhost` or HTTPS (this is a browser security requirement); `http://localhost:8000` satisfies it.

**Step 4 — First use:** Register an account → log in → on the Dashboard, click **Start Session**.

## 13. Running Tests

```powershell
cd backend
.\venv\Scripts\activate
pytest -v
```
Covers: EAR/MAR calculation correctness, risk-scoring logic and band boundaries, auth (registration, login, password hashing, protected routes), and the full session start/stop/analytics API flow. 29 tests, all passing against a fresh in-memory-style SQLite test database created and torn down per test.

## 14. Project Structure

```
driver-monitoring-system/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app + static frontend serving
│   │   ├── config.py          All thresholds/secrets, env-driven
│   │   ├── database.py        SQLAlchemy engine/session
│   │   ├── models.py          User, DrivingSession, DetectionEvent, AlertEvent
│   │   ├── schemas.py         Pydantic request/response models
│   │   ├── auth.py            Password hashing + JWT
│   │   ├── routes/            auth.py, sessions.py, analytics.py
│   │   ├── services/          risk_engine.py, yolo_service.py, session_service.py
│   │   └── utils/             geometry.py (EAR/MAR reference implementation)
│   ├── tests/                 pytest suite
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html, login.html, register.html,
│   │   dashboard.html, history.html, session-details.html
│   ├── css/                   style.css, auth.css, dashboard.css, responsive.css
│   └── js/                    config.js, utils.js, api.js, auth.js, webcam.js,
│                               face.js, alerts.js, session.js, monitoring.js,
│                               dashboard.js, charts.js
├── run.bat
└── README.md
```

## 15. Limitations

- Head-pose is a geometric heuristic, not a full 3D `solvePnP` fit — accuracy degrades at extreme angles (see section 9).
- Phone detection confirms visibility, not usage/handling.
- Thresholds (EAR, MAR, head-pose angles) are literature-informed starting points, not personally calibrated or medically validated — lighting, camera angle, and individual facial geometry all shift the ideal values.
- Single-webcam, single-face-focused; a passenger's face may register as "multiple faces."
- Not tested for nighttime/infrared conditions — assumes reasonable ambient lighting.

## 16. Future Improvements

- Personalized calibration flow (record a driver's own open-eye/closed-eye/neutral-mouth baseline).
- Server-side `solvePnP` head pose using a canonical 3D face model + camera calibration.
- Custom-trained phone/hand-near-face detector for stronger "in use" signal.
- WebSocket streaming for lower-latency phone detection instead of periodic REST polling.
- Multi-driver profiles and fleet-level aggregate dashboards.

## 17. Resume Description

**Project:** Driver Drowsiness & Distraction Detection System
**Stack:** Python, FastAPI, SQLAlchemy, MediaPipe, OpenCV, Ultralytics YOLOv8, JavaScript, Chart.js, JWT
**One-line:** Real-time browser-based driver monitoring system combining facial-landmark drowsiness detection, head-pose distraction tracking, and YOLO-based phone detection into an explainable risk score with session analytics.

**Resume bullets:**
- Built a real-time computer vision pipeline using MediaPipe Face Landmarker to compute Eye Aspect Ratio and Mouth Aspect Ratio from live webcam video, driving temporal state machines that distinguish blinks from sustained eye closure and confirm yawns while filtering single-frame false positives.
- Designed and implemented an explainable, configurable risk-scoring engine (Python, unit-tested with pytest) that combines drowsiness and distraction signals into a weighted 0–100 score with human-readable reasons, mirrored in JavaScript for zero-latency live scoring in the browser.
- Developed a FastAPI backend with JWT authentication, SQLAlchemy-modeled session/event persistence, and a YOLOv8-based phone-detection endpoint, exposing a documented REST API (OpenAPI/Swagger) consumed by a vanilla-JS dashboard with Chart.js analytics.

## 18. Interview Preparation

**Q: Why EAR instead of a CNN classifier for eye state?**
A: EAR is a simple geometric ratio from landmark positions — no training data, no GPU, near-instant, and interpretable (you can see exactly why it fired). A CNN classifier could be more robust to landmark noise but adds training-data requirements, latency, and a black-box decision, which isn't justified for a two-eye-state signal that a formula already captures well.

**Q: Why not use a CNN end-to-end for drowsiness classification?**
A: An end-to-end CNN would need a large, well-labeled drowsy/alert video dataset, is harder to explain (important for a safety-adjacent alert), and is more expensive to run per-frame than a landmark-based ratio. The landmark approach is transparent, fast, and directly debuggable.

**Q: Why MediaPipe for face landmarks?**
A: It's a well-optimized, pretrained, in-browser (WASM) landmark detector — no training, no server round-trip for the highest-frequency computation, and it runs at interactive rates on ordinary laptop hardware.

**Q: How does YOLO work, briefly?**
A: YOLO ("You Only Look Once") divides the image into a grid and, in a single forward pass, predicts bounding boxes, objectness confidence, and class probabilities per grid cell — as opposed to older two-stage detectors that first propose regions then classify them. That single-pass design is what makes it fast enough for near-real-time use.

**Q: What is IoU?**
A: Intersection-over-Union — the overlap area between a predicted box and a ground-truth (or another predicted) box, divided by their union area. Used both to score detection quality and to drive Non-Max Suppression.

**Q: What is NMS (Non-Max Suppression)?**
A: When a detector proposes multiple overlapping boxes for the same object, NMS keeps the highest-confidence box and suppresses others that overlap it above an IoU threshold, so one object doesn't produce duplicate detections.

**Q: What is mAP?**
A: Mean Average Precision — precision/recall integrated across confidence thresholds and averaged across object classes; the standard summary metric for object-detector quality.

**Q: What is `solvePnP` and why mention it if you didn't use it here?**
A: `solvePnP` (OpenCV) fits a camera pose (rotation + translation) that best explains observed 2D landmark positions given a known 3D face model and camera intrinsics — the "correct" way to get accurate yaw/pitch/roll. I used a simpler 2D geometric heuristic instead for this MVP's time budget, and documented that as an explicit accuracy tradeoff rather than presenting the heuristic as lab-grade.

**Q: Why temporal analysis instead of single-frame decisions?**
A: A single frame can't distinguish a blink from drowsy closure, or a laugh from a yawn. Requiring a signal to persist past a duration threshold is what turns a noisy per-frame ratio into a meaningful, low-false-positive event.

**Q: What causes false positives here, and how did you reduce them?**
A: Fast blinks/talking briefly crossing EAR/MAR thresholds, momentary head turns (checking mirrors), and transient landmark jitter. Reduced via sustained-duration requirements, blink/closure discrimination windows, and alert cooldowns so a borderline oscillating signal doesn't spam alerts.

**Q: What about false negatives — why are they especially dangerous here?**
A: A missed drowsiness event means no warning when one was actually needed — in a driver-safety context that's the more dangerous failure mode than a false alarm, since a false alarm just costs a moment's annoyance while a false negative could contribute to a real accident. This is why thresholds lean toward flagging borderline cases rather than requiring near-certainty.

**Q: Why FastAPI over Flask/Django?**
A: Native async support, automatic OpenAPI/Swagger docs from Pydantic type hints, and built-in request validation — a good fit for a small API-first service without Django's heavier full-stack conventions.

**Q: Why JWT for auth?**
A: Stateless — the server doesn't need to keep session state, which simplifies horizontal scaling and fits a REST + occasional-fetch API cleanly. Tradeoff: revocation is harder than with server-side sessions, acceptable for this project's scope.

**Q: Why SQLite instead of PostgreSQL?**
A: Zero setup for a student/demo project — no separate database server to install or configure. The SQLAlchemy models are database-agnostic; swapping `DATABASE_URL` to a `postgresql://` URL is the only change needed to move to Postgres in production.

**Q: How is webcam processing split between browser and backend, and why?**
A: Face-landmark extraction (the highest-frequency computation) runs entirely client-side via MediaPipe WASM — no network latency, no continuous video upload. Only a downscaled frame sample every few seconds goes to the backend, specifically for YOLO phone detection, which is the one thing that needs a heavier model. This keeps the UI responsive and avoids streaming raw video unnecessarily.

**Q: How would you optimize FPS further?**
A: Lower `PROCESSING_INTERVAL_MS`/raise it depending on hardware, downscale the video resolution fed to MediaPipe, use MediaPipe's lighter model variant, and batch/skip YOLO calls further if bandwidth or backend CPU is the bottleneck.

**Q: How do you handle privacy?**
A: Raw video is never uploaded continuously or stored; only derived metrics/events are persisted; the only frames sent to the backend are periodic, downscaled samples used transiently for phone detection and then discarded. The UI displays this as an explicit notice.

**Q: How would you deploy this?**
A: Containerize the backend (Dockerfile), serve behind a reverse proxy (Nginx/Caddy) with real TLS so camera access works from any device (not just localhost), move to PostgreSQL, and set a strong `SECRET_KEY` via environment/secrets manager rather than `.env`.

**Q: How would you scale this to multiple simultaneous drivers/users?**
A: The backend logic is already per-session/per-user (JWT-scoped, session-id-scoped state); the main scaling levers would be running multiple Uvicorn workers behind a load balancer, moving to a shared Postgres instance, and — if YOLO throughput became the bottleneck — a dedicated inference service/queue rather than inline request-time inference.
